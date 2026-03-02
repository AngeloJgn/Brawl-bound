/**
 * PHYSICS.JS - MOTOR DE FÍSICA AUTORITARIO
 * Optimizado para evitar desincronización de terreno y saltos de posición.
 */

window.animacionActiva = false;
const canvasMundo = document.getElementById('mundo');

// --- UTILIDADES DE COORDENADAS ---
function obtenerCoordenadasJuego(e) {
    const rect = canvasMundo.getBoundingClientRect();
    return {
        x: (e.clientX - rect.left) * (MUNDO.w / rect.width),
        y: (e.clientY - rect.top) * (MUNDO.h / rect.height)
    };
}

// --- SISTEMA DE DISPARO ---
canvasMundo.addEventListener('mousedown', (e) => {
    if (typeof ultimoEstadoTurno === 'undefined' || !window.misJugadores) return;
    if (socket.id !== ultimoEstadoTurno || window.animacionActiva || window.enFaseEscape) return;

    const j = window.misJugadores[socket.id];
    if (!j || j.hp <= 0) return;

    const coords = obtenerCoordenadasJuego(e);
    const startX = j.x + 17;
    const startY = j.y - 15;

    const dx = coords.x - startX;
    const dy = coords.y - startY;
    
    const anguloRad = Math.atan2(dy, dx);
    const potencia = Math.min(Math.sqrt(dx*dx + dy*dy) / 2, 100);

    if (potencia > 5 && typeof enviarDisparo === "function") {
        enviarDisparo(anguloRad, potencia);
    }
});

// --- MOTOR DE PROYECTILES ---
function iniciarAnimacionProyectil(datos) {
    window.animacionActiva = true;
    let impactoRegistrado = false; 
    let distanciaRecorrida = 0;
    let trail = []; 

    const v0 = datos.potencia * MUNDO.vFuerza; 
    const rad = datos.angulo;

    let posX = datos.x;
    let posY = datos.y;
    let vx = Math.cos(rad) * v0;
    let vy = Math.sin(rad) * v0;

    const colorTrail = datos.color || "#00e5ff";

    function frame() {
        if (!window.animacionActiva) return;

        // Movimiento de física
        const dx_paso = vx * MUNDO.dt;
        const dy_paso = vy * MUNDO.dt;
        distanciaRecorrida += Math.sqrt(dx_paso**2 + dy_paso**2);

        posX += dx_paso;
        vy += MUNDO.g * MUNDO.dt;
        posY += vy * MUNDO.dt;

        trail.push({x: posX, y: posY});
        if (trail.length > 12) trail.shift();

        // RENDERIZADO DEL PROYECTIL
        window.dibujarProyectilesGlobal = (ctx) => {
            ctx.save();
            if (trail.length > 2) {
                ctx.beginPath();
                ctx.strokeStyle = colorTrail;
                ctx.lineWidth = 3;
                ctx.globalAlpha = 0.5;
                ctx.moveTo(trail[0].x, trail[0].y);
                for(let p of trail) ctx.lineTo(p.x, p.y);
                ctx.stroke();
            }
            ctx.fillStyle = "#fff";
            ctx.shadowBlur = 10;
            ctx.shadowColor = colorTrail;
            ctx.beginPath();
            ctx.arc(posX, posY, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        };

        const victimaId = verificarColisionJugadores(posX, posY);
        const tocaTerreno = verificarSuelo(posX, posY);

        if (victimaId || tocaTerreno || posY > MUNDO.h + 100 || posX < -50 || posX > MUNDO.w + 50) {
            window.animacionActiva = false;
            window.dibujarProyectilesGlobal = null; 
            
            if ((tocaTerreno || victimaId) && !impactoRegistrado) {
                impactoRegistrado = true; 
                datos.distanciaRecorrida = distanciaRecorrida; // Corrección de nombre
                datos.velYImpacto = vy; 
                ejecutarExplosion(posX, posY, victimaId, datos);
            } else if (socket.id === ultimoEstadoTurno) {
                socket.emit('finalizar_animacion');
            }
        } else {
            requestAnimationFrame(frame);
        }
    }
    requestAnimationFrame(frame);
}

// --- EXPLOSIONES ---
function ejecutarExplosion(x, y, victimaId, datos) {
    const radioCrater = datos.arma === 'especial' ? 45 : 30;
    let danoFinal = datos.arma === 'especial' ? 45 : 25; 

    if (victimaId && window.misJugadores[victimaId]) {
        const victima = window.misJugadores[victimaId];
        let multiplicador = 1.0;
        let etiquetas = [];

        if (datos.distanciaRecorrida > 400) {
            multiplicador += 0.3;
            etiquetas.push("LONG SHOT");
        }
        if (datos.velYImpacto > 5) {
            multiplicador += 0.2;
            etiquetas.push("TOP HIT");
        }

        danoFinal = Math.floor(danoFinal * multiplicador);
        victima.hp -= danoFinal;
        if (victima.hp < 0) victima.hp = 0;

        if (typeof crearTextoFlotante === 'function') {
            const msg = (etiquetas.length > 0 ? etiquetas[0] + " " : "") + `-${danoFinal}`;
            crearTextoFlotante(victima.x + 17, victima.y - 30, msg, multiplicador > 1.2 ? "#ffff00" : "#ff3d00");
        }
    }

    if (socket.id === ultimoEstadoTurno) {
        socket.emit('registrar_impacto', { 
            x: Math.round(x), y: Math.round(y),
            radio: radioCrater, idEnemigo: victimaId, arma: datos.arma 
        });
        setTimeout(() => socket.emit('finalizar_animacion'), 800);
    }
    
    crearCrater(x, y, radioCrater);
}

function crearCrater(x, y, radio) {
    if (typeof tierraCtx === 'undefined' || !mapaColisiones) return;

    if (typeof activarShake === 'function') activarShake(radio * 0.5); 
    
    tierraCtx.save();
    tierraCtx.globalCompositeOperation = 'destination-out'; 
    tierraCtx.beginPath();
    tierraCtx.arc(x, y, radio, 0, Math.PI * 2);
    tierraCtx.fill();
    tierraCtx.restore();

    const r2 = radio * radio;
    for (let i = -radio; i <= radio; i++) {
        for (let j = -radio; j <= radio; j++) {
            if (i * i + j * j <= r2) {
                const tx = Math.floor(x + i);
                const ty = Math.floor(y + j);
                if (tx >= 0 && tx < MUNDO.w && ty >= 0 && ty < MUNDO.h) {
                    mapaColisiones[ty * MUNDO.w + tx] = 0;
                }
            }
        }
    }
    // IMPORTANTE: NO llamar a procesarGravedadPasiva aquí dentro si se llama desde un loop externo
}

// --- MOTOR DE GRAVEDAD PASIVA (CORREGIDO) ---
function procesarGravedadPasiva() {
    for (let id in misJugadores) {
        let j = misJugadores[id];
        if (j.enSalto || j.hp <= 0 || window.animacionActiva) continue;

        let piesX = Math.floor(j.x + 17);
        let sobreOtroTanque = false;

        // 1. Detección de tanque debajo
        for (let otroId in misJugadores) {
            if (id === otroId) continue; 
            let otro = misJugadores[otroId];
            if (otro.hp <= 0) continue;

            if (Math.abs(j.x - otro.x) < 26 && j.y >= otro.y - 25 && j.y <= otro.y - 10) {
                sobreOtroTanque = true;
                j.y = otro.y - 20; // Pegado instantáneo
                break;
            }
        }

        if (sobreOtroTanque) continue; // Si está sobre un tanque, no cae más.

        // 2. Gravedad de suelo
        if (!verificarSuelo(piesX, j.y)) {
            if (j.y < MUNDO.h) j.y += 3;
        } else {
            while (verificarSuelo(piesX, j.y - 1)) j.y--;
        }

        if (j.y > MUNDO.h) {
            j.hp = 0;
            if (id === socket.id) socket.emit('actualizar_hp', { hp: 0 });
        }
    }
}

// --- LOOP DE FÍSICA CONSTANTE ---
// Si no tenías este loop, la gravedad solo se ejecutaba al disparar. 
// Esto asegura que te quedes arriba siempre.
setInterval(procesarGravedadPasiva, 1000 / 60);

function verificarColisionJugadores(x, y) {
    for (let id in misJugadores) {
        if (id === ultimoEstadoTurno && !window.enFaseEscape) continue; 
        let j = misJugadores[id];
        if (j.hp <= 0) continue; 
        if (Math.hypot(x - (j.x + 17), y - (j.y - 8)) < 22) return id; 
    }
    return null;
}

// --- SISTEMA DE SALTO ---
if (typeof socket !== 'undefined') {
    socket.on('jugador_salto', (id) => {
        const j = misJugadores[id];
        if (!j || j.enSalto) return; 

        j.enSalto = true;
        let velY = -7.5; 
        const gravedadSalto = 0.35;

    function frameSalto() {
    velY += gravedadSalto;
    j.y += velY;
    let piesX = Math.floor(j.x + 17);
    
    let enemigoDebajo = null;
    let idVictima = null; // <--- Variable para guardar la ID y usarla fuera del for

    // 1. DETECCIÓN DE ENEMIGO
    for (let idEnemigo in misJugadores) {
        if (idEnemigo === id) continue; 
        let otroJugador = misJugadores[idEnemigo];
        if (otroJugador.hp <= 0) continue;
        
        if (Math.abs(j.x - otroJugador.x) < 26 && j.y >= otroJugador.y - 25 && j.y <= otroJugador.y - 10) {
            enemigoDebajo = otroJugador;
            idVictima = idEnemigo; // Guardamos la ID aquí
            break;
        }
    }

    // 2. LÓGICA DE IMPACTO
    if (velY > 0 && (verificarSuelo(piesX, j.y) || enemigoDebajo)) {
        
        if (enemigoDebajo) {
            if (velY > 6) {
                const dano = Math.floor(velY * 2.2);
                
                enemigoDebajo.hp -= dano;
                if (enemigoDebajo.hp < 0) enemigoDebajo.hp = 0;

                crearTextoFlotante(enemigoDebajo.x + 17, enemigoDebajo.y - 20, `STOMP! -${dano}`, "#ff00ff");
                if (typeof activarShake === 'function') activarShake(12);

                // Ahora idVictima sí está definida aquí fuera
                if (id === socket.id) {
                    socket.emit('registrar_impacto', { 
                        idEnemigo: idVictima, 
                        dano: dano,
                        tipo: 'stomp' 
                    });
                }
            }
            j.y = enemigoDebajo.y - 20; 
            
        } else {
            // Daño por caída propia al suelo
            if (velY > 10.5) {
                const danoCaida = Math.floor((velY - 10) * 4);
                j.hp -= danoCaida;
                if (j.hp < 0) j.hp = 0;
                crearTextoFlotante(j.x + 17, j.y - 20, `CAÍDA! -${danoCaida}`, "#ff4400");
                
                if (id === socket.id) socket.emit('actualizar_hp', { hp: j.hp });
            }
            while (verificarSuelo(piesX, j.y - 1)) j.y--;
        }

        j.enSalto = false;
        if (id === socket.id) socket.emit('mover', { x: j.x, y: j.y });
        return;
    }

    if (j.y > MUNDO.h + 100) {
        j.enSalto = false;
        if (id === socket.id) socket.emit('actualizar_hp', { hp: 0 });
        return;
    }

    if (j.enSalto) requestAnimationFrame(frameSalto);
}
        requestAnimationFrame(frameSalto);
    });
}