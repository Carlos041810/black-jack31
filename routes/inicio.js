const express = require('express');

module.exports = function(db, io) {
    const router = express.Router();
    const codigosMesa = ['2025', '2024'];

    // Función para asegurar que las mesas predefinidas existan en la DB
    async function asegurarMesa(codigo, dealerName) {
        const result = await db.execute({
            sql: "SELECT * FROM mesas WHERE codigo = ?",
            args: [codigo]
        });

        if (result.rows.length === 0) {
            await db.execute({
                sql: 'INSERT INTO mesas (codigo, dealer, estado, jugadores_actual) VALUES (?, ?, ?, ?)',
                args: [codigo, dealerName, 'esperando', 0]
            });
            console.log(`[DB] Mesa predefinida ${codigo} creada en la base de datos.`);
        }
    }

    // Asegurar que ambas mesas existan al iniciar
    (async () => {
        await asegurarMesa('2025', 'Dealer Mesa 1');
        await asegurarMesa('2024', 'Dealer Mesa 2');
    })();


    // Ruta para crear una mesa (POST /crear-mesa)
    router.post("/crear-mesa", async (req, res, next) => {
        console.log('🎯 POST /crear-mesa para dealer');
        try {
            // Buscar una mesa libre
            let mesaAsignada = null;

            for (const codigo of codigosMesa) {
                const result = await db.execute({
                    sql: "SELECT * FROM mesas WHERE codigo = ? AND (estado = 'esperando' OR estado = 'finalizado')",
                    args: [codigo]
                });

                if (result.rows.length > 0 && result.rows[0].jugadores_actual === 0) {
                    mesaAsignada = result.rows[0];
                    break;
                }
            }

            if (mesaAsignada) {
                // Reiniciar la mesa para el nuevo dealer
                await db.execute({
                    sql: "UPDATE mesas SET estado = ?, jugadores_actual = ? WHERE codigo = ?",
                    args: ['iniciado', 1, mesaAsignada.codigo] // 1 para el dealer
                });
                
                console.log(`Dealer asignado a la mesa ${mesaAsignada.codigo}`);
                res.json({ 
                    success: true, 
                    codigo: mesaAsignada.codigo,
                    dealer: mesaAsignada.dealer
                });
            } else {
                console.log('No hay mesas disponibles para el dealer.');
                res.status(403).json({ success: false, error: "No hay mesas disponibles en este momento." });
            }
        } catch (error) {
            console.error('Error asignando mesa para dealer:', error);
            res.status(500).json({ success: false, error: "Error interno del servidor al asignar la mesa." });
        }
    });

    // Ruta para obtener las mesas disponibles para jugadores
    router.get("/mesas-disponibles", async (req, res) => {
        console.log('🎯 GET /mesas-disponibles para jugadores');
        try {
            const result = await db.execute({
                // Buscamos mesas que estén esperando, tengan menos de 4 jugadores y al menos 1 (el dealer)
                sql: "SELECT codigo, dealer, jugadores_actual FROM mesas WHERE estado = 'iniciado' AND jugadores_actual < 4 AND jugadores_actual > 0 ORDER BY codigo DESC",
                args: []
            });

            res.json({
                success: true,
                mesas: result.rows
            });

        } catch (error) {
            console.error('Error obteniendo mesas disponibles:', error);
            res.status(500).json({ success: false, error: "Error interno del servidor al buscar mesas." });
        }
    });

    // Ruta para verificar y unirse a una mesa (POST /verificar-mesa)
    router.post("/verificar-mesa", async (req, res, next) => {
        const { codigo } = req.body;
        console.log(`🎯 POST /verificar-mesa recibido para el código: ${codigo}`);

        // Validar que el código sea uno de los predefinidos
        if (!codigosMesa.includes(codigo)) {
            return res.status(404).json({ success: false, existe: false, error: "El código de mesa no es válido." });
        }

        try {
            const result = await db.execute({
                sql: "SELECT * FROM mesas WHERE codigo = ? AND estado != 'cancelado'",
                args: [codigo]
            });

            if (result.rows.length > 0) {
                const mesa = result.rows[0];
                
                if (mesa.jugadores_actual >= 4) { 
                    return res.status(403).json({ success: false, existe: true, error: "La mesa está completa." });
                }

                if (mesa.estado === 'jugando' || mesa.estado === 'finalizado' || mesa.estado === 'esperando') {
                    return res.status(403).json({ success: false, existe: true, error: "No puedes unirte, la partida ya ha comenzado." });
                }

                res.json({ success: true, existe: true });
            } else {
                res.status(404).json({ success: false, existe: false, error: "Mesa no encontrada o inactiva" });
            }
        } catch (error) {
            console.error(`Error al verificar la mesa con código "${codigo}":`, error);
            res.status(500).json({ success: false, error: "Error interno del servidor al verificar la mesa." });
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
        res.status(500).json({ success: false, error: "Error interno del servidor al obtener información de la mesa." });
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
            const result = await db.execute({
                sql: "SELECT * FROM mesas WHERE codigo = ? AND estado != 'cancelado'",
                args: [codigo]
            });

            if (result.rows.length === 0) {
                return res.status(404).json({ success: false, error: "Mesa no encontrada o inactiva" });
            }

            console.log(`Jugador solicitó salir de la mesa ${codigo}. La desconexión del socket manejará la actualización.`);
            res.json({ success: true, message: "Solicitud de salida procesada." });
        } catch (error) {
            console.error(`Error al salir de la mesa con código "${codigo}":`, error);
            res.status(500).json({ success: false, error: "Error interno del servidor al salir de la mesa." });
        }
    });

    return router;
};