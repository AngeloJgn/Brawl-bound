/**
 * MENU.JS - GESTIÓN DE INTERFAZ, HUD DINÁMICO Y LOGS
 */

// Referencias a elementos de la UI
const vistaMenu = document.getElementById('vista-menu');
const vistaLobby = document.getElementById('vista-lobby');
const vistaJuego = document.getElementById('vista-juego');
const inputNombre = document.getElementById('nombre');
const inputColor = document.getElementById('color-pref');
const btnBuscar = document.getElementById('btn-buscar');

/**
 * CAMBIO DE VISTAS
 */
function cambiarAVistaLobby() {
    vistaMenu.style.display = 'none';
    vistaLobby.style.display = 'flex';
    vistaJuego.style.display = 'none';
}

function cambiarAVistaJuego() {
    vistaMenu.style.display = 'none';
    vistaLobby.style.display = 'none';
    vistaJuego.style.display = 'block';
    
    // Ajuste de resolución si existe la función en renderer
    if (typeof configurarHD === 'function') {
        setTimeout(configurarHD, 50);
    }
}

/**
 * PREVISUALIZACIÓN DEL TANQUE (CANVAS PREVIEW)
 */
const canvasPreview = document.getElementById('canvas-preview');
if (canvasPreview) {
    const ctxPre = canvasPreview.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    canvasPreview.width = 200 * dpr;
    canvasPreview.height = 120 * dpr;
    ctxPre.scale(dpr, dpr);

    function dibujarPreview() {
        ctxPre.clearRect(0, 0, 200, 120);
        const color = inputColor.value;
        const centroX = 100;
        const centroY = 80;

        ctxPre.save();
        ctxPre.translate(centroX - 17, centroY - 10);

        // Cuerpo Gradiente
        const grad = ctxPre.createLinearGradient(0, 0, 0, 15);
        grad.addColorStop(0, color);
        grad.addColorStop(1, "#000");

        ctxPre.fillStyle = grad;
        ctxPre.beginPath();
        ctxPre.roundRect(0, 0, 35, 15, [3, 3, 0, 0]);
        ctxPre.fill();

        // Cabina
        ctxPre.beginPath();
        ctxPre.arc(17, 0, 10, Math.PI, 0);
        ctxPre.fill();

        // Cañón
        ctxPre.strokeStyle = color;
        ctxPre.lineWidth = 4;
        ctxPre.lineCap = "round";
        ctxPre.beginPath();
        ctxPre.moveTo(17, -2);
        ctxPre.lineTo(38, -18);
        ctxPre.stroke();

        ctxPre.restore();

        // Efecto Escaneo
        const scanY = (Date.now() % 2000) / 2000 * 120;
        ctxPre.fillStyle = "rgba(255,255,255,0.05)";
        ctxPre.fillRect(0, scanY, 200, 1);

        requestAnimationFrame(dibujarPreview);
    }
    dibujarPreview();
}

/**
 * ACCIÓN DEL BOTÓN PRINCIPAL
 */
btnBuscar.addEventListener('click', () => {
    const nombre = inputNombre.value.trim().substring(0, 12) || "PILOT_" + Math.floor(Math.random() * 99);
    const color = inputColor.value;

    localStorage.setItem('bb_nombre', nombre);
    localStorage.setItem('bb_color', color);

    if (typeof socket !== 'undefined') {
        socket.emit('entrar_al_lobby', { nombre, color });
        cambiarAVistaLobby();
    }
});

/**
 * GESTIÓN DEL HUD (BARRAS DE VIDA Y TURNOS)
 */
function actualizarHUDSuperior() {
    const contenedor = document.getElementById('hud-superior-pilotos');
    const displayNombreTurno = document.getElementById('nombre-turno');
    
    if (!window.misJugadores || Object.keys(window.misJugadores).length === 0) {
        return; 
    }

    const VIDA_MAXIMA = 1000; // Debe coincidir con tu SETTINGS.js y renderer.js
    let htmlBuffer = "";

    for (let id in window.misJugadores) {
        const j = window.misJugadores[id];
        const estaActivo = (id === window.ultimoEstadoTurno);

        // Actualizar el indicador de turno inferior
        if (estaActivo && displayNombreTurno) {
            displayNombreTurno.innerText = j.nombre.toUpperCase();
            displayNombreTurno.style.color = j.color;
        }

        // CALCULAMOS EL PORCENTAJE PARA EL CSS
        // Multiplicamos por 100 para obtener el valor de 0 a 100 que necesita el % de CSS
        const porcentajeVida = Math.max(0, (j.hp / VIDA_MAXIMA) * 100);

        // Card de jugador actualizada
        htmlBuffer += `
            <div class="card-piloto ${estaActivo ? 'active' : ''}" style="border-top: 2px solid ${j.color}; background: rgba(0,0,0,0.6); padding: 6px; min-width: 120px; border-radius: 0 0 4px 4px;">
                <div class="info-superior" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                    <span style="font-size: 11px; font-weight: 900; color: #fff; letter-spacing: 1px;">${j.nombre.toUpperCase()}</span>
                    <span style="font-size: 10px; color: ${j.color}; font-weight: bold;">${j.puntos || 0} PTS</span>
                </div>
                
                <div class="barra-vida-bg" style="width: 100%; height: 6px; background: rgba(255,255,255,0.1); border-radius: 2px; overflow: hidden; position: relative;">
                    <div class="barra-vida-fill" style="width: ${porcentajeVida}%; background: ${j.color}; height: 100%; transition: width 0.3s ease; box-shadow: 0 0 10px ${j.color}aa;"></div>
                </div>

                <div style="font-size: 9px; color: #eee; text-align: right; margin-top: 2px; font-family: 'Orbitron', sans-serif;">
                    ${Math.ceil(j.hp)} / ${VIDA_MAXIMA} HP
                </div>
            </div>
        `;
    }

    contenedor.innerHTML = htmlBuffer;
}
/**
 * INTEGRACIÓN CON SOCKET-HANDLER
 * Añade esto para que el HUD se actualice CADA VEZ que el servidor manda datos
 */
if (typeof socket !== 'undefined') {
    socket.on('estado_juego', (data) => {
        // Aseguramos que los datos globales se actualicen antes de dibujar el HUD
        window.misJugadores = data.jugadores;
        window.ultimoEstadoTurno = data.turnoDe;
        actualizarHUDSuperior();
    });
}

/**
 * SISTEMA DE LOGS DE BATALLA
 */
function agregarLog(mensaje, color = "#888") {
    const logBox = document.getElementById('log-eventos');
    if (!logBox) return;

    const entrada = document.createElement('div');
    entrada.style.color = color;
    entrada.style.marginBottom = "5px";
    entrada.innerHTML = `> ${mensaje.toUpperCase()}`;
    
    logBox.prepend(entrada); // El último evento aparece arriba

    // Limitar logs para rendimiento
    if (logBox.children.length > 15) {
        logBox.removeChild(logBox.lastChild);
    }
}

/**
 * SELECCIÓN DE ARMAS
 */
function seleccionarArma(tipo) {
    window.armaSeleccionada = tipo;
    document.querySelectorAll('.slot-mini').forEach(s => s.classList.remove('active'));
    const btn = document.getElementById(tipo === 'normal' ? 'btn-arma-1' : 'btn-arma-2');
    if (btn) btn.classList.add('active');
    
    agregarLog(`WEAPON_SWITCH: ${tipo === 'normal' ? 'KINETIC' : 'PLASMA'}`, "#ffeb3b");
}

/**
 * INICIALIZACIÓN
 */
window.addEventListener('DOMContentLoaded', () => {
    const gNombre = localStorage.getItem('bb_nombre');
    const gColor = localStorage.getItem('bb_color');

    if (gNombre) inputNombre.value = gNombre;
    if (gColor) inputColor.value = gColor;

    const btn1 = document.getElementById('btn-arma-1');
    const btn2 = document.getElementById('btn-arma-2');

    if(btn1 && btn2) {
        btn1.onclick = () => seleccionarArma('normal');
        btn2.onclick = () => seleccionarArma('especial');
    }
});

// Bucle de HUD (Sincronizado con el estado global)
setInterval(actualizarHUDSuperior, 100);