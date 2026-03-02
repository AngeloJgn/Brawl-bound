const socket = io();
const canvas = document.getElementById('mundo');
const ctx = canvas.getContext('2d');

let misJugadores = {};
let ultimoEstadoTurno = null; // Guardamos el último turno recibido

socket.on('actualizar_juego', (data) => {
    misJugadores = data.jugadores;
    ultimoEstadoTurno = data.turnoDe;
    verificarTurno();
    dibujar();
});

// Esta función se encarga de comparar las IDs
function verificarTurno() {
    const mensaje = document.getElementById('mensaje-turno');
    if (!mensaje) return;

    // Si el socket aún no tiene ID, esperamos 100ms y reintentamos
    if (!socket.id) {
        setTimeout(verificarTurno, 100);
        return;
    }

    if (ultimoEstadoTurno === socket.id) {
        mensaje.innerText = "⭐ ¡ES TU TURNO! ⭐";
        mensaje.style.color = "lime";
    } else {
        mensaje.innerText = "Esperando al enemigo...";
        mensaje.style.color = "white";
    }
}

function lanzar() {
    const ang = document.getElementById('angulo').value;
    const pot = document.getElementById('potencia').value;
    socket.emit('disparar', { angulo: ang, potencia: pot });
}

function dibujar() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Suelo
    ctx.fillStyle = "#444";
    ctx.fillRect(0, 330, canvas.width, 70);
    
    // Jugadores
    for (let id in misJugadores) {
        const j = misJugadores[id];
        ctx.fillStyle = j.color;
        ctx.fillRect(j.x, j.y, 30, 30);
        
        // Dibujar una flecha o indicador sobre el jugador que tiene el turno
        if (id === ultimoEstadoTurno) {
            ctx.fillStyle = "white";
            ctx.fillText("▼", j.x + 10, j.y - 10);
        }
    }
}

socket.on('proyectil_disparado', (p) => {
    animarProyectil(p);
});

function animarProyectil(datos) {
    let t = 0;
    const g = 0.5;
    const v0 = datos.potencia * 0.2;
    const rad = (datos.angulo * Math.PI) / 180;
    const vx = Math.cos(rad) * v0;
    const vy = -Math.sin(rad) * v0;

    function frame() {
        t += 0.5;
        let x = datos.x + vx * t;
        let y = datos.y + vy * t + 0.5 * g * Math.pow(t, 2);
        
        dibujar(); 
        ctx.fillStyle = "yellow";
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fill();

        // Si la bala sale de la pantalla, dejamos de animar
        if (y < 400 && x > 0 && x < 800) {
            requestAnimationFrame(frame);
        }
    }
    frame();
    function animarProyectil(datos) {
    let t = 0;
    const g = 0.5;
    const v0 = datos.potencia * 0.2;
    const rad = (datos.angulo * Math.PI) / 180;
    const vx = Math.cos(rad) * v0;
    const vy = -Math.sin(rad) * v0;

    function frame() {
        t += 0.5;
        let x = datos.x + vx * t;
        let y = datos.y + vy * t + 0.5 * g * Math.pow(t, 2);
        
        dibujar(); 
        ctx.fillStyle = "yellow";
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fill();

        // DETECCIÓN DE COLISIÓN (Simplificada)
        for (let id in misJugadores) {
            let j = misJugadores[id];
            // Si la bala está cerca del centro del cuadrado del enemigo
            if (id !== socket.id && x > j.x && x < j.x + 30 && y > j.y && y < j.y + 30) {
                if (socket.id === ultimoEstadoTurno) { // Solo el que dispara avisa del golpe
                    socket.emit('registrar_impacto', { idEnemigo: id });
                }
                return; // Detenemos la bala
            }
        }

        if (y < 330 && x > 0 && x < 800) { // Si no toca el suelo
            requestAnimationFrame(frame);
        }
    }
    frame();
}

// Modifica la función dibujar para ver la vida
function dibujar() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#444";
    ctx.fillRect(0, 330, canvas.width, 70);
    
    for (let id in misJugadores) {
        const j = misJugadores[id];
        ctx.fillStyle = j.color;
        ctx.fillRect(j.x, j.y, 30, 30);
        
        // Dibujar barra de vida
        ctx.fillStyle = "red";
        ctx.fillRect(j.x, j.y - 15, 30, 5);
        ctx.fillStyle = "lime";
        ctx.fillRect(j.x, j.y - 15, (j.hp / 100) * 30, 5);
    }
}
}