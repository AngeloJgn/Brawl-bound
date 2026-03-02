/**
 * PHYSICS.JS - MOTOR DE FÍSICA AUTORITARIO (OPEN TUNE 2026)
 * Sistema de proyectiles parabólicos, colisiones de bitmask y daño por caída.
 */

window.animacionActiva = false;
const canvasMundo = document.getElementById('mundo');

// --- MOTOR DE PROYECTILES ---
function iniciarAnimacionProyectil(datos) {
    window.animacionActiva = true;
    let impactoRegistrado = false; 
    let distanciaRecorrida = 0;
    let trail = []; 

    // v0 basado en la potencia escalada por la constante del mundo
    const v0 = datos.potencia * MUNDO.vFuerza; 
    const rad = datos.angulo;

    let posX = datos.x;
    let posY = datos.y;
    let vx = Math.cos(rad) * v0;
    let vy = Math.sin(rad) * v0;

    const colorTrail = datos.color || "#00e5ff";

    function frame() {
        if (!window.animacionActiva) return;

        // Integración de Euler para la física del proyectil
        const dx_paso = vx * MUNDO.dt;
        const dy_paso = vy * MUNDO.dt;
        distanciaRecorrida += Math.sqrt(dx_paso**2 + dy_paso**2);

        posX += dx_paso;
        vy += MUNDO.g * MUNDO.dt; // Gravedad aplicada al eje Y
        posY += vy * MUNDO.dt;

        // Estela del proyectil
        trail.push({x: posX, y: posY});
        if (trail.length > 15) trail.shift();

        // Inyectamos el dibujo en el renderer global
        window.dibujarProyectilesGlobal = (ctx) => {
            ctx.save();
            if (trail.length > 2) {
                ctx.beginPath();
                ctx.strokeStyle = colorTrail;
                ctx.lineWidth = 3;
                ctx.globalAlpha = 0.4;
                ctx.moveTo(trail[0].x, trail[0].y);
                for(let p of trail) ctx.lineTo(p.x, p.y);
                ctx.stroke();
            }
            ctx.fillStyle = "#fff";
            ctx.shadowBlur = 15;
            ctx.shadowColor = colorTrail;
            ctx.beginPath();
            ctx.arc(posX, posY, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        };

        const victimaId = verificarColisionJugadores(posX, posY);
        const tocaTerreno = verificarSuelo(posX, posY);

        // Verificación de límites y colisiones
        if (victimaId || tocaTerreno || posY > MUNDO.h + 100 || posX < -100 || posX > MUNDO.w + 100) {
            window.animacionActiva = false;
            window.dibujarProyectilesGlobal = null; 
            
            if ((tocaTerreno || victimaId) && !impactoRegistrado) {
                impactoRegistrado = true; 
                datos.distanciaRecorrida = distanciaRecorrida;
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

// --- SISTEMA DE EXPLOSIONES Y CRÁTERES ---
function ejecutarExplosion(x, y, victimaId, datos) {
    const radioCrater = datos.arma === 'especial' ? 50 : 35;
    let danoBase = datos.arma === 'especial' ? 45 : 25; 

    if (victimaId && window.misJugadores[victimaId]) {
        const victima = window.misJugadores[victimaId];
        let multiplicador = 1.0;
        let etiqueta = "";

        // Bonus por distancia (Skillshot)
        if (datos.distanciaRecorrida > 500) {
            multiplicador += 0.4;
            etiqueta = "LONG SHOT!";
        }
        // Bonus por impacto vertical (Top Down)
        else if (datos.velYImpacto > 6) {
            multiplicador += 0.25;
            etiqueta = "DIRECT HIT!";
        }

        const danoFinal = Math.floor(danoBase * multiplicador);
        victima.hp -= danoFinal;
        if (victima.hp < 0) victima.hp = 0;

        if (typeof crearTextoFlotante === 'function') {
            crearTextoFlotante(victima.x + 17, victima.y - 35, `${etiqueta} -${danoFinal}`, multiplicador > 1.2 ? "#ffeb3b" : "#ff3d00");
        }
    }

    // El jugador que disparó es el encargado de avisar al servidor
    if (socket.id === ultimoEstadoTurno) {
        socket.emit('registrar_impacto', { 
            x: Math.round(x), y: Math.round(y),
            radio: radioCrater, idEnemigo: victimaId, arma: datos.arma 
        });
        setTimeout(() => socket.emit('finalizar_animacion'), 600);
    }
    
    crearCrater(x, y, radioCrater);
}

function crearCrater(x, y, radio) {
    if (typeof tierraCtx === 'undefined' || !mapaColisiones) return;

    if (typeof activarShake === 'function') activarShake(radio * 0.6); 
    
    // 1. Agujero visual
    tierraCtx.save();
    tierraCtx.globalCompositeOperation = 'destination-out'; 
    tierraCtx.beginPath();
    tierraCtx.arc(x, y, radio, 0, Math.PI * 2);
    tierraCtx.fill();
    tierraCtx.restore();

    // 2. Agujero en Bitmask (Lógica)
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
}

// --- GRAVEDAD Y COLISIONES DE JUGADORES ---
function procesarGravedadPasiva() {
    if (typeof misJugadores === 'undefined' || window.animacionActiva) return;

    for (let id in misJugadores) {
        let j = misJugadores[id];
        if (j.enSalto || j.hp <= 0) continue;

        let piesX = Math.floor(j.x + 17);
        let sobreObjeto = false;

        // Detección de colisión Tank-on-Tank
        for (let otroId in misJugadores) {
            if (id === otroId) continue; 
            let otro = misJugadores[otroId];
            if (otro.hp <= 0) continue;

            if (Math.abs(j.x - otro.x) < 28 && j.y >= otro.y - 25 && j.y <= otro.y - 5) {
                sobreObjeto = true;
                j.y = otro.y - 15; // Mantener sobre el otro tanque
                break;
            }
        }

        if (sobreObjeto) continue;

        // Gravedad contra Bitmask
        if (!verificarSuelo(piesX, j.y)) {
            j.y += 3.5; // Velocidad de caída constante
        } else {
            // Corrección para no enterrarse
            let iter = 0;
            while (verificarSuelo(piesX, j.y - 1) && iter < 10) {
                j.y--;
                iter++;
            }
        }

        // Muerte por caída al vacío
        if (j.y > MUNDO.h) {
            j.hp = 0;
            if (id === socket.id) socket.emit('actualizar_hp', { hp: 0 });
        }
    }
}

// Ejecución constante de la física ambiental
setInterval(procesarGravedadPasiva, 1000 / 60);

function verificarColisionJugadores(x, y) {
    for (let id in misJugadores) {
        if (id === ultimoEstadoTurno && !window.enFaseEscape) continue; 
        let j = misJugadores[id];
        if (j.hp <= 0) continue; 
        // Radio de colisión circular del tanque
        if (Math.hypot(x - (j.x + 17), y - (j.y - 7)) < 22) return id; 
    }
    return null;
}

// --- SISTEMA DE SALTO Y STOMP ---
if (typeof socket !== 'undefined') {
    socket.on('jugador_salto', (id) => {
        const j = misJugadores[id];
        if (!j || j.enSalto) return; 

        j.enSalto = true;
        let velY = -8.0; 
        const gravedadSalto = 0.38;

        function frameSalto() {
            velY += gravedadSalto;
            j.y += velY;
            let piesX = Math.floor(j.x + 17);
            
            let idVictima = null;
            let enemigoDebajo = null;

            // Buscar si caemos sobre alguien
            for (let idEnemigo in misJugadores) {
                if (idEnemigo === id) continue; 
                let otro = misJugadores[idEnemigo];
                if (otro.hp <= 0) continue;
                
                if (Math.abs(j.x - otro.x) < 28 && j.y >= otro.y - 22 && j.y <= otro.y - 5) {
                    enemigoDebajo = otro;
                    idVictima = idEnemigo;
                    break;
                }
            }

            // Aterrizaje
            if (velY > 0 && (verificarSuelo(piesX, j.y) || enemigoDebajo)) {
                if (enemigoDebajo) {
                    // Daño por STOMP (aplastar)
                    const danoStomp = Math.floor(velY * 3);
                    enemigoDebajo.hp -= danoStomp;
                    if (enemigoDebajo.hp < 0) enemigoDebajo.hp = 0;

                    crearTextoFlotante(enemigoDebajo.x + 17, enemigoDebajo.y - 25, `STOMP! -${danoStomp}`, "#ff00ff");
                    if (typeof activarShake === 'function') activarShake(15);

                    if (id === socket.id) {
                        socket.emit('registrar_impacto', { 
                            idEnemigo: idVictima, 
                            dano: danoStomp,
                            tipo: 'stomp' 
                        });
                    }
                    j.y = enemigoDebajo.y - 15;
                } else {
                    // Daño por caída fuerte al suelo
                    if (velY > 11) {
                        const danoSelf = Math.floor((velY - 11) * 5);
                        j.hp -= danoSelf;
                        crearTextoFlotante(j.x + 17, j.y - 20, `CRASH! -${danoSelf}`, "#ff4400");
                        if (id === socket.id) socket.emit('actualizar_hp', { hp: j.hp });
                    }
                    while (verificarSuelo(piesX, j.y - 1)) j.y--;
                }

                j.enSalto = false;
                if (id === socket.id) socket.emit('mover', { x: j.x, y: j.y });
                return;
            }

            if (j.enSalto && j.y < MUNDO.h + 50) {
                requestAnimationFrame(frameSalto);
            } else {
                j.enSalto = false;
            }
        }
        requestAnimationFrame(frameSalto);
    });
}