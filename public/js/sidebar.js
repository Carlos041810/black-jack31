document.addEventListener('DOMContentLoaded', () => {
    const socket = window.socket;

    if (socket) {
        // Escuchar actualizaciones de usuarios conectados
        socket.on("usuariosConectados", (cantidad) => {
            const contador = document.getElementById("contador");
            if (contador) {
                contador.textContent = cantidad;
            }
        });
    }

    // Menú hamburguesa
    const menuToggle = document.getElementById('menuToggle');
    const mobileMenu = document.getElementById('mobileMenu');

    if (menuToggle && mobileMenu) {
        menuToggle.addEventListener('click', function () {
            mobileMenu.classList.toggle('active');
        });
    }
});