module.exports = (io, db) => {
    io.on('connection', (socket) => {
        console.log(`🔌 Usuario conectado con ID: ${socket.id}`);

        socket.on('joinRoom', async (roomCode) => {
            try {
                console.log(`Socket ${socket.id} se une a la sala ${roomCode}`);
                socket.join(roomCode);

                // Al unirse, obtenemos el conteo actual de la DB y lo emitimos a la sala
                const result = await db.execute({
                    sql: "SELECT jugadores_actual FROM mesas WHERE codigo = ? AND estado = 'activo'",
                    args: [roomCode]
                });

                if (result.rows.length > 0) {
                    const playerCount = result.rows[0].jugadores_actual;
                    io.to(roomCode).emit('usuariosConectados', playerCount);
                }
            } catch (error) {
                console.error(`Error en el evento joinRoom para la sala ${roomCode}:`, error);
            }
        });

        socket.on('disconnect', () => {
            console.log(`🔌 Usuario desconectado con ID: ${socket.id}`);
        });
    });
};
