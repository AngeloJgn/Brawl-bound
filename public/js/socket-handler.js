/**
 * SOCKET-HANDLER.JS - EL CEREBRO DE RED (OPEN TUNE 2026)
 * Optimizado para destrucción sincronizada, corrección de lag y movimiento continuo.
 */

const socket = io();
window.misJugadores = {}; 
window.ultimoEstadoTurno = null;
window.puedeMoverse = false; 
window.armaSeleccionada = 'normal'; 
window.enFaseEscape = false;
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

// --- GESTIÓN DE PARTIDA Y SINCRONIZACIÓN ---

socket.on('comenzar_juego', (data) => {
    window.misJugadores = data.jugadores;
    window.ultimoEstadoTurno = data.turnoDe;
    window.animacionActiva = false;
    window.enFaseEscape = false;
    
    // Inicializar posiciones de renderizado para LERP
    for (let id in window.misJugadores) {
        window.misJugadores[id].renderX = window.misJugadores[id].x;
        window.misJugadores[id].renderY = window.misJugadores[id].y;
    }

    if (typeof cambiarAVistaJuego === "function") cambiarAVistaJuego();
    window.focus(); 
    actualizarInterfazTurno();
});

// Sincronización de destrucción de mapa (Bitmask)
socket.on('mapa_destruccion', (data) => {
    if (typeof crearCrater === 'function') {
        // Ejecutamos la destrucción local sin re-emitir al servidor
        crearCrater(data.x, data.y, data.radio);
    }
});

// Corrección de Jitter (Posiciones autoritarias del servidor)
socket.on('sincronizar_posiciones', (jugadoresServidor) => {
    for (let id in jugadoresServidor) {
        if (window.misJugadores[id]) {
            const jLocal = window.misJugadores[id];
            const jServer = jugadoresServidor[id];
            
            // Si soy yo, solo corrijo si el error de predicción es muy alto (>30px)
            const umbral = (id === socket.id) ? 30 : 5;
            if (Math.hypot(jLocal.x - jServer.x, jLocal.y - jServer.y) > umbral) {
                jLocal.x = jServer.x;
                jLocal.y = jServer.y;
            }
            jLocal.hp = jServer.hp;
        }
    }
});

socket.on('nuevo_turno', (nuevoId) => {
    window.ultimoEstadoTurno = nuevoId;
    window.puedeMoverse = (socket.id === nuevoId);
    window.enFaseEscape = false; 
    actualizarInterfazTurno();
    
    // Limpiar mensajes centrales después de un tiempo
    setTimeout(() => {
        const msj = document.getElementById('mensaje-central');
        if(msj && !window.enFaseEscape) msj.innerText = "";
    }, 2500);
});

// --- COMBATE ---

socket.on('proyectil_disparado', (datos) => {
    window.puedeMoverse = false; 
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
        window.puedeMoverse = true; 
        window.enFaseEscape = true;
        
        const msj = document.getElementById('mensaje-central');
        if (msj) {
            msj.innerText = "MOVE TO COVER!";
            msj.style.color = "#ffeb3b";
        }
    }
});

// Ver a dónde apuntan los enemigos en tiempo real
socket.on('enemigo_apuntando', (data) => {
    if (window.misJugadores[data.id] && data.id !== socket.id) {
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

// --- FUNCIONES DE ACCIÓN ---

function enviarDisparo(ang, pot) {
    if (socket.id !== window.ultimoEstadoTurno || window.enFaseEscape || window.animacionActiva) return;
    
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

// --- INPUTS Y MOVIMIENTO CONTINUO ---

window.addEventListener('keydown', (e) => {
    teclasPresionadas[e.key.toLowerCase()] = true;
    
    // Salto (Evento único para evitar spam)
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

function procesarMovimientoContinuo() {
    if (!window.misJugadores || !window.misJugadores[socket.id]) return;
    
    const esMiTurno = (window.ultimoEstadoTurno === socket.id);
    if (!esMiTurno || !window.puedeMoverse || window.animacionActiva) return;

    const miTanque = window.misJugadores[socket.id];
    if (miTanque.hp <= 0) return;

    const SPEED = 1.8;
    let nuevaX = miTanque.x;
    let movido = false;

    if (teclasPresionadas['a'] || teclasPresionadas['arrowleft']) {
        nuevaX -= SPEED;
        movido = true;
    } else if (teclasPresionadas['d'] || teclasPresionadas['arrowright']) {
        nuevaX += SPEED;
        movido = true;
    }

    if (movido) {
        // Bloqueo de colisiones laterales
        let colisionBloqueada = false;
        for (let id in window.misJugadores) {
            if (id === socket.id) continue;
            let otro = window.misJugadores[id];
            if (otro.hp <= 0) continue;

            const diffX = Math.abs(nuevaX - otro.x);
            const diffY = Math.abs(miTanque.y - otro.y);

            // Si estamos al mismo nivel y chocamos de lado
            if (diffX < 30 && diffY < 15) {
                colisionBloqueada = true;
                break;
            }
        }

        if (!colisionBloqueada) {
            // Límites del mapa
            nuevaX = Math.max(0, Math.min(MUNDO.w - 34, nuevaX));
            miTanque.x = nuevaX;

            // Ajuste suave de pendientes al caminar
            let piesX = Math.floor(miTanque.x + 17);
            if (typeof verificarSuelo === 'function') {
                let iter = 0;
                while (verificarSuelo(piesX, miTanque.y - 1) && iter < 5) {
                    miTanque.y--;
                    iter++;
                }
            }

            socket.emit('mover', { x: miTanque.x, y: miTanque.y });
        }
    }
}

// Inicialización de botones
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