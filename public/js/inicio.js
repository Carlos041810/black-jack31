 let selectedRoomCode = null;

        document.addEventListener('DOMContentLoaded', () => {
            // 1. Conectarse al servidor de sockets
            const socket = io();
            console.log('[SOCKET] Conectando al servidor...');
            socket.on('connect', () => {
                console.log('[SOCKET] Conectado con ID:', socket.id);
            });
            socket.on('disconnect', () => {
                console.warn('[SOCKET] Desconectado del servidor');
            });

            // 2. Pedir la lista de mesas al conectarse
            socket.emit('getInitialTables');
            console.log('[SOCKET] Emitiendo getInitialTables');

            // 3. Escuchar el evento para actualizar las mesas en tiempo real
            socket.on('mesasActualizadas', (mesas) => {
                console.log('[SOCKET] Evento mesasActualizadas recibido:', mesas);
                renderAvailableTables(mesas);
            });

            // --- LÓGICA PARA EL BOTÓN DE RESETEO ---
            const resetBtn = document.getElementById('resetTablesBtn');
            if (resetBtn) {
                resetBtn.addEventListener('click', async () => {
                    if (confirm('¿Estás seguro de que quieres resetear todas las mesas? Esta acción es para desarrollo y limpiará los datos.')) {
                        try {
                            const response = await fetch('/reset-tables', {
                                method: 'POST'
                            });
                            const data = await response.json();
                            if (data.success) {
                                alert('¡Mesas reseteadas con éxito!');
                                // La actualización de la tabla la hará el evento 'mesasActualizadas' que emite el servidor.
                            } else {
                                alert('Error al resetear las mesas: ' + (data.error || 'Error desconocido'));
                            }
                        } catch (error) {
                            console.error('Error en la solicitud de reseteo:', error);
                            alert('Error de conexión al intentar resetear las mesas.');
                        }
                    }
                });
            }
            // --- FIN DE LA LÓGICA DE RESETEO ---
        });

        function renderAvailableTables(mesas) {
            const container = document.getElementById('available-tables-container');

            if (!mesas) {
                container.innerHTML = '<div class="no-tables-msg">Error al cargar las mesas.</div>';
                console.error('La lista de mesas recibida es inválida.');
                return;
            }

                if (mesas.length > 0) {
                    // Crear la cabecera de la tabla
                    container.innerHTML = `
                        <div class="tables-header">
                            <div class="header-cell">Mesa</div>
                            <div class="header-cell">Jugadores</div>
                            <div class="header-cell action-cell">Acción</div>
                        </div>
                    `;
                    
                    // Añadir cada mesa como una fila
                    mesas.forEach(mesa => {
                        const tableElement = document.createElement('div');
                        tableElement.className = 'table-row';
                        tableElement.innerHTML = `
                            <div class="table-cell">${mesa.dealer}</div>
                            <div class="table-cell">${mesa.jugadores_actual - 1} / 3</div>
                            <div class="table-cell action-cell">
                                <button class="option-button join-table-btn" onclick="showPlayerNameModal('${mesa.codigo}')">UNIRSE</button>
                            </div>
                        `;
                        container.appendChild(tableElement);
                    });

                } else {
                    container.innerHTML = '<div class="no-tables-msg">No hay mesas disponibles en este momento.</div>';
                }
            }

        async function enterAsDealer() {
            const dealerBtn = document.getElementById('dealerBtn');
            const loadingModal = document.getElementById('loadingModal');

            try {
                loadingModal.style.display = 'flex';
                dealerBtn.disabled = true;
                dealerBtn.textContent = 'CREANDO MESA...';

                const response = await fetch('/crear-mesa', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ dealer: 'Dealer Principal' })
                });

                const data = await response.json();

                if (data.success) {
                    console.log('Mesa creada con código:', data.codigo);
                    window.location.href = `/dealer?codigo=${data.codigo}`;

                    // Emitir evento con el código
                    const event = new CustomEvent('mesaCreada', { detail: data.codigo });
                    window.dispatchEvent(event);
                } else {
                    throw new Error(data.error || 'Error desconocido al crear la mesa');
                }
            } catch (error) {
                console.error('Error al crear la mesa:', error);
                alert('Error al crear la mesa: ' + error.message);

                loadingModal.style.display = 'none';
                dealerBtn.disabled = false;
                dealerBtn.textContent = 'ACCEDER COMO DEALER';
            }
        }

        async function joinRoom() {
            const playerName = document.getElementById('playerNameInput').value;
            const joinBtn = document.getElementById('joinBtn');
            if (!playerName.trim()) {
                alert('Por favor ingresa tu nombre para unirte a la mesa.');
                return;
            }

            try {
                joinBtn.disabled = true;
                joinBtn.textContent = 'CONECTANDO...';

                const response = await fetch('/verificar-mesa', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ codigo: selectedRoomCode })
                });

                const data = await response.json();

                if (data.success) {
                    console.log(`Mesa ${selectedRoomCode} verificada. Uniéndose...`);
                    window.location.href = `/player?codigo=${selectedRoomCode}&nombre=${encodeURIComponent(playerName)}`;
                } else {
                    throw new Error(data.error || 'No se pudo unir a la mesa.');
                }
            } catch (error) {
                console.error('Error al verificar la mesa:', error);
                alert('Error: ' + error.message);

                joinBtn.disabled = false;
                joinBtn.textContent = 'UNIRSE';
            }
        }

        function showPlayerNameModal(roomCode) {
            selectedRoomCode = roomCode;
            document.getElementById("codeModal").style.display = "flex";
            document.getElementById("playerNameInput").focus();
        }

        function closeModal() {
            document.getElementById("codeModal").style.display = "none";
        }