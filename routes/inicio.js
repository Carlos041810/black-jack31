    const express = require('express');

    // Esta función recibe la instancia de db y devuelve un router configurado
    module.exports = function(db, io) {
    // Se crea un router nuevo cada vez para asegurar que esté limpio
    const router = express.Router();
    
    // Ruta para crear una mesa (POST /crear-mesa)
    router.post("/crear-mesa", async (req, res, next) => {
        console.log('🎯 POST /crear-mesa recibido:', req.body);
        try {
        const dealer = req.body.dealer || "Dealer";
        const codigo = Math.floor(100000 + Math.random() * 900000).toString();
        console.log(`Creando mesa con código: ${codigo} y dealer: ${dealer}`);
        
        await db.execute({
            sql: 'INSERT INTO mesas (codigo, dealer, estado, jugadores_actual) VALUES (?, ?, ?, ?)',
            args: [codigo, dealer, 'activo', 1]
        });
        
        console.log('Mesa creada exitosamente.');
        
        res.json({ 
            success: true, 
            codigo: codigo,
            dealer: dealer
        });
        } catch (error) {
        console.error('Error creando la mesa:', error);
        next(error); // Pasa el error al manejador central
        }
    });

    // Ruta para verificar y unirse a una mesa (POST /verificar-mesa)
    router.post("/verificar-mesa", async (req, res, next) => {
        const { codigo } = req.body;
        console.log(`🎯 POST /verificar-mesa recibido para el código: ${codigo}`);
        try {
        const result = await db.execute({
            sql: "SELECT * FROM mesas WHERE codigo = ? AND estado != 'cancelado'",
            args: [codigo]
        });

        if (result.rows.length > 0) {
            const mesa = result.rows[0];
            const nuevosJugadores = mesa.jugadores_actual + 1;

            // Sumar 1 al campo jugadores_actual
            await db.execute({
                sql: "UPDATE mesas SET jugadores_actual = jugadores_actual + 1 WHERE codigo = ?",
                args: [codigo]
            });
            console.log(`Jugador se unió a la mesa ${codigo}.`);

            // Notificar a la sala a través de sockets sobre el nuevo conteo
            if (io) {
                console.log(`Emitiendo 'usuariosConectados' a la sala ${codigo} con valor ${nuevosJugadores}`);
                io.to(codigo).emit('usuariosConectados', nuevosJugadores);
            }

            res.json({ success: true, existe: true });
        } else {
            console.log(`La mesa con código ${codigo} no fue encontrada o está inactiva.`);
            res.status(404).json({ success: false, existe: false, error: "Mesa no encontrada o inactiva" });
        }
        } catch (error) {
        console.error(`Error al verificar la mesa con código "${codigo}":`, error);
        next(error); // Pasa el error al manejador central
        }
    });

    // Ruta para obtener información de una mesa (GET /mesa/:codigo)
    router.get("/mesa/:codigo", async (req, res, next) => {
        const { codigo } = req.params;
        console.log(`🎯 GET /mesa/:codigo recibido para el código: ${codigo}`);
        try {
        const result = await db.execute({
            sql: "SELECT * FROM mesas WHERE codigo = ?",
            args: [codigo]
        });
        
        if (result.rows.length > 0) {
            res.json({ success: true, mesa: result.rows[0] });
        } else {
            res.status(404).json({ success: false, error: "Mesa no encontrada" });
        }
        } catch (error) {
        console.error('Error obteniendo información de mesa:', error);
        next(error); // Pasa el error al manejador central
        }
    });

    // Ruta para salir de una mesa (POST /salir-mesa)
router.post("/salir-mesa", async (req, res, next) => {
    const { codigo } = req.body;
    console.log(`🎯 POST /salir-mesa recibido para el código: ${codigo}`);

    if (!codigo) {
        return res.status(400).json({ success: false, error: "Código de mesa requerido" });
    }

    try {
        // Buscar la mesa
        const result = await db.execute({
            sql: "SELECT * FROM mesas WHERE codigo = ? AND estado != 'cancelado'",
            args: [codigo]
        });

        if (result.rows.length === 0) {
            console.log(`La mesa con código ${codigo} no fue encontrada o ya está cancelada.`);
            return res.status(404).json({ success: false, error: "Mesa no encontrada o inactiva" });
        }

        const mesa = result.rows[0];
        let nuevosJugadores = mesa.jugadores_actual - 1;
        if (nuevosJugadores < 0) nuevosJugadores = 0;

        // Si no quedan jugadores, cancelamos la mesa
        const nuevoEstado = nuevosJugadores === 0 ? 'cancelado' : mesa.estado;

        await db.execute({
            sql: "UPDATE mesas SET jugadores_actual = ?, estado = ? WHERE codigo = ?",
            args: [nuevosJugadores, nuevoEstado, codigo]
        });

        console.log(`Jugador salió de la mesa ${codigo}. Jugadores restantes: ${nuevosJugadores}. Estado: ${nuevoEstado}`);

        // Notificar a la sala a través de sockets sobre el nuevo conteo
        if (io) {
            console.log(`Emitiendo 'usuariosConectados' a la sala ${codigo} con valor ${nuevosJugadores}`);
            io.to(codigo).emit('usuariosConectados', nuevosJugadores);
        }
        res.json({ success: true, codigo, jugadores_actual: nuevosJugadores, estado: nuevoEstado });
    } catch (error) {
        console.error(`Error al salir de la mesa con código "${codigo}":`, error);
        next(error);
    }
});


    return router;
    };