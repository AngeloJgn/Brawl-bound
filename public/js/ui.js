const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

if (isMobile) {
    document.getElementById('controles-moviles').style.display = 'block';
    
    const stick = document.getElementById('stick-mov');
    const joy = document.getElementById('joystick-movimiento');
    const trackpad = document.getElementById('trackpad-apuntado');
    const guiaAim = document.getElementById('guia-apuntado');
    
    let inputDireccion = 0; 
    let tocandoTrackpad = false;
    let yaSaltoEnEsteToque = false; // Evita el spam de saltos
    let contadorRed = 0; // Para optimizar el tráfico de red

    // --- 1. LOOP DE CONTROL (60 FPS LOCALES) ---
    setInterval(() => {
        // Validación de turno
        window.puedeMoverse = (typeof socket !== 'undefined' && window.ultimoEstadoTurno === socket.id);

        if (window.puedeMoverse && inputDireccion !== 0 && !window.animacionActiva) {
            moverTanque(inputDireccion === -1 ? 'a' : 'd', true);
        }
    }, 1000 / 60);

    // --- 2. LÓGICA JOYSTICK (MOVIMIENTO Y SALTO) ---
    const manejarJoy = (e) => {
        e.preventDefault();
        if (!window.puedeMoverse) return;

        const touch = Array.from(e.touches).find(t => t.clientX < window.innerWidth / 2);
        if (!touch) return;

        const rect = joy.getBoundingClientRect();
        const dx = touch.clientX - (rect.left + rect.width / 2);
        const dy = touch.clientY - (rect.top + rect.height / 2);

        // Movimiento Horizontal
        if (dx < -15) { inputDireccion = -1; stick.style.left = '30%'; }
        else if (dx > 15) { inputDireccion = 1; stick.style.left = '70%'; }
        else { inputDireccion = 0; stick.style.left = '50%'; }

        // Lógica de Salto (Solo se activa una vez por gesto hacia arriba)
        if (dy < -40) {
            stick.style.top = '30%';
            const j = window.misJugadores ? window.misJugadores[socket.id] : null;
            if (j && !j.enSalto && !yaSaltoEnEsteToque) {
                socket.emit('saltar');
                yaSaltoEnEsteToque = true; 
            }
        } else { 
            stick.style.top = '50%'; 
        }
    };

    joy.addEventListener('touchstart', manejarJoy, { passive: false });
    joy.addEventListener('touchmove', manejarJoy, { passive: false });
    joy.addEventListener('touchend', () => {
        inputDireccion = 0;
        yaSaltoEnEsteToque = false; // Reset para el próximo salto
        stick.style.left = '50%';
        stick.style.top = '50%';
    });

    // --- 3. LÓGICA APUNTADO ---
    trackpad.addEventListener('touchstart', (e) => { 
        if (window.puedeMoverse) tocandoTrackpad = true; 
    });

    trackpad.addEventListener('touchmove', (e) => {
        if (!tocandoTrackpad || !window.puedeMoverse) return;
        e.preventDefault();
        const touch = Array.from(e.touches).find(t => t.clientX > window.innerWidth / 2);
        if (!touch) return;

        const rect = trackpad.getBoundingClientRect();
        const dx = touch.clientX - (rect.left + rect.width / 2);
        const dy = touch.clientY - (rect.top + rect.height / 2);
        
        const j = window.misJugadores[socket.id];
        if (j) {
            const sens = 4.5; 
            mousePosJuego.x = j.x + 17 + (dx * sens);
            mousePosJuego.y = j.y - 15 + (dy * sens);
            guiaAim.style.transform = `translate(${dx/2}px, ${dy/2}px)`;

            const distX = mousePosJuego.x - (j.x + 17);
            const distY = mousePosJuego.y - (j.y - 15);
            const ang = Math.atan2(distY, distX);
            const pot = Math.min(Math.sqrt(distX**2 + distY**2) / 2, 100);

            j.remoteAngulo = ang; 

            // Enviamos apuntado con menos frecuencia para evitar lag
            if (contadorRed % 2 === 0) {
                socket.emit('apuntando', { angulo: ang, potencia: pot });
            }
        }
    }, { passive: false });

    trackpad.addEventListener('touchend', (e) => {
        if (!tocandoTrackpad) return;
        tocandoTrackpad = false;
        guiaAim.style.transform = `translate(0, 0)`;
        
        if (window.puedeMoverse && !window.animacionActiva) {
            const j = window.misJugadores[socket.id];
            if (j) {
                const startX = j.x + 17;
                const startY = j.y - 15;
                const distX = mousePosJuego.x - startX;
                const distY = mousePosJuego.y - startY;
                const potencia = Math.min(Math.sqrt(distX**2 + distY**2) / 2, 100);
                
                if (potencia > 5) {
                    enviarDisparo(Math.atan2(distY, distX), potencia);
                }
            }
        }
    });
}

// --- 4. FUNCIÓN MOVER (OPTIMIZADA) ---
function moverTanque(tecla, esContinuo = false) {
    if (!window.puedeMoverse || window.ultimoEstadoTurno !== socket.id) return;
    
    const j = window.misJugadores[socket.id];
    if (!j || j.hp <= 0) return;
    
    const vel = 1.6; 
    let nuevaX = j.x;

    if (tecla === 'a') nuevaX -= vel;
    if (tecla === 'd') nuevaX += vel;

    // Límites del mapa
    if (nuevaX < 0) nuevaX = 0;
    if (nuevaX > 1246) nuevaX = 1246; 

    j.x = nuevaX;
    
    // Solo ajustar Y si NO está saltando para evitar el glitch de gravedad
    if (!j.enSalto && typeof verificarSuelo === 'function') {
        let correccion = 0;
        // Subir cuestas pequeñas
        while (verificarSuelo(j.x + 17, j.y) && correccion < 10) {
            j.y--;
            correccion++;
        }
    }

    // LIMITADOR DE RED: Enviamos al server solo 1 de cada 3 actualizaciones (20Hz aprox)
    // Esto elimina el "jittering" o tirones en móviles.
    contadorRed++;
    if (contadorRed % 3 === 0 || !esContinuo) {
        socket.emit('mover', { x: j.x, y: j.y });
    }
}