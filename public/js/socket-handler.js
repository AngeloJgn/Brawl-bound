/**
 * SOCKET-HANDLER.JS - EL CEREBRO DE RED 4K
 * Optimizado para destrucción sincronizada y corrección de jitter.
 */

const socket = io();
window.misJugadores = {}; 
window.ultimoEstadoTurno = null;
let puedeMoverse = false; 
let armaSeleccionada = 'normal'; 
const teclasPresionadas = {};

// --- GESTIÓN DE LOBBY ---
function enviarListo() {
    socket.emit('jugador_listo');
}

socket.on('actualizar_lobby', (jugadores) => {
    const listaUl = document.getElementById('ul-jugadores');
    if (!listaUl) return;
    
    let html = "";
    for (let id in jugadores) {
        const j = jugadores[id];
        const statusColor = j.listo ? '#76ff03' : '#ff3d00';
        const statusText = j.listo ? "READY_FOR_DEPLOY" : "AWAITING_SYNC...";
        
        html += `
            <div class="lobby-player-card" style="border-left: 4px solid ${j.color}; background: rgba(255,255,255,0.03); padding: 12px; margin: 8px 0; display: flex; justify-content: space-between; font-family: 'Orbitron', sans-serif;">
                <span style="font-size: 14px; letter-spacing: 1px;">${j.nombre.toUpperCase()}</span>
                <span style="font-size: 10px; color: ${statusColor}">${statusText}</span>
            </div>
        `;
    }
    listaUl.innerHTML = html;
});

// --- GESTIÓN DE PARTIDA ---

socket.on('comenzar_juego', (data) => {
    window.misJugadores = data.jugadores;
    window.ultimoEstadoTurno = data.turnoDe;
    
    // INICIALIZACIÓN DE FLAGS
    window.puedeMoverse = true; // <--- FORZAMOS EL PERMISO AQUÍ
    window.animacionActiva = false;
    
    for (let id in window.misJugadores) {
        window.misJugadores[id].renderX = window.misJugadores[id].x;
        window.misJugadores[id].renderY = window.misJugadores[id].y;
    }

    if (typeof cambiarAVistaJuego === "function") cambiarAVistaJuego();
    window.focus(); 
    if (typeof actualizarInterfazTurno === "function") actualizarInterfazTurno();
});

// NUEVO: Recepción de destrucción de mapa sincronizada
socket.on('mapa_destruccion', (data) => {
    // Llamamos a crearCrater con el flag 'emitir' en false para no entrar en bucle
    if (typeof crearCrater === 'function') {
        crearCrater(data.x, data.y, data.radio, false);
    }
});

// NUEVO: Sincronización forzada para eliminar saltos (Jitter)
socket.on('sincronizar_posiciones', (jugadoresServidor) => {
    for (let id in jugadoresServidor) {
        if (window.misJugadores[id]) {
            const jLocal = window.misJugadores[id];
            const jServer = jugadoresServidor[id];
            
            // Forzamos la posición exacta del servidor para corregir errores de física local
            jLocal.x = jServer.x;
            jLocal.y = jServer.y;
            jLocal.hp = jServer.hp;
        }
    }
});

socket.on('actualizar_estado', (data) => {
    for (let id in data.jugadores) {
        const serverData = data.jugadores[id];
        if (!window.misJugadores[id]) {
            window.misJugadores[id] = serverData;
            continue;
        }

        const localJ = window.misJugadores[id];

        if (id !== socket.id) { 
            // ACTUALIZACIÓN PARA ENEMIGOS
            localJ.x = serverData.x; // La X siempre la obedecemos
            
            // Solo obedecemos la Y del servidor si el tanque NO está cayendo en nuestra pantalla
            // o si la diferencia es demasiado grande (teleport)
            const diffY = Math.abs(localJ.y - serverData.y);
            
            if (diffY > 50) {
                localJ.y = serverData.y;
            } else {
                // Si la diferencia es pequeña, preferimos nuestra física local de suelo
                // para evitar que el servidor lo mantenga levitando.
            }
        } else {
            // PARA MI TANQUE: Solo correcciones críticas
            if (Math.hypot(localJ.x - serverData.x, localJ.y - serverData.y) > 60) {
                localJ.x = serverData.x;
                localJ.y = serverData.y;
            }
        }
        localJ.hp = serverData.hp;
        localJ.puntos = serverData.puntos || 0;
    }
});

socket.on('nuevo_turno', (nuevoId) => {
    window.ultimoEstadoTurno = nuevoId;
    puedeMoverse = (socket.id === nuevoId);
    window.enFaseEscape = false; 
    actualizarInterfazTurno();
    
    setTimeout(() => {
        const msj = document.getElementById('mensaje-central');
        if(msj && !window.enFaseEscape) msj.innerText = "";
    }, 2500);
});

// --- COMBATE Y EVENTOS ---
socket.on('proyectil_disparado', (datos) => {
    puedeMoverse = false; 
    if (typeof iniciarAnimacionProyectil === "function") {
        iniciarAnimacionProyectil(datos);
    }
    
    const atacante = window.misJugadores[datos.id]?.nombre || "UNIT";
    if (typeof agregarLog === "function") {
        agregarLog(`${atacante.toUpperCase()} FIRED ${datos.arma.toUpperCase()}`, "#ff3d00");
    }
});

socket.on('fase_escape', () => {
    if (socket.id === window.ultimoEstadoTurno) {
        puedeMoverse = true; 
        window.enFaseEscape = true;
        
        const msj = document.getElementById('mensaje-central');
        if (msj) {
            msj.innerText = "MOVE TO COVER!";
            msj.style.color = "#ffeb3b";
        }
    }
});

// Escuchar cuando un enemigo apunta
socket.on('enemigo_apuntando', (data) => {
    if (window.misJugadores[data.id]) {
        window.misJugadores[data.id].remoteAngulo = data.angulo;
        window.misJugadores[data.id].remotePotencia = data.potencia;
    }
});

socket.on('tick_tiempo', (tiempo) => {
    const timerDisplay = document.getElementById('turno-timer');
    if (!timerDisplay) return;
    timerDisplay.innerText = tiempo.toString().padStart(2, '0');
    timerDisplay.style.color = tiempo <= 5 ? "#ff3d00" : "#76ff03";
});

socket.on('victoria', (data) => {
    const msj = document.getElementById('mensaje-central');
    if (msj) {
        msj.innerHTML = `<span style="font-size: 3rem">VICTORY: ${data.ganador.toUpperCase()}</span>`;
        msj.style.color = "#00e5ff";
    }
    setTimeout(() => window.location.reload(), 6000);
});

function enviarDisparo(ang, pot) {
    if (socket.id !== window.ultimoEstadoTurno || window.enFaseEscape) return;
    
    socket.emit('disparar', { 
        angulo: ang, 
        potencia: pot,
        arma: window.armaSeleccionada || 'normal',
        x: window.misJugadores[socket.id].x + 17,
        y: window.misJugadores[socket.id].y - 15
    });
}

function actualizarInterfazTurno() {
    const msj = document.getElementById('mensaje-central');
    const esMiTurno = (window.ultimoEstadoTurno === socket.id);
    if (msj) {
        msj.innerText = esMiTurno ? "YOUR TURN" : "";
        msj.style.color = "#76ff03";
    }
}

// --- INPUTS ACTUALIZADOS ---

window.addEventListener('keydown', (e) => {
    teclasPresionadas[e.key.toLowerCase()] = true;
    
    // El salto lo mantenemos como evento único para no saltar infinito
    if ((e.key === 'w' || e.code === 'Space' || e.key === 'ArrowUp')) {
        const miTanque = window.misJugadores[socket.id];
        if (miTanque && !miTanque.enSalto && window.puedeMoverse && !window.animacionActiva) {
            socket.emit('saltar');
        }
    }
});

window.addEventListener('keyup', (e) => {
    teclasPresionadas[e.key.toLowerCase()] = false;
});

// Esta función procesará el movimiento continuo cada frame con COLISIÓN FÍSICA
// Esta función procesará el movimiento continuo cada frame con COLISIÓN FÍSICA Y REVISIÓN DE TERRENO

function procesarMovimientoContinuo() {
    if (!window.misJugadores || !window.misJugadores[socket.id]) return;
    
    const esMiTurno = (typeof ultimoEstadoTurno !== 'undefined' && ultimoEstadoTurno === socket.id);
    if (!esMiTurno || !window.puedeMoverse || window.animacionActiva) return;

    const miTanque = window.misJugadores[socket.id];
    if (miTanque.hp <= 0) return;

    const SPEED = 1.5;
    let nuevaX = miTanque.x;
    let movido = false;

    // 1. DETERMINAR DIRECCIÓN
    if (teclasPresionadas['a'] || teclasPresionadas['arrowleft']) {
        nuevaX -= SPEED;
        movido = true;
    } else if (teclasPresionadas['d'] || teclasPresionadas['arrowright']) {
        nuevaX += SPEED;
        movido = true;
    }

    if (movido) {
        // --- 2. VERIFICAR HITBOX Y "CAMINADO SOBRE TANQUES" ---
        let colisionBloqueada = false;
        let sobreOtroAlMoverse = false;

        for (let id in window.misJugadores) {
            if (id === socket.id) continue;
            
            let otro = window.misJugadores[id];
            if (otro.hp <= 0) continue;

            const diffX = Math.abs(nuevaX - otro.x);
            const diffY = Math.abs(miTanque.y - otro.y);

            // A) DETECTAR SI ESTAMOS CAMINANDO SOBRE SU CABEZA
            // Si estamos justo encima (Y=-20), permitimos el movimiento horizontal (X)
            if (diffX < 26 && diffY >= 15 && diffY <= 25) {
                sobreOtroAlMoverse = true;
                // No bloqueamos colisión si estamos arriba, solo nos mantenemos a nivel
                miTanque.y = otro.y - 20; 
                continue; 
            }

            // B) BLOQUEO LATERAL (Solo si estamos a la misma altura aproximada)
            if (diffX < 28 && diffY < 12) {
                colisionBloqueada = true;
                break;
            }
        }

        // --- 3. APLICAR MOVIMIENTO ---
        if (!colisionBloqueada) {
            if (nuevaX < 0) nuevaX = 0;
            if (nuevaX > MUNDO.w - 34) nuevaX = MUNDO.w - 34;
            
            miTanque.x = nuevaX;

            // --- 4. AJUSTE DE PENDIENTES (Solo si no estamos sobre un tanque) ---
            if (!sobreOtroAlMoverse) {
                let piesX = Math.floor(miTanque.x + 17);
                if (typeof verificarSuelo === 'function') {
                    let intentos = 0;
                    while (verificarSuelo(piesX, miTanque.y - 1) && intentos < 4) {
                        miTanque.y--;
                        intentos++;
                    }
                }
            }

            // 5. NOTIFICAR AL SERVIDOR
            socket.emit('mover', { x: miTanque.x, y: miTanque.y });
        }
    }
}

/*function procesarMovimientoContinuo() {
    if (!window.misJugadores || !window.misJugadores[socket.id]) return;
    
    const esMiTurno = (typeof ultimoEstadoTurno !== 'undefined' && ultimoEstadoTurno === socket.id);
    if (!esMiTurno || !window.puedeMoverse || window.animacionActiva) return;

    const miTanque = window.misJugadores[socket.id];
    if (miTanque.hp <= 0) return;

    const SPEED = 1.5;
    let nuevaX = miTanque.x; // Usamos una variable temporal para probar el movimiento
    let movido = false;

    // 1. DETERMINAR DIRECCIÓN
    if (teclasPresionadas['a'] || teclasPresionadas['arrowleft']) {
        nuevaX -= SPEED;
        movido = true;
    } else if (teclasPresionadas['d'] || teclasPresionadas['arrowright']) {
        nuevaX += SPEED;
        movido = true;
    }

    if (movido) {
        // --- 2. VERIFICAR HITBOX CONTRA OTROS JUGADORES ---
        let colisionBloqueada = false;
        for (let id in window.misJugadores) {
            if (id === socket.id) continue; // No chocar con uno mismo
            
            let otro = window.misJugadores[id];
            if (otro.hp <= 0) continue; // Los muertos no bloquean

            // Distancia horizontal (ancho del tanque aprox 32-34px)
            const diffX = Math.abs(nuevaX - otro.x);
            // Distancia vertical (para saber si estamos al mismo nivel o uno encima de otro)
            const diffY = Math.abs(miTanque.y - otro.y);

            // Si estamos cerca en X y casi a la misma altura en Y, hay choque lateral
            if (diffX < 30 && diffY < 15) {
                colisionBloqueada = true;
                break;
            }
        }

        // --- 3. APLICAR MOVIMIENTO SI ESTÁ LIBRE ---
        if (!colisionBloqueada) {
            // Límites del mapa (basado en tu original)
            if (nuevaX < 0) nuevaX = 0;
            if (nuevaX > MUNDO.w - 34) nuevaX = MUNDO.w - 34;
            
            miTanque.x = nuevaX;

            // --- 4. AJUSTE DE PENDIENTES (TREPAR) ---
            // Si al movernos la X, nuestros pies ahora están dentro del suelo, subimos la Y
            let piesX = Math.floor(miTanque.x + 17);
            if (typeof verificarSuelo === 'function') {
                // Sube hasta 4px de pendiente por frame para no quedar trabado
                let intentos = 0;
                while (verificarSuelo(piesX, miTanque.y - 1) && intentos < 4) {
                    miTanque.y--;
                    intentos++;
                }
            }

            // 5. NOTIFICAR AL SERVIDOR
            socket.emit('mover', { x: miTanque.x, y: miTanque.y });
        }
    }
}*/

document.addEventListener('DOMContentLoaded', () => {
    const btnListo = document.getElementById('btn-listo');
    if (btnListo) {
        btnListo.onclick = () => {
            enviarListo();
            btnListo.disabled = true;
            btnListo.innerText = "SYNCING...";
        };
    }
});