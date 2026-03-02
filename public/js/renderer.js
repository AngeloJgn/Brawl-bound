/**
 * RENDERER.JS - VERSIÓN 4K ULTRA-SHARP (OPTIMIZADA)
 * Sistema de Bitmask de Colisiones y Renderizado de Alto Rendimiento.
 */

const canvas = document.getElementById('mundo');
const ctx = canvas.getContext('2d', { alpha: false }); // Optimización: sin canal alpha en el canvas principal

const tierraCanvas = document.createElement('canvas');
const tierraCtx = tierraCanvas.getContext('2d', { willReadFrequently: true });

window.particulasImpacto = [];//particulas de caida
window.intensidadShake = 0;//tiemble de pantalla
window.textosFlotantes = [];//numeritos de daño

//TEXTURAS DE TERRENO

const texCesped = new Image();
const texTierra = new Image();
const texRoca = new Image();

// CONSTANTES UNIFICADAS
const MUNDO = { 
    w: 1280, 
    h: 720, 
    g: 0.25,      
    dt: 1.5,      
    vFuerza: 0.15 
};

function cargarTexturasMapa() {
    texCesped.src = 'assets/grass_tex.jpg';
    texTierra.src = 'assets/dirt_tex.jpg';
    texRoca.src = 'assets/rock_tex.jpg';
}

let mousePosJuego = { x: 0, y: 0 };
let mapaCargado = false;
let fondoListo = false;
const imgMapa = new Image();
const imgFondo = new Image();

// BITMASK DE COLISIONES (Memoria de acceso ultra rápido)
let mapaColisiones = new Uint8Array(MUNDO.w * MUNDO.h);

// --- CARGA Y PROCESAMIENTO ---
function cargarRecursos() {
    imgFondo.src = 'assets/fondo2.jpg'; //////////////////////////////
    imgFondo.onload = () => { fondoListo = true; };

    imgMapa.src = 'assets/alpa.png'; //////////////////////////////
    imgMapa.onload = () => {
        tierraCanvas.width = MUNDO.w;
        tierraCanvas.height = MUNDO.h;
        tierraCtx.drawImage(imgMapa, 0, 0, MUNDO.w, MUNDO.h);
        generarBitmaskSuelo();
        mapaCargado = true;
    };
    imgMapa.onerror = () => {
        tierraCanvas.width = MUNDO.w;
        tierraCanvas.height = MUNDO.h;
        tierraCtx.fillStyle = "#1a1c2c";
        tierraCtx.fillRect(0, 300, MUNDO.w, 100);
        generarBitmaskSuelo();
        mapaCargado = true;
    };
}

function generarBitmaskSuelo() {
    const data = tierraCtx.getImageData(0, 0, MUNDO.w, MUNDO.h).data;
    for (let i = 0; i < data.length; i += 4) {
        // Guardamos 1 si el alpha es > 120, de lo contrario 0
        mapaColisiones[i / 4] = data[i + 3] > 120 ? 1 : 0;
    }
}

// --- FÍSICA DE ENTORNO (OPTIMIZADA CON BITMASK) ---
function verificarSuelo(x, y) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || ix >= MUNDO.w || iy < 0 || iy >= MUNDO.h) return false;
    // Acceso O(1) a memoria RAM
    return mapaColisiones[iy * MUNDO.w + ix] === 1;
}

// --- FÍSICA DE ENTORNO (MODIFICADA: Menos agresiva) ---
function aplicarFisicaEntorno() {
    if (typeof misJugadores === 'undefined' || window.animacionActiva) return;
    
    for (let id in misJugadores) {
        let j = misJugadores[id];
        
        // No aplicamos física si está muerto o saltando (el salto tiene su propio motor)
        if (j.hp <= 0 || j.enSalto) continue;

        let piesX = Math.floor(j.x + 17);
        let piesY = Math.floor(j.y);

        // 1. CAÍDA: Si no hay suelo bajo los pies, el tanque DEBE caer.
        // Esto se aplica a TODOS (locales y enemigos) para que nadie levite.
        if (!verificarSuelo(piesX, piesY)) {
            j.y += 3.5; 

            // 2. SINCRONIZACIÓN: Solo el dueño informa al servidor que está cayendo.
            // Usamos un limitador para no saturar el socket (solo enviamos si la caída es real)
            if (id === socket.id) {
                // Enviamos la nueva posición para que los demás sepan que caímos
                socket.emit('mover', { x: j.x, y: j.y });
            }
        } else {
            // 3. ESTABILIZACIÓN: Si toca suelo, corregimos si está "enterrado".
            // Esto evita que el tanque vibre o se hunda en el bitmask.
            let correccion = 0;
            while (verificarSuelo(piesX, j.y - 1) && correccion < 10) {
                j.y--;
                correccion++;
            }
            
            // Si hubo una corrección importante de suelo, el dueño avisa su posición final estable
            if (id === socket.id && correccion > 0) {
                socket.emit('mover', { x: j.x, y: j.y });
            }
        }
    }
}

//particulas de caida

function crearPolvoAterrizaje(x, y, color) {
    for (let i = 0; i < 8; i++) {
        window.particulasImpacto.push({
            x: x,
            y: y,
            vx: (Math.random() - 0.5) * 4, // Dispersión horizontal
            vy: (Math.random() - 2),       // Salto hacia arriba
            vida: 1.0,                     // Opacidad inicial
            color: color || "#555"
        });
    }
}

// Llama a esto dentro de tu loop() principal de dibujo
function dibujarParticulas(ctx) {
    for (let i = window.particulasImpacto.length - 1; i >= 0; i--) {
        let p = window.particulasImpacto[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vida -= 0.02; // Se desvanecen poco a poco

        if (p.vida <= 0) {
            window.particulasImpacto.splice(i, 1);
            continue;
        }

        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.vida;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2 * p.vida, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1.0;
}

function activarShake(fuerza) {
    window.intensidadShake = fuerza;
}

//////////Texto de daño flotante//////////////////////

function crearTextoFlotante(x, y, texto, color = "#ff3d00") {
    window.textosFlotantes.push({
        x: x,
        y: y,
        texto: texto,
        vida: 1.0, // Opacidad de 1 a 0
        vy: -1.5,  // Velocidad hacia arriba
        color: color
    });
}

// Llama a esto dentro de tu dibujarEscena() justo antes del ctx.restore()
function dibujarTextosFlotantes(ctx) {
    ctx.save();
    ctx.font = "bold 20px 'Rajdhani', sans-serif";
    ctx.textAlign = "center";

    for (let i = window.textosFlotantes.length - 1; i >= 0; i--) {
        let t = window.textosFlotantes[i];
        t.y += t.vy;
        t.vida -= 0.015;

        if (t.vida <= 0) {
            window.textosFlotantes.splice(i, 1);
            continue;
        }

        ctx.globalAlpha = t.vida;
        ctx.fillStyle = "black"; // Sombra para legibilidad
        ctx.fillText(t.texto, t.x + 2, t.y + 2);
        ctx.fillStyle = t.color;
        ctx.fillText(t.texto, t.x, t.y);
    }
    ctx.restore();
}
////////////////////////////////////////////////////

//DIBUJAR TERRENO

function dibujarTerrenoTexturizado() {
    // 1. Dibujamos en un canvas temporal o directamente si el fondo es transparente
    // Primero la TIERRA (fondo del terreno)
    const patternTierra = ctx.createPattern(texTierra, 'repeat');
    ctx.save();
    
    // Dibujamos la textura de tierra solo donde hay "forma" de mapa
    ctx.globalCompositeOperation = 'source-over'; 
    ctx.drawImage(tierraCanvas, 0, 0); // Dibujamos la máscara (lo que ya tienes)
    
    ctx.globalCompositeOperation = 'source-in'; // Magia: solo dibuja donde hay píxeles previos
    ctx.fillStyle = patternTierra;
    ctx.fillRect(0, 0, MUNDO.w, MUNDO.h);
    
    // 2. EL BORDE DE CÉSPED (Efecto de contorno)
    // Usamos 'source-atop' para dibujar el césped solo en la parte superior
    ctx.globalCompositeOperation = 'source-atop';
    const patternCesped = ctx.createPattern(texCesped, 'repeat');
    ctx.strokeStyle = patternCesped;
    ctx.lineWidth = 15; // Grosor del césped en los bordes
    ctx.stroke(); // Esto dibujará césped en todo el contorno del mapa destructible
    
    ctx.restore();
}

function respawnJugador(j) {
    if (j.id === socket.id) {
        const newX = Math.random() * (MUNDO.w - 200) + 100;
        socket.emit('player_respawn', { x: newX, y: 0 });
    }
}

// --- DIBUJAR ESCENA (Mejorado para traslados suaves) ---
function dibujarEscena() {
    if (!ctx) return; // Validación básica de contexto
    
    ctx.save();
    
    // 1. Aplicar el temblor (Shake)
    if (window.intensidadShake > 0) {
        const sx = (Math.random() - 0.5) * window.intensidadShake;
        const sy = (Math.random() - 0.5) * window.intensidadShake;
        ctx.translate(sx, sy);
        window.intensidadShake *= 0.9; 
        if (window.intensidadShake < 0.1) window.intensidadShake = 0;
    }

    // 2. Validación de carga (Movemos el restore aquí abajo para seguridad)
    if (!mapaCargado) {
        ctx.restore();
        return;
    }
    
    // 3. Dibujo del Fondo
    if (fondoListo) {
        ctx.drawImage(imgFondo, 0, 0, MUNDO.w, MUNDO.h);
    } else { 
        ctx.fillStyle = "#05070a"; 
        ctx.fillRect(0, 0, MUNDO.w, MUNDO.h); 
    }

    // 4. Dibujo del Terreno
    ctx.drawImage(tierraCanvas, 0, 0, MUNDO.w, MUNDO.h);
    
    aplicarFisicaEntorno();
    
    // 5. Dibujo y Lerp de Jugadores
    if (typeof misJugadores !== 'undefined') {
        for (let id in misJugadores) {
            const j = misJugadores[id];
            
            if (j.renderX === undefined) { 
                j.renderX = j.x; 
                j.renderY = j.y; 
            }

            let lerpFactor = 0.12; 
            
            if (Math.hypot(j.x - j.renderX, j.y - j.renderY) > 60) {
                j.renderX = j.x;
                j.renderY = j.y;
            } else {
                j.renderX += (j.x - j.renderX) * lerpFactor;
                j.renderY += (j.y - j.renderY) * lerpFactor;
            }

            dibujarTanqueHD(j, (id === ultimoEstadoTurno), (id === socket.id));
        }
    }

    // 6. Proyectiles y Partículas de Polvo
    if (window.dibujarProyectilesGlobal) window.dibujarProyectilesGlobal(ctx);
    
    // IMPORTANTE: Dibujar partículas antes del restore para que el shake también las mueva
    if (typeof dibujarParticulas === 'function') {
        dibujarParticulas(ctx); 
    }
    
    dibujarTextosFlotantes(ctx);
    ctx.restore(); // <--- Ahora siempre se ejecuta, pase lo que pase
}

function dibujarTanqueHD(j, esTurno, esMio) {
    if (j.hp <= 0) return;
    ctx.save();

    // --- 1. AURA EXCLUSIVA (Solo para ti en tu turno) ---
    if (esTurno && esMio) {
        const tiempo = Date.now() * 0.005;
        const pulso = Math.sin(tiempo) * 10 + 30; 
        const gradAura = ctx.createRadialGradient(j.renderX + 17, j.renderY - 7, 0, j.renderX + 17, j.renderY - 7, pulso);
        gradAura.addColorStop(0, "rgba(0, 229, 255, 0.5)");
        gradAura.addColorStop(0.7, "rgba(0, 229, 255, 0.1)");
        gradAura.addColorStop(1, "transparent");
        ctx.fillStyle = gradAura;
        ctx.beginPath();
        ctx.arc(j.renderX + 17, j.renderY - 7, pulso, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(0, 229, 255, 0.8)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(j.renderX + 17, j.renderY - 7, pulso - 2, 0, Math.PI * 2);
        ctx.stroke();
    }

    // --- 2. CUERPO DEL TANQUE ---
    const gradTanque = ctx.createLinearGradient(j.renderX, j.renderY - 14, j.renderX, j.renderY);
    gradTanque.addColorStop(0, j.color);
    gradTanque.addColorStop(1, "#000000");
    ctx.fillStyle = gradTanque;
    ctx.beginPath();
    ctx.roundRect(j.renderX, j.renderY - 14, 34, 15, [3, 3, 0, 0]);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(j.renderX + 17, j.renderY - 14, 9, 0, Math.PI, true);
    ctx.fill();

    // --- 3. GESTIÓN DE FLECHAS Y TURNOS ---
    if (esTurno && !window.animacionActiva) {
        // Indicador flotante (Triangulito)
        const bounce = Math.sin(Date.now() * 0.008) * 4;
        ctx.fillStyle = esMio ? "#00e5ff" : j.color; // Color cian para ti, color del tanque para otros
        ctx.beginPath();
        ctx.moveTo(j.renderX + 12, j.renderY - 38 + bounce);
        ctx.lineTo(j.renderX + 22, j.renderY - 38 + bounce);
        ctx.lineTo(j.renderX + 17, j.renderY - 28 + bounce);
        ctx.fill();

        // --- CORRECCIÓN AQUÍ ---
        if (esMio) {
            // Si soy yo, calculo con mi mouse actual
            dibujarGuiaParabolica(j, mousePosJuego.x, mousePosJuego.y);
        } else if (j.remoteAngulo !== undefined) {
            // Si es enemigo, usamos la función auxiliar para dibujar con datos fijos de red
            dibujarGuiaRemota(j); 
        }
    }
    
    ctx.restore();
    dibujarUIJugador(j);
}

// NUEVA FUNCIÓN AUXILIAR: Para dibujar la flecha del enemigo sin usar el mouse
function dibujarGuiaRemota(j) {
    // 1. Verificación de datos de red
    if (j.remoteAngulo === undefined || j.remotePotencia === undefined) return;
    if (j.remotePotencia < 5) return;

    const startX = j.renderX + 17;
    const startY = j.renderY - 15;
    
    ctx.save();
    ctx.translate(startX, startY);
    ctx.rotate(j.remoteAngulo);

    // 2. Dimensiones idénticas a tu original
    const L = 15 + (j.remotePotencia * 0.9);
    const H = 3 + (j.remotePotencia * 0.05);
    
    // 3. COLOR EQUILIBRADO: 
    // Si quieres que el color sea EXACTAMENTE igual (Cian a Rojo), usa la línea de abajo.
    // Si prefieres que brille igual pero con el color del tanque, avísame.
    const hue = 190 - (j.remotePotencia * 1.9); 
    const colorCarga = `hsl(${hue}, 100%, 50%)`;

    // 4. Estilo de Borde y Brillo (Shadow)
    ctx.shadowBlur = 8;
    ctx.shadowColor = colorCarga;
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1;
    dibujarPathFlecha(ctx, L, H);
    ctx.stroke();

    // 5. Gradiente de Relleno (Efecto Cristal/Neón)
    const grad = ctx.createLinearGradient(0, 0, L, 0);
    grad.addColorStop(0, "rgba(255, 255, 255, 0.1)");
    grad.addColorStop(0.6, colorCarga);
    grad.addColorStop(1, "#fff"); 
    
    ctx.fillStyle = grad;
    // Animación de parpadeo idéntica
    ctx.globalAlpha = 0.8 + Math.sin(Date.now() * 0.01) * 0.2; 
    dibujarPathFlecha(ctx, L, H);
    ctx.fill();

    // 6. Detalles estéticos: Líneas de "Carga" internas
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.lineWidth = 0.8;
    for(let i = 6; i < L - 8; i += 10) {
        ctx.beginPath();
        ctx.moveTo(i, -H/2);
        ctx.lineTo(i, H/2);
        ctx.stroke();
    }

    ctx.restore();
}

function dibujarGuiaParabolica(j) {
    const startX = j.renderX + 17;
    const startY = j.renderY - 15;
    
    const dx = mousePosJuego.x - startX;
    const dy = mousePosJuego.y - startY;
    const anguloRad = Math.atan2(dy, dx);
    const potenciaReal = Math.min(Math.sqrt(dx*dx + dy*dy) / 2, 100);

    if (potenciaReal < 5) return;

    ctx.save();
    ctx.translate(startX, startY);
    ctx.rotate(anguloRad);

    const L = 15 + (potenciaReal * 0.9);
    const H = 3 + (potenciaReal * 0.05);
    const hue = 190 - (potenciaReal * 1.9); 
    const colorCarga = `hsl(${hue}, 100%, 50%)`;

    ctx.shadowBlur = 8;
    ctx.shadowColor = colorCarga;
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1;
    dibujarPathFlecha(ctx, L, H);
    ctx.stroke();

    const grad = ctx.createLinearGradient(0, 0, L, 0);
    grad.addColorStop(0, "rgba(255, 255, 255, 0.1)");
    grad.addColorStop(0.6, colorCarga);
    grad.addColorStop(1, "#fff"); 
    
    ctx.fillStyle = grad;
    ctx.globalAlpha = 0.8 + Math.sin(Date.now() * 0.01) * 0.2; 
    dibujarPathFlecha(ctx, L, H);
    ctx.fill();

// 4. Detalles estéticos: Líneas de "Carga" internas reducidas y espaciadas
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.lineWidth = 0.8; // Antes: 1
    for(let i = 6; i < L - 8; i += 10) { // Ajustado el espaciado
        ctx.beginPath();
        ctx.moveTo(i, -H/2);
        ctx.lineTo(i, H/2);
        ctx.stroke();
    }
//
    ctx.restore();
}

function dibujarPathFlecha(c, l, h) {
    const widthFactor = 3; // La punta será 1.5 veces más ancha que la base

     // Calculamos el grosor en la base y en la punta
    const baseH = h;
    const puntaH = h * widthFactor;

    // Calculamos la longitud de la cabeza de la flecha
    const puntaL = l * 0.1; // La cabeza de la flecha ocupará el 40% de la longitud total

    c.beginPath();
    // Punto de inicio en la base superior
    c.moveTo(0, -baseH / 2);

    // Cuerpo (Trapecio)
    // Línea superior hasta el inicio de la cabeza de la flecha
    //c.lineTo(l - puntaL, -baseH / 2);
    c.lineTo(l - puntaL, -puntaH / 2);
    c.lineTo(l, 0);
    c.lineTo(l - puntaL, puntaH / 2);
    //
    c.lineTo(0, baseH / 2);
    //c.lineTo(l - puntaL, baseH / 2);
    c.closePath();
}

function dibujarUIJugador(j) {
    ctx.save();
    ctx.font = "900 11px 'Orbitron'";
    ctx.textAlign = "center";
    ctx.fillStyle = "white";
    ctx.fillText(j.nombre.toUpperCase(), j.renderX + 17, j.renderY + 22);

    // --- CONFIGURACIÓN DE BARRA ---
    const VIDA_MAX_REF = 1000; // Debe coincidir con tu SETTINGS.VIDA_MAXIMA del server
    const bx = j.renderX, by = j.renderY - 26, bw = 34, bh = 4;

    // Fondo de la barra
    ctx.fillStyle = "rgba(0,0,0,0.8)";
    ctx.fillRect(bx, by, bw, bh);

    // Cálculo de porcentaje real (0.0 a 1.0)
    const porcentajeVida = Math.max(0, j.hp / VIDA_MAX_REF);

    // Lógica de color: cambia a rojo si queda menos del 30% (300 HP)
    const esCritico = porcentajeVida < 0.3;
    const hpColor = esCritico ? "#ff3d00" : (j.id === socket.id ? "#00e5ff" : "#76ff03");
    
    ctx.fillStyle = hpColor;
    
    // Dibujamos el ancho proporcional al porcentaje, limitado por el ancho total (bw)
    ctx.fillRect(bx, by, bw * porcentajeVida, bh);
    
    ctx.restore();
}

// --- CONFIGURACIÓN DE PANTALLA & INPUTS ---

function configurarHD() {
    const dpr = window.devicePixelRatio || 1;
    const dw = window.innerWidth;
    const dh = window.innerHeight;

    // 1. Mantener la relación de aspecto (Ratio 2:1 para 800x400)
    const ratioMundo = MUNDO.w / MUNDO.h;
    const ratioVentana = dw / dh;

    let anchoVisual, altoVisual;

    if (ratioVentana > ratioMundo) {
        altoVisual = dh;
        anchoVisual = dh * ratioMundo;
    } else {
        anchoVisual = dw;
        altoVisual = dw / ratioMundo;
    }

    // 2. Aplicamos el tamaño al CSS (lo que ocupa en pantalla)
    canvas.style.width = anchoVisual + 'px';
    canvas.style.height = altoVisual + 'px';

    // 3. EL EQUILIBRIO: Resolución interna dinámica
    // En lugar de MUNDO.w, usamos el ancho visual real multiplicado por DPR
    // Esto hace que el canvas tenga tantos píxeles como la pantalla pueda mostrar.
    canvas.width = anchoVisual * dpr;
    canvas.height = altoVisual * dpr;

    // 4. Ajuste del Contexto
    // Calculamos la escala necesaria para que tus coordenadas (0-800, 0-400)
    // sigan funcionando perfectamente sobre esta nueva resolución ultra-nítida.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const escalaX = (anchoVisual * dpr) / MUNDO.w;
    const escalaY = (altoVisual * dpr) / MUNDO.h;
    ctx.scale(escalaX, escalaY);
}

canvas.addEventListener('mousemove', (e) => {
    // 1. Actualizamos la posición del mouse para el dibujo local (Esto ya lo tenías)
    const rect = canvas.getBoundingClientRect();
    mousePosJuego.x = (e.clientX - rect.left) * (MUNDO.w / rect.width);
    mousePosJuego.y = (e.clientY - rect.top) * (MUNDO.h / rect.height);

    // 2. NUEVO: Si es mi turno, enviamos el ángulo y potencia al servidor
    // Usamos una pequeña validación para no saturar el servidor con miles de mensajes
    if (typeof socket !== 'undefined' && window.ultimoEstadoTurno === socket.id && !window.animacionActiva) {
        const miTanque = window.misJugadores[socket.id];
        if (miTanque) {
            const startX = miTanque.x + 17;
            const startY = miTanque.y - 15;
            
            const dx = mousePosJuego.x - startX;
            const dy = mousePosJuego.y - startY;
            
            const angulo = Math.atan2(dy, dx);
            const potencia = Math.min(Math.sqrt(dx*dx + dy*dy) / 2, 100);

            // Emitimos el evento 'apuntando'
            socket.emit('apuntando', { angulo, potencia });
        }
    }
});

canvas.addEventListener('mousedown', (e) => {
    if (typeof ultimoEstadoTurno !== 'undefined' && ultimoEstadoTurno === socket.id) {
        const startX = misJugadores[socket.id].x + 17;
        const startY = misJugadores[socket.id].y - 15;
        const dx = mousePosJuego.x - startX;
        const dy = mousePosJuego.y - startY;
        const angulo = Math.atan2(dy, dx);
        const potencia = Math.min(Math.sqrt(dx*dx + dy*dy) / 2, 100);
        
        if (potencia > 5 && typeof enviarDisparo === 'function') {
            enviarDisparo(angulo, potencia);
        }
    }
});

function loop() {
    procesarMovimientoContinuo(); // <--- Añade esto aquí
    dibujarEscena();
    requestAnimationFrame(loop);
}

// Eventos de inicio corregidos
window.addEventListener('load', () => {
    configurarHD();
    cargarRecursos(); 
    requestAnimationFrame(loop);
});

window.addEventListener('resize', () => {
    // Pequeño debounce para evitar parpadeos al redimensionar
    configurarHD();
});