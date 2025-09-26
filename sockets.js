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

// Limpieza periódica de jugadores desconectados
setInterval(() => {
    const now = Date.now();
    for (const roomCode in rooms) {
        const room = rooms[roomCode];
        // Filtrar para mantener solo a los jugadores conectados o a los desconectados por menos de 30 segundos
        const activePlayers = room.players.filter(p => !p.disconnected || (now - p.disconnectedAt < 30000));
        room.players = activePlayers;
    }
}, 30000); // Ejecutar cada 30 segundos

// Helper para calcular el valor de la mano
function calculateHandValue(hand) {
    let sum = 0;
    let aces = 0;
    for (const card of hand) {
        if (card.hidden) continue; // No contar cartas ocultas

        sum += card.points; // Usamos la propiedad 'points' que ya tiene el valor numérico
        if (card.value === 'A') { // Contamos los Ases para poder ajustar su valor de 11 a 1 si es necesario
            aces++;
        }
    }
    while (sum > 31 && aces > 0) {
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
        // Es el turno del dealer
        io.to(roomCode).emit('dealerTurn'); // Notifica a los clientes que el turno del dealer ha comenzado.
        // La lógica del dealer ahora es interactiva y se inicia desde el cliente.
    }
}

function determineWinners(roomCode, io) {
    const room = rooms[roomCode];
    if (!room) return;

    const dealerScore = calculateHandValue(room.dealerHand);
    const dealerBusted = dealerScore > 31;
    const isDealerBlackjack = dealerScore === 31 && room.dealerHand.length === 2;
    
    console.log(`[RESULTS] Comparando puntuaciones. Dealer tiene: ${dealerScore} ${dealerBusted ? '(Bust)' : ''} ${isDealerBlackjack ? '(Blackjack 31)' : ''}`);
    
    const results = [];
    
    room.players.forEach(player => {
        // Solo procesar jugadores que confirmaron su apuesta
        if (!player.betConfirmed || player.bet === 0) {
            return;
        }
        
        const playerScore = calculateHandValue(player.hand);
        const playerBusted = playerScore > 31;
        const isPlayerBlackjack = playerScore === 31 && player.hand.length === 2;
        
        let outcome = '';
        let winnings = 0;
        
        // 1. El jugador se pasa de 31 (Bust). Pierde automáticamente.
        if (playerBusted) {
            outcome = 'LOSE';
            winnings = 0; // La apuesta ya fue descontada, no se devuelve nada.
        
        // 2. El dealer tiene Blackjack.
        } else if (isDealerBlackjack) {
            // Si el jugador también tiene Blackjack, es un empate (Push). Si no, pierde.
            if (isPlayerBlackjack) {
                outcome = 'PUSH';
                winnings = player.bet; // Se devuelve la apuesta.
            } else {
                outcome = 'LOSE';
                winnings = 0;
            }
        
        // 3. El jugador tiene Blackjack (y el dealer no, por el 'else if' anterior). Gana 3:2.
        } else if (isPlayerBlackjack) {
            outcome = 'BLACKJACK';
            winnings = player.bet * 2.5; // Gana 1.5x la apuesta, total devuelto 2.5x
        
        // 4. El dealer se pasa de 31 (y el jugador no, por la primera condición). Gana el jugador.
        } else if (dealerBusted) {
            outcome = 'WIN';
            winnings = player.bet * 2; // Gana 1x la apuesta, total devuelto 2x.
        
        // 5. Nadie se ha pasado y no hay "Blackjack 31". Se comparan los puntos.
        } else if (playerScore > dealerScore) {
            outcome = 'WIN';
            winnings = player.bet * 2;
        } else if (playerScore < dealerScore) {
            outcome = 'LOSE';
            winnings = 0;
        } else { // Empate (playerScore === dealerScore)
            outcome = 'PUSH';
            winnings = player.bet; // Se devuelve la apuesta
        }
        
        player.balance += winnings; // Se actualiza el saldo del jugador
        
        results.push({
            playerId: player.id,
            playerName: player.name,
            outcome: outcome,
            playerScore: playerScore,
            newBalance: player.balance
        });
    });
    
    // Cambiar el estado de la mesa en la DB a 'finalizado'
    try {
        db.execute({
            sql: "UPDATE mesas SET estado = 'finalizado' WHERE codigo = ?",
            args: [roomCode]
        });
        console.log(`[DB] Estado de la mesa ${roomCode} actualizado a 'finalizado'.`);
    } catch (dbError) {
        console.error(`[DB] Error al actualizar estado de la mesa ${roomCode} a 'finalizado':`, dbError);
    }

    room.gameState = GAME_STATES.FINISHED;
    io.to(roomCode).emit('gameResults', { results, dealerScore });
    io.to(roomCode).emit('gameStateUpdate', { state: GAME_STATES.FINISHED });
}

// Helper para añadir un delay
const delay = ms => new Promise(res => setTimeout(res, ms));

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

                const room = rooms[roomCode];

                socket.join(roomCode);
                socket.roomCode = roomCode;

                // --- LÓGICA DE RECONEXIÓN DE JUGADOR ---
                const existingPlayer = room.players.find(p => p.name === playerName && p.disconnected);

                if (existingPlayer) {
                    console.log(`[RECONNECT] Jugador '${playerName}' se ha reconectado a la sala ${roomCode}.`);
                    existingPlayer.id = socket.id; // Actualizar con el nuevo socket ID
                    existingPlayer.disconnected = false;
                    delete existingPlayer.disconnectedAt;

                    // Notificar a todos la lista actualizada (para que vean al jugador como activo)
                    io.to(roomCode).emit('updatePlayerList', room.players);

                    // Enviar el estado completo del juego SOLO al jugador que se reconecta
                    socket.emit('reconnectState', {
                        gameState: room.gameState,
                        players: room.players,
                        dealerHand: room.dealerHand,
                        bet: existingPlayer.bet,
                        balance: existingPlayer.balance,
                        betConfirmed: existingPlayer.betConfirmed,
                        hand: existingPlayer.hand || [],
                        score: calculateHandValue(existingPlayer.hand || [])
                    });
                    return; // Detener para no crear un jugador nuevo
                }

                // Si no es un jugador que se reconecta, verificamos si la sala está llena.
                if (playerName && room.players.length >= 3) {
                    console.log(`Intento de unirse a sala llena ${roomCode} por ${playerName}. Jugadores: ${room.players.length}`);
                    socket.emit('error', { message: 'La mesa está completa. No se pueden unir más de 3 jugadores.' });
                    return;
                }

                if (playerName) {
                    // Si es un jugador nuevo, lo añadimos
                    console.log(`Jugador '${playerName}' (ID: ${socket.id}) se une a la sala ${roomCode}`);
                    room.players.push({
                        id: socket.id,
                        name: playerName,
                        bet: 0,
                        betConfirmed: false,
                        balance: BETTING_CONFIG.INITIAL_BALANCE,
                        disconnected: false
                    });
                } else {
                    // Si no es un jugador (es el dealer), no incrementamos el contador en la DB aquí,
                    // ya que se hizo al momento de crear la mesa.

                    // --- LÓGICA DE RECONEXIÓN DEL DEALER ---
                    // Si hay un timer de desconexión, significa que el dealer se está reconectando.
                    if (room.dealerDisconnectTimer) {
                        console.log(`[RECONNECT] Dealer (ID: ${socket.id}) se ha reconectado a la sala ${roomCode}. Cancelando cierre de sala.`);
                        clearTimeout(room.dealerDisconnectTimer); // Cancelamos el timer
                        room.dealerDisconnectTimer = null; // Limpiamos la referencia
                        socket.emit('reconnectedSuccessfully'); // Notificar al dealer que todo está bien
                    } else {
                        console.log(`Un espectador (Dealer) (ID: ${socket.id}) se unió a la sala ${roomCode}`);
                    }

                    io.to(roomCode).emit('updatePlayerList', room.players);
                    io.to(roomCode).emit('gameStateUpdate', { state: room.gameState, bettingConfig: BETTING_CONFIG });
                    return; // Salimos para no ejecutar el código de abajo para el dealer
                }

                if (playerName) {
                    console.log(`Un espectador (Dealer) (ID: ${socket.id}) se unió a la sala ${roomCode}`);
                }

                io.to(roomCode).emit('updatePlayerList', room.players);
                io.to(roomCode).emit('gameStateUpdate', { state: room.gameState, bettingConfig: BETTING_CONFIG });

                // --- NUEVA LÓGICA ---
                // Incrementar el contador de jugadores en la base de datos
                if (playerName) {
                    try {
                        await db.execute({ sql: "UPDATE mesas SET jugadores_actual = jugadores_actual + 1 WHERE codigo = ?", args: [roomCode] });
                        console.log(`[DB] Jugador se unió. Mesa ${roomCode} actualizada. Contador incrementado.`);

                        // Notificar a todos los clientes de la página de inicio que la lista de mesas ha cambiado
                        const result = await db.execute({
                            sql: "SELECT codigo, dealer, jugadores_actual FROM mesas WHERE estado = 'iniciado' AND jugadores_actual < 4 ORDER BY codigo DESC",
                            args: []
                        });
                        io.emit('mesasActualizadas', result.rows);
                        console.log('📢 Emitiendo actualización de mesas a todos los clientes tras unirse un jugador.');

                    } catch (dbError) { console.error(`[DB] Error al incrementar jugadores o notificar en joinRoom para ${roomCode}:`, dbError); }
                }

            } catch (error) {
                console.error(`Error en joinRoom para sala ${roomCode}:`, error);
                socket.emit('error', { message: 'Error al unirse a la sala' });
            }
        });

        // Evento para que un nuevo cliente en la página de inicio obtenga las mesas
        socket.on('getInitialTables', async () => {
            try {
                const result = await db.execute({
                    sql: "SELECT codigo, dealer, jugadores_actual FROM mesas WHERE estado = 'iniciado' AND jugadores_actual < 4 ORDER BY codigo DESC",
                    args: []
                });
                // Enviar la lista solo al cliente que la solicitó
                // También se la enviamos a todos para mantener la consistencia
                io.emit('mesasActualizadas', result.rows);
                socket.emit('mesasActualizadas', result.rows);
            } catch (dbError) {
                console.error('[DB] Error al obtener mesas iniciales:', dbError);
                socket.emit('mesasActualizadas', []); // Enviar lista vacía en caso de error
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
        socket.on('startBetting', async (duration = 30000) => {
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

            // Repartir primera ronda
            playersWithBets.forEach(player => {
                player.hand.push(room.deck.pop());
            });
            room.dealerHand.push(room.deck.pop());

            // Repartir segunda ronda
            playersWithBets.forEach(player => {
                player.hand.push(room.deck.pop());
            });
            room.dealerHand.push(room.deck.pop());

            // Repartir tercera ronda
            playersWithBets.forEach(player => {
                player.hand.push(room.deck.pop());
            });
            room.dealerHand.push(room.deck.pop());

            // Preparar datos para enviar a los clientes
            const playersHands = room.players.map(p => {
                const hand = p.hand || [];
                return {
                    id: p.id,
                    hand: hand,
                    score: calculateHandValue(hand)
                };
            });
            
            // Para los jugadores, las dos primeras cartas del dealer están ocultas y la tercera es visible.
            const dealerHandForPlayers = [
                { hidden: true },   // Primera carta oculta
                { hidden: true },   // Segunda carta oculta
                room.dealerHand[2]  // Tercera carta visible
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
        socket.on('playerHit', async () => {
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
            console.log(`[HIT] Jugador ${currentPlayer.name} pide carta. Nueva carta: ${newCard.value}${newCard.suit}. Puntuación: ${handValue}`);

            // Notificar a todos sobre la nueva carta
            io.to(roomCode).emit('playerCardUpdate', {
                playerId: socket.id,
                newCard: newCard,
                score: handValue
            });

            // Si el jugador se pasa de 31
            if (handValue > 31) {
                console.log(`[BUST] Jugador ${currentPlayer.name} se ha pasado con ${handValue}.`);
                await delay(1000); // Esperar a que termine la animación
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

            const handValue = calculateHandValue(currentPlayer.hand);
            if (handValue > 31) {
                console.log(`[BUST] Jugador ${currentPlayer.name} se ha pasado con ${handValue} al plantarse.`);
                io.to(roomCode).emit('playerBust', {
                    playerId: socket.id,
                    playerName: currentPlayer.name,
                    score: handValue
                });
            } else {
                console.log(`[STAND] Jugador ${currentPlayer.name} se planta.`);
                io.to(roomCode).emit('playerStood', {
                    playerId: socket.id,
                    playerName: currentPlayer.name
                });
            }
            advanceTurn(roomCode, io);
        });

        // Evento para que el dealer revele su carta
        socket.on('dealerRevealCard', () => {
            const roomCode = socket.roomCode;
            const room = rooms[roomCode];
            if (!room || !room.dealerHand || room.dealerHand.length === 0) return;

            // Idealmente, verificar que el emisor es el dealer.
            // En este diseño, solo la vista del dealer tiene el botón, así que es implícito.
            console.log(`[DEALER REVEAL] Dealer (socket ${socket.id}) revela su carta en la sala ${roomCode}.`);

            // 1. Revelar la mano completa a todos en la sala
            io.to(roomCode).emit('revealDealerCard', { dealerHand: room.dealerHand });

            // 2. Calcular puntuación y decidir el siguiente paso
            const dealerScore = calculateHandValue(room.dealerHand);
            const activePlayers = room.players.filter(p => p.betConfirmed && calculateHandValue(p.hand) <= 31);

            // Si el dealer tiene 27 o más, o si no quedan jugadores activos, se planta automáticamente.
            if (dealerScore >= 27 || activePlayers.length === 0) {
                console.log(`[DEALER STAND] Dealer se planta automáticamente con ${dealerScore}.`);
                socket.emit('dealerTurnEnd'); // Notificar al dealer para que oculte sus botones de acción.
                setTimeout(() => {
                    determineWinners(roomCode, io);
                }, 1500);
            } else {
                // 3. Si el dealer puede jugar, notificarle solo a él para que muestre los botones de Pedir/Plantarse.
                console.log(`[DEALER ACTION] Dealer tiene ${dealerScore}. Esperando acción (Pedir/Plantarse).`);
                socket.emit('dealerCanPlay');
            }
        });

        // Evento para que el dealer pida una carta
        socket.on('dealerHit', () => {
            const roomCode = socket.roomCode;
            const room = rooms[roomCode];
            if (!room || room.gameState !== GAME_STATES.PLAYING) return;

            const newCard = room.deck.pop();
            if (!newCard) {
                return socket.emit('error', { message: 'No quedan cartas en la baraja.' });
            }
            room.dealerHand.push(newCard);

            const handValue = calculateHandValue(room.dealerHand);
            console.log(`[DEALER HIT] Dealer pide carta. Puntuación: ${handValue}`);

            // Notificar a todos sobre la nueva carta del dealer
            io.to(roomCode).emit('dealerCardUpdate', {
                newCard: newCard,
                score: handValue // <-- AÑADIDO: Enviar la nueva puntuación
            });

            // Si el dealer se pasa o llega al límite, se planta automáticamente.
            if (handValue >= 27) {
                console.log(`[DEALER STAND] Dealer se planta automáticamente con ${handValue}.`);
                socket.emit('dealerTurnEnd'); // Ocultar los botones de acción del dealer
                setTimeout(() => {
                    determineWinners(roomCode, io);
                }, 1500);
            }
        });

        // Evento para que el dealer se plante
        socket.on('dealerStand', () => {
            const roomCode = socket.roomCode;
            const room = rooms[roomCode];
            if (!room || room.gameState !== GAME_STATES.PLAYING) return;

            const handValue = calculateHandValue(room.dealerHand);
            console.log(`[DEALER STAND] Dealer se planta manualmente con ${handValue}.`);
            socket.emit('dealerTurnEnd'); // Ocultar los botones de acción del dealer
            determineWinners(roomCode, io);
        });


        socket.on('resetGame', async () => {
            const roomCode = socket.roomCode;
            if (!roomCode || !rooms[roomCode]) return;

            console.log(`Reiniciando el juego en la sala ${roomCode}`);

            // Actualizar el estado de la mesa en la base de datos a 'esperando'
            try {
                await db.execute({
                    sql: "UPDATE mesas SET estado = 'iniciado' WHERE codigo = ?",
                    args: [roomCode] // Cambiado a 'iniciado' para que la mesa siga visible
                });
                console.log(`[DB] Estado de la mesa ${roomCode} actualizado a 'esperando' en reinicio.`);
            } catch (dbError) {
                console.error(`[DB] Error al actualizar estado de la mesa ${roomCode} en reinicio:`, dbError);
            }

            // Reiniciar estado de los jugadores
            rooms[roomCode].players.forEach(player => {
                player.bet = 0;
                player.betConfirmed = false;
                player.hand = []; // Limpiar mano
                player.balance = BETTING_CONFIG.INITIAL_BALANCE; // Restaurar saldo inicial
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

        // Evento para cuando el dealer cierra la sala intencionadamente
        socket.on('dealerExit', async () => {
            const roomCode = socket.roomCode;
            if (!roomCode || !rooms[roomCode]) return;

            console.log(`🚪 El Dealer ha cerrado la sala ${roomCode} intencionadamente.`);
            
            try {
                await db.execute({
                    sql: "UPDATE mesas SET estado = 'esperando', jugadores_actual = 0 WHERE codigo = ?",
                    args: [roomCode]
                });
                console.log(`[DB] Mesa ${roomCode} reseteada por cierre del dealer.`);
            } catch (dbError) {
                console.error(`[DB] Error reseteando mesa ${roomCode} por cierre del dealer:`, dbError);
            }

            // Notificar a los jugadores que el dealer cerró la sala y luego desconectarlos
            io.to(roomCode).emit('dealerDisconnected', { message: 'El dealer ha cerrado la sala. Volviendo al menú principal.' });
            
            // Si existe un temporizador de desconexión para esta sala, lo cancelamos.
            if (rooms[roomCode].dealerDisconnectTimer) {
                clearTimeout(rooms[roomCode].dealerDisconnectTimer);
                console.log(`[EXIT] Temporizador de desconexión para la sala ${roomCode} cancelado por salida intencionada.`);
            }

            // Limpiar la referencia a la sala en el socket para evitar que 'disconnect' actúe
            socket.roomCode = undefined;

            // Marcar la sala para que el evento 'disconnect' no actúe sobre ella
            rooms[roomCode].closedIntentionally = true;

            // Eliminar la sala de la memoria
            delete rooms[roomCode];
            console.log(`Sala ${roomCode} eliminada de la memoria.`);
        });

        socket.on('disconnect', async () => {
            console.log(`👋 Usuario desconectado: ${socket.id}`);
            const roomCode = socket.roomCode;

            // Si el socket no tiene un roomCode, o la sala no existe, o fue cerrada intencionadamente, no hacemos nada.
            if (!roomCode || !rooms[roomCode] || rooms[roomCode].closedIntentionally) {
                console.log(`El usuario ${socket.id} no estaba en ninguna sala activa.`);
                return;
            }

            const room = rooms[roomCode];
            const playerIndex = room.players.findIndex(p => p.id === socket.id);
            const wasPlayer = playerIndex !== -1;

            if (wasPlayer) {
                const playerName = room.players[playerIndex].name;
                console.log(`Jugador '${playerName}' se ha desconectado de la sala ${roomCode}.`);
                room.players.splice(playerIndex, 1); // Eliminar jugador de la sala

                try {
                    await db.execute({
                        sql: "UPDATE mesas SET jugadores_actual = jugadores_actual - 1 WHERE codigo = ? AND jugadores_actual > 0",
                        args: [roomCode]
                    });
                    console.log(`[DB] Jugador se fue. Mesa ${roomCode} actualizada. Contador decrementado.`);
                } catch (dbError) {
                    console.error(`[DB] Error al decrementar jugadores en disconnect para ${roomCode}:`, dbError);
                }

                io.to(roomCode).emit('updatePlayerList', room.players);

            } else { // Era el dealer
                console.log(`🚨 El Dealer de la sala ${roomCode} se ha desconectado. Iniciando temporizador de 10 segundos para cierre de sala.`);
                // Iniciar un temporizador. Si el dealer no se reconecta, la sala se cierra.
                room.dealerDisconnectTimer = setTimeout(async () => {
                    console.log(`[TIMER] El dealer no se reconectó a la sala ${roomCode}. Cerrando la sala.`);
                    try {
                        await db.execute({
                            sql: "UPDATE mesas SET estado = 'esperando', jugadores_actual = 0 WHERE codigo = ?",
                            args: [roomCode]
                        });
                        console.log(`[DB] Mesa ${roomCode} reseteada por desconexión del dealer.`);
                    } catch (dbError) {
                        console.error(`[DB] Error reseteando mesa ${roomCode} por desconexión del dealer:`, dbError);
                    }

                    // Notificar a los jugadores restantes que el dealer se fue
                    io.to(roomCode).emit('dealerDisconnected');
                    
                    // Eliminar la sala de la memoria
                    delete rooms[roomCode];
                    console.log(`Sala ${roomCode} eliminada de la memoria.`);

                    // Notificar a la página de inicio sobre la mesa liberada
                    io.emit('mesasActualizadas', (await db.execute("SELECT codigo, dealer, jugadores_actual FROM mesas WHERE estado = 'iniciado' AND jugadores_actual < 4 ORDER BY codigo DESC")).rows);
                }, 10000); // 10 segundos de gracia para que el dealer se reconecte
            }

            // Finalmente, notificar a todos en la página de inicio sobre el cambio en las mesas
            const result = await db.execute({
                sql: "SELECT codigo, dealer, jugadores_actual FROM mesas WHERE estado = 'iniciado' AND jugadores_actual < 4 ORDER BY codigo DESC",
                args: []
            });
            io.emit('mesasActualizadas', result.rows);
            console.log('📢 Emitiendo actualización de mesas a todos los clientes.');
        });
    });
};