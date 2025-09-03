// Configuración de apuestas
const { createDeck, shuffleDeck } = require('./public/js/cartas.js');
const BETTING_CONFIG = {
    MIN_BET: 1,
    MAX_BET: 100,
    INITIAL_BALANCE: 100
};

// Estados de juego
const GAME_STATES = {
    WAITING: 'waiting',
    BETTING: 'betting',
    PLAYING: 'playing',
    FINISHED: 'finished'
};

// Objeto para mantener el estado de las salas en memoria
const rooms = {};

// Helper para calcular el valor de la mano
function calculateHandValue(hand) {
    let sum = 0;
    let aces = 0;
    for (const card of hand) {
        if (card.hidden) continue; // No contar cartas ocultas

        if (card.card === 'A') {
            aces++;
            sum += 11;
        } else if (['K', 'Q', 'J'].includes(card.card)) {
            sum += 10;
        } else {
            sum += parseInt(card.card, 10);
        }
    }
    while (sum > 21 && aces > 0) {
        sum -= 10;
        aces--;
    }
    return sum;
}

// Helper para avanzar al siguiente turno
function advanceTurn(roomCode, io) {
    const room = rooms[roomCode];
    if (!room || room.gameState !== GAME_STATES.PLAYING) return;

    const playersWithBets = room.players.filter(p => p.betConfirmed && p.bet > 0);
    room.currentPlayerTurnIndex++;

    if (room.currentPlayerTurnIndex < playersWithBets.length) {
        const nextPlayer = playersWithBets[room.currentPlayerTurnIndex];
        io.to(roomCode).emit('turnUpdate', { playerId: nextPlayer.id, playerName: nextPlayer.name });
    } else {
        io.to(roomCode).emit('dealerTurn');
    }
}

module.exports = (io, db) => {
    io.on('connection', (socket) => {
        console.log(`🔌 Usuario conectado con ID: ${socket.id}`);
        
        // Si la sala con este código no existe, se inicializa con la estructura base
        // (jugadores, estado del juego y límite de apuestas).
        socket.on('joinRoom', async (roomCode, playerName) => {
            try {
                if (!rooms[roomCode]) {
                    console.log(`✨ Creando nueva sala ${roomCode}...`);
                    const deck = createDeck();
                    const shuffledDeck = shuffleDeck(deck);
                    rooms[roomCode] = {
                        players: [],
                        gameState: GAME_STATES.WAITING,
                        bettingDeadline: null,
                        deck: shuffledDeck, // ¡Aquí está la baraja barajada!
                        currentPlayerTurnIndex: null
                    };
                    console.log(`🃏 Baraja creada y barajada para la sala ${roomCode}. Total: ${shuffledDeck.length} cartas.`);
                }

                socket.join(roomCode);
                socket.roomCode = roomCode;

                if (playerName) {
                    console.log(`Jugador '${playerName}' (ID: ${socket.id}) se une a la sala ${roomCode}`);
                    rooms[roomCode].players.push({ 
                        id: socket.id, 
                        name: playerName, 
                        bet: 0, 
                        betConfirmed: false,
                        balance: BETTING_CONFIG.INITIAL_BALANCE // Saldo inicial
                    });
                } else {
                    console.log(`Un espectador (Dealer) (ID: ${socket.id}) se unió a la sala ${roomCode}`);
                }

                io.to(roomCode).emit('updatePlayerList', rooms[roomCode].players);
                io.to(roomCode).emit('gameStateUpdate', { 
                    state: rooms[roomCode].gameState,
                    bettingConfig: BETTING_CONFIG 
                });

            } catch (error) {
                console.error(`Error en joinRoom para sala ${roomCode}:`, error);
                socket.emit('error', { message: 'Error al unirse a la sala' });
            }
        });

        // Validador de apuestas
        function validateBet(bet, player) {
            const errors = [];
            
            if (typeof bet !== 'number') {
                errors.push('La apuesta debe ser un número');
            } else {
                if (bet < BETTING_CONFIG.MIN_BET) {
                    errors.push(`Apuesta mínima: $${BETTING_CONFIG.MIN_BET}`);
                }
                if (bet > BETTING_CONFIG.MAX_BET) {
                    errors.push(`Apuesta máxima: $${BETTING_CONFIG.MAX_BET}`);
                }
                if (bet > player.balance) {
                    errors.push('Saldo insuficiente');
                }
                if (!Number.isInteger(bet)) {
                    errors.push('La apuesta debe ser un número entero');
                }
            }
            
            return errors;
        }

        // Evento para establecer apuesta (sin confirmar)
        socket.on('playerBet', (data) => {
            const roomCode = socket.roomCode;
            
            if (!roomCode || !rooms[roomCode]) {
                return socket.emit('error', { message: 'Sala no válida' });
            }

            // Verificar estado del juego
            if (rooms[roomCode].gameState !== GAME_STATES.BETTING) {
                return socket.emit('error', { message: 'No se pueden hacer apuestas en este momento' });
            }

            const player = rooms[roomCode].players.find(p => p.id === socket.id);
            if (!player) {
                return socket.emit('error', { message: 'Jugador no encontrado' });
            }

            // Si ya confirmó su apuesta, no puede cambiarla
            if (player.betConfirmed) {
                return socket.emit('error', { message: 'Ya confirmaste tu apuesta' });
            }

            // Validar apuesta
            const errors = validateBet(data.bet, player);
            if (errors.length > 0) {
                return socket.emit('betError', { errors });
            }

            // Actualizar apuesta (sin confirmar)
            player.bet = data.bet;
            console.log(`Jugador '${player.name}' en sala ${roomCode} estableció apuesta: $${player.bet}`);

            // Notificar actualización
            io.to(roomCode).emit('updatePlayerList', rooms[roomCode].players);
            socket.emit('betUpdated', { bet: player.bet });
        });

        // Evento para confirmar apuesta
        socket.on('playerConfirmBet', () => {
            const roomCode = socket.roomCode;
            
            if (!roomCode || !rooms[roomCode]) {
                return socket.emit('error', { message: 'Sala no válida' });
            }

            const player = rooms[roomCode].players.find(p => p.id === socket.id);
            if (!player) {
                return socket.emit('error', { message: 'Jugador no encontrado' });
            }

            // Verificar que tenga una apuesta válida
            const errors = validateBet(player.bet, player);
            if (errors.length > 0) {
                return socket.emit('betError', { errors });
            }

            // Ya confirmó
            if (player.betConfirmed) {
                return socket.emit('error', { message: 'Ya confirmaste tu apuesta' });
            }

            // Confirmar apuesta y descontar del saldo
            player.betConfirmed = true;
            player.balance -= player.bet;
            
            console.log(`Jugador '${player.name}' confirmó apuesta de $${player.bet}. Saldo restante: $${player.balance}`);
            
            // Notificar confirmación
            io.to(roomCode).emit('updatePlayerList', rooms[roomCode].players);
            io.to(roomCode).emit('playerBetConfirmed', { 
                playerId: socket.id, 
                playerName: player.name,
                bet: player.bet,
                remainingBalance: player.balance
            });

            // Verificar si todos han confirmado
            const allPlayersConfirmed = rooms[roomCode].players.every(p => p.betConfirmed);
            const hasPlayers = rooms[roomCode].players.length > 0;

            if (allPlayersConfirmed && hasPlayers) {
                console.log(`Todos los jugadores en sala ${roomCode} han confirmado. Cerrando apuestas.`);
                rooms[roomCode].gameState = GAME_STATES.PLAYING;
                // Notificar a todos que las apuestas se cerraron y el estado cambió.
                io.to(roomCode).emit('bettingClosed');
                io.to(roomCode).emit('gameStateUpdate', { state: GAME_STATES.PLAYING });
            }
        });

        // Evento para cancelar apuesta (antes de confirmar)
        socket.on('cancelBet', () => {
            const roomCode = socket.roomCode;
            if (!roomCode || !rooms[roomCode]) return;

            const player = rooms[roomCode].players.find(p => p.id === socket.id);
            if (!player || player.betConfirmed) return;

            player.bet = 0;
            io.to(roomCode).emit('updatePlayerList', rooms[roomCode].players);
            socket.emit('betCancelled');
        });

        // Evento para iniciar período de apuestas (solo dealer/admin)
        socket.on('startBetting', (duration = 30000) => {
            const roomCode = socket.roomCode;
            console.log(`<- [SERVIDOR] Evento "startBetting" recibido para la sala ${roomCode}.`);

            if (!roomCode || !rooms[roomCode]) {
                console.error(`[SERVIDOR] Error: La sala ${roomCode} no existe. No se puede iniciar la apuesta.`);
                return;
            }

            console.log(`[SERVIDOR] Cambiando estado de la sala ${roomCode} a "betting".`);
            rooms[roomCode].gameState = GAME_STATES.BETTING;
            rooms[roomCode].bettingDeadline = Date.now() + duration;

            io.to(roomCode).emit('gameStateUpdate', { 
                state: rooms[roomCode].gameState 
            });
            console.log(`-> [SERVIDOR] Emitiendo "gameStateUpdate" a la sala ${roomCode}.`);

            io.to(roomCode).emit('bettingStarted', { 
                duration,
                deadline: rooms[roomCode].bettingDeadline 
            });
            console.log(`-> [SERVIDOR] Emitiendo "bettingStarted" a la sala ${roomCode}.`);

            // Timer para cerrar apuestas automáticamente
            setTimeout(() => {
                if (rooms[roomCode] && rooms[roomCode].gameState === GAME_STATES.BETTING) {
                    console.log(`[SERVIDOR] Timer finalizado. Cerrando apuestas en la sala ${roomCode}.`);
                    rooms[roomCode].gameState = GAME_STATES.PLAYING;
                    io.to(roomCode).emit('bettingClosed');
                    io.to(roomCode).emit('gameStateUpdate', { state: GAME_STATES.PLAYING });
                }
            }, duration);
        });

        // Evento para repartir cartas (solo dealer)
        socket.on('dealCards', () => {
            const roomCode = socket.roomCode;
            if (!roomCode || !rooms[roomCode]) return;

            const room = rooms[roomCode];
            // Idealmente, verificar si el emisor es el dealer.
            
            // Validaciones
            if (room.gameState !== GAME_STATES.PLAYING) {
                return socket.emit('error', { message: 'No se pueden repartir cartas ahora.' });
            }
            const allConfirmed = room.players.every(p => p.betConfirmed);
            if (!allConfirmed && room.players.length > 0) {
                return socket.emit('error', { message: 'Esperando que todos los jugadores confirmen su apuesta.' });
            }
            if (room.dealerHand && room.dealerHand.length > 0) {
                return socket.emit('error', { message: 'Las cartas ya han sido repartidas.' });
            }

            console.log(`🃏 Repartiendo cartas en la sala ${roomCode}`);

            // Inicializar manos
            room.players.forEach(p => { p.hand = []; });
            room.dealerHand = [];
            room.currentPlayerTurnIndex = null;

            const playersWithBets = room.players.filter(p => p.betConfirmed && p.bet > 0);

            // Repartir primera ronda (jugadores y luego dealer)
            playersWithBets.forEach(player => {
                player.hand.push(room.deck.pop());
            });
            room.dealerHand.push(room.deck.pop()); // Primera del dealer, visible

            // Repartir segunda ronda
            playersWithBets.forEach(player => {
                player.hand.push(room.deck.pop());
            });
            room.dealerHand.push(room.deck.pop()); // Segunda del dealer, oculta

            // Preparar datos para enviar a los clientes
            const playersHands = room.players.map(p => ({
                id: p.id,
                hand: p.hand
            }));

            const dealerHandForPlayers = [
                room.dealerHand[0], // Primera carta visible
                { hidden: true }   // Segunda carta oculta
            ];

            // Enviar a los jugadores (todos en la sala MENOS el que hizo la petición)
            // Ellos verán la segunda carta del dealer como oculta.
            socket.broadcast.to(roomCode).emit('cardsDealt', {
                players: playersHands,
                dealer: dealerHandForPlayers
            });

            // Enviar al dealer (el que hizo la petición) la mano completa
            socket.emit('cardsDealt', {
                players: playersHands,
                dealer: room.dealerHand // La mano real y completa
            });

            // Después de repartir, determinar el turno del primer jugador
            if (playersWithBets.length > 0) {
                room.currentPlayerTurnIndex = 0;
                const firstPlayer = playersWithBets[0];
                console.log(`[TURN] El turno es para: ${firstPlayer.name} (ID: ${firstPlayer.id})`);
                io.to(roomCode).emit('turnUpdate', {
                    playerId: firstPlayer.id,
                    playerName: firstPlayer.name
                });
            }
        });

        // Evento para pedir una carta (Hit)
        socket.on('playerHit', () => {
            const roomCode = socket.roomCode;
            const room = rooms[roomCode];
            if (!room || room.gameState !== GAME_STATES.PLAYING) return;

            const playersWithBets = room.players.filter(p => p.betConfirmed && p.bet > 0);
            const currentPlayer = playersWithBets[room.currentPlayerTurnIndex];

            if (!currentPlayer || currentPlayer.id !== socket.id) {
                return socket.emit('error', { message: 'No es tu turno.' });
            }

            const newCard = room.deck.pop();
            if (!newCard) {
                return socket.emit('error', { message: 'No quedan cartas en la baraja.' });
            }
            currentPlayer.hand.push(newCard);

            const handValue = calculateHandValue(currentPlayer.hand);
            console.log(`[HIT] Jugador ${currentPlayer.name} pide carta. Nueva carta: ${newCard.card}${newCard.suit}. Puntuación: ${handValue}`);

            // Notificar a todos sobre la nueva carta
            io.to(roomCode).emit('playerCardUpdate', {
                playerId: socket.id,
                newCard: newCard,
                hand: currentPlayer.hand // Enviar toda la mano para sincronizar
            });

            // Si el jugador se pasa de 21
            if (handValue > 21) {
                console.log(`[BUST] Jugador ${currentPlayer.name} se ha pasado con ${handValue}.`);
                io.to(roomCode).emit('playerBust', {
                    playerId: socket.id,
                    playerName: currentPlayer.name,
                    score: handValue
                });
                advanceTurn(roomCode, io);
            }
        });

        // Evento para plantarse (Stand)
        socket.on('playerStand', () => {
            const roomCode = socket.roomCode;
            const room = rooms[roomCode];
            if (!room || room.gameState !== GAME_STATES.PLAYING) return;

            const playersWithBets = room.players.filter(p => p.betConfirmed && p.bet > 0);
            const currentPlayer = playersWithBets[room.currentPlayerTurnIndex];

            if (!currentPlayer || currentPlayer.id !== socket.id) {
                return socket.emit('error', { message: 'No es tu turno.' });
            }

            console.log(`[STAND] Jugador ${currentPlayer.name} se planta.`);
            advanceTurn(roomCode, io);
        });

        // Evento para reiniciar el juego a la fase de apuestas (solo dealer)
        socket.on('resetGame', () => {
            const roomCode = socket.roomCode;
            if (!roomCode || !rooms[roomCode]) return;

            console.log(`Reiniciando el juego en la sala ${roomCode}`);

            // Reiniciar estado de los jugadores
            rooms[roomCode].players.forEach(player => {
                player.bet = 0;
                player.betConfirmed = false;
                player.hand = []; // Limpiar mano
            });

            // Reiniciar mano del dealer y barajar una nueva baraja
            rooms[roomCode].dealerHand = [];
            rooms[roomCode].currentPlayerTurnIndex = null;
            const newDeck = createDeck();
            rooms[roomCode].deck = shuffleDeck(newDeck);
            console.log(`🃏 Nueva baraja creada y barajada para la sala ${roomCode}.`);

            // Reiniciar estado del juego
            rooms[roomCode].gameState = GAME_STATES.WAITING;

            io.to(roomCode).emit('gameReset'); // Nuevo evento para que el cliente limpie la UI
            io.to(roomCode).emit('updatePlayerList', rooms[roomCode].players);
            io.to(roomCode).emit('gameStateUpdate', { state: GAME_STATES.WAITING });
        });
        
        //Evento para manejar la desconexión de un jugador
        socket.on('disconnect', async () => {
            console.log(`🔌 Usuario desconectado con ID: ${socket.id}`);
            const roomCode = socket.roomCode;

            if (roomCode && rooms[roomCode]) {
                const playerIndex = rooms[roomCode].players.findIndex(p => p.id === socket.id);

                if (playerIndex !== -1) {
                    const player = rooms[roomCode].players[playerIndex];
                    console.log(`Jugador '${player.name}' ha salido de la sala ${roomCode}`);

                    // Si un jugador se desconecta con una apuesta ya confirmada, la apuesta se considera perdida.
                    if (player.bet > 0 && player.betConfirmed) {
                        console.log(`Jugador desconectado tenía una apuesta confirmada de $${player.bet}, que se pierde.`);
                    }

                    rooms[roomCode].players.splice(playerIndex, 1);

                    try {
                        await db.execute({
                            sql: "UPDATE mesas SET jugadores_actual = GREATEST(0, jugadores_actual - 1) WHERE codigo = ?",
                            args: [roomCode]
                        });
                    } catch (dbError) {
                        console.error(`Error actualizando DB en disconnect:`, dbError);
                    }

                    io.to(roomCode).emit('updatePlayerList', rooms[roomCode].players);

                    if (rooms[roomCode].players.length === 0) {
                        console.log(`Sala ${roomCode} vacía. Limpiando...`);
                        delete rooms[roomCode];
                    }
                }
            }
        });
    });
};