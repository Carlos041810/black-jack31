document.addEventListener('DOMContentLoaded', () => {
    // === MANEJO DEL MENÚ HAMBURGUESA ===
    const menuToggle = document.getElementById('menuToggle');
    const mobileMenu = document.getElementById('mobileMenu');

    if (menuToggle && mobileMenu) {
        menuToggle.addEventListener('click', (e) => {
            e.stopPropagation(); // Evita que el evento de clic se propague al 'window'
            mobileMenu.classList.toggle('active');
        });

        // Listener para cerrar el menú si se hace clic fuera de él
        window.addEventListener('click', (e) => {
            if (mobileMenu.classList.contains('active') && !mobileMenu.contains(e.target) && !menuToggle.contains(e.target)) {
                mobileMenu.classList.remove('active');
            }
        });
    }
});