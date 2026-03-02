/**
 * UI-MOBILE.JS - CONTROL TÁCTIL (OPEN TUNE 2026)
 * Joystick de doble eje para movimiento/salto y trackpad de precisión para apuntado.
 */

const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

if (isMobile) {
    document.getElementById('controles-moviles').style.display = 'block';
    
    const stick = document.getElementById('stick-mov');
    const joy = document.getElementById('joystick-movimiento');
    const trackpad = document.getElementById('trackpad-apuntado');
    const guiaAim = document.getElementById('guia-apuntado');
    
    let inputDireccion = 0; 
    let tocandoTrackpad = false;
    let yaSaltoEnEsteToque = false; 
    let contadorRed = 0; 
    let mousePosJuego = { x: 0, y: 0 }; // Coordenadas virtuales de apuntado

    // --- 1. LOOP DE CONTROL (60 FPS) ---
    // Sincronizado con la lógica de physics.js para evitar desincronización
    setInterval(() => {
        const esMiTurno = (typeof ultimoEstadoTurno !== 'undefined' && ultimoEstadoTurno === socket.id);
        
        if (esMiTurno && window.puedeMoverse && inputDireccion !== 0 && !window.animacionActiva) {
            ejecutarMovimientoMovil(inputDireccion);
        }
    }, 1000 / 60);

    // --- 2. LÓGICA JOYSTICK (MOVIMIENTO Y SALTO) ---
    const manejarJoy = (e) => {
        e.preventDefault();
        const esMiTurno = (ultimoEstadoTurno === socket.id);
        if (!esMiTurno || !window.puedeMoverse) return;

        const touch = Array.from(e.touches).find(t => t.clientX < window.innerWidth / 2);
        if (!touch) return;

        const rect = joy.getBoundingClientRect();
        const dx = touch.clientX - (rect.left + rect.width / 2);
        const dy = touch.clientY - (rect.top + rect.height / 2);

        // Movimiento Horizontal (Eje X)
        if (dx < -15) { 
            inputDireccion = -1; 
            stick.style.left = '30%'; 
        } else if (dx > 15) { 
            inputDireccion = 1; 
            stick.style.left = '70%'; 
        } else { 
            inputDireccion = 0; 
            stick.style.left = '50%'; 
        }

        // Gesto de Salto (Eje Y hacia arriba)
        if (dy < -45) {
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
        yaSaltoEnEsteToque = false; 
        stick.style.left = '50%';
        stick.style.top = '50%';
    });

    // --- 3. LÓGICA TRACKPAD (APUNTADO DE PRECISIÓN) ---
    trackpad.addEventListener('touchstart', (e) => { 
        if (window.puedeMoverse) tocandoTrackpad = true; 
    });

    trackpad.addEventListener('touchmove', (e) => {
        if (!tocandoTrackpad || !window.puedeMoverse) return;
        e.preventDefault();
        
        // Buscamos el toque en la mitad derecha de la pantalla
        const touch = Array.from(e.touches).find(t => t.clientX > window.innerWidth / 2);
        if (!touch) return;

        const rect = trackpad.getBoundingClientRect();
        const dx = touch.clientX - (rect.left + rect.width / 2);
        const dy = touch.clientY - (rect.top + rect.height / 2);
        
        const j = window.misJugadores[socket.id];
        if (j) {
            // Sensibilidad progresiva: dx y dy controlan el desplazamiento del punto de mira
            const sens = 4.2; 
            mousePosJuego.x = j.x + 17 + (dx * sens);
            mousePosJuego.y = j.y - 15 + (dy * sens);
            
            // Feedback visual en el trackpad
            guiaAim.style.transform = `translate(${dx/1.5}px, ${dy/1.5}px)`;

            const distX = mousePosJuego.x - (j.x + 17);
            const distY = mousePosJuego.y - (j.y - 15);
            const ang = Math.atan2(distY, distX);
            const pot = Math.min(Math.sqrt(distX**2 + distY**2) / 2, 100);

            // Actualización visual inmediata del ángulo para el jugador local
            j.remoteAngulo = ang; 

            // Reducimos el spam de paquetes de apuntado
            contadorRed++;
            if (contadorRed % 3 === 0) {
                socket.emit('apuntando', { angulo: ang, potencia: pot });
            }
        }
    }, { passive: false });

    trackpad.addEventListener('touchend', (e) => {
        if (!tocandoTrackpad) return;
        tocandoTrackpad = false;
        guiaAim.style.transform = `translate(0, 0)`;
        
        if (window.puedeMoverse && !window.animacionActiva && !window.enFaseEscape) {
            const j = window.misJugadores[socket.id];
            if (j) {
                const distX = mousePosJuego.x - (j.x + 17);
                const distY = mousePosJuego.y - (j.y - 15);
                const potencia = Math.min(Math.sqrt(distX**2 + distY**2) / 2, 100);
                
                if (potencia > 5) {
                    enviarDisparo(Math.atan2(distY, distX), potencia);
                }
            }
        }
    });
}

// --- 4. FUNCIÓN EJECUTAR MOVIMIENTO (AUTORITARIO) ---
function ejecutarMovimientoMovil(dir) {
    const j = window.misJugadores[socket.id];
    if (!j || j.hp <= 0) return;
    
    const vel = 1.7; 
    let nuevaX = j.x + (dir * vel);

    // Límites de mapa dinámicos
    nuevaX = Math.max(0, Math.min(MUNDO.w - 34, nuevaX));

    // Detección de colisión lateral básica con otros tanques
    let bloqueado = false;
    for (let id in window.misJugadores) {
        if (id === socket.id) continue;
        let otro = window.misJugadores[id];
        if (otro.hp > 0 && Math.abs(nuevaX - otro.x) < 28 && Math.abs(j.y - otro.y) < 10) {
            bloqueado = true;
            break;
        }
    }

    if (!bloqueado) {
        j.x = nuevaX;
        
        // Ajuste de terreno (Escalada de píxeles)
        if (!j.enSalto && typeof verificarSuelo === 'function') {
            let piesX = Math.floor(j.x + 17);
            let iter = 0;
            while (verificarSuelo(piesX, j.y - 1) && iter < 6) {
                j.y--;
                iter++;
            }
        }

        // Emisión controlada para suavizar el movimiento en otros clientes
        if (contadorRed % 2 === 0) {
            socket.emit('mover', { x: j.x, y: j.y });
        }
    }
}