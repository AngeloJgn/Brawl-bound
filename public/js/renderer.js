/**
 * RENDERER.JS - VERSIÓN CONSOLIDADA (OPEN TUNE 2026)
 * Optimizaciones: Interpolación LERP, Bitmask O(1), UI Adaptativa 4K.
 */

const canvas = document.getElementById('mundo');
const ctx = canvas.getContext('2d', { alpha: false }); 

// Canvas secundario para el terreno (Bitmask)
const tierraCanvas = document.createElement('canvas');
const tierraCtx = tierraCanvas.getContext('2d', { willReadFrequently: true });

// Variables Globales de Efectos
window.particulasImpacto = [];
window.intensidadShake = 0;
window.textosFlotantes = [];

// Texturas del Terreno
const texCesped = new Image();
const texTierra = new Image();
const texRoca = new Image();

// CONSTANTES DEL MUNDO (Sincronizadas)
const MUNDO = { 
    w: 1280, 
    h: 720, 
    g: 0.25,      
    dt: 1.5,      
    vFuerza: 0.15 
};

// --- CARGA DE ASSETS ---
function cargarRecursos() {
    imgFondo.src = 'assets/fondo2.jpg';
    imgFondo.onload = () => { fondoListo = true; };

    imgMapa.src = 'assets/alpa.png';
    imgMapa.onload = () => {
        tierraCanvas.width = MUNDO.w;
        tierraCanvas.height = MUNDO.h;
        tierraCtx.drawImage(imgMapa, 0, 0, MUNDO.w, MUNDO.h);
        generarBitmaskSuelo();
        mapaCargado = true;
    };
    
    // Carga de texturas para el dibujado con patrones
    texCesped.src = 'assets/grass_tex.jpg';
    texTierra.src = 'assets/dirt_tex.jpg';
    texRoca.src = 'assets/rock_tex.jpg';
}

let mousePosJuego = { x: 0, y: 0 };
let mapaCargado = false;
let fondoListo = false;
const imgMapa = new Image();
const imgFondo = new Image();

// BITMASK: Memoria ultra-rápida para colisiones
let mapaColisiones = new Uint8Array(MUNDO.w * MUNDO.h);

function generarBitmaskSuelo() {
    const data = tierraCtx.getImageData(0, 0, MUNDO.w, MUNDO.h).data;
    for (let i = 0; i < data.length; i += 4) {
        mapaColisiones[i / 4] = data[i + 3] > 120 ? 1 : 0;
    }
}

// --- UTILIDADES DE COLISIÓN ---
function verificarSuelo(x, y) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || ix >= MUNDO.w || iy < 0 || iy >= MUNDO.h) return false;
    return mapaColisiones[iy * MUNDO.w + ix] === 1;
}

// --- SISTEMA DE RENDERIZADO (LOOP PRINCIPAL) ---
function dibujarEscena() {
    if (!ctx || !mapaCargado) return;
    
    ctx.save();
    
    // 1. Efecto Shake (Tiemblo de pantalla)
    if (window.intensidadShake > 0) {
        const sx = (Math.random() - 0.5) * window.intensidadShake;
        const sy = (Math.random() - 0.5) * window.intensidadShake;
        ctx.translate(sx, sy);
        window.intensidadShake *= 0.9; 
        if (window.intensidadShake < 0.1) window.intensidadShake = 0;
    }

    // 2. Dibujo del Fondo y Terreno
    if (fondoListo) {
        ctx.drawImage(imgFondo, 0, 0, MUNDO.w, MUNDO.h);
    } else { 
        ctx.fillStyle = "#05070a"; 
        ctx.fillRect(0, 0, MUNDO.w, MUNDO.h); 
    }

    // Dibujamos el terreno (el bitmask visual)
    ctx.drawImage(tierraCanvas, 0, 0, MUNDO.w, MUNDO.h);
    
    // 3. Lógica de Interpolación (LERP) para jugadores
    if (typeof misJugadores !== 'undefined') {
        for (let id in misJugadores) {
            const j = misJugadores[id];
            
            // Si es la primera vez que vemos al jugador, inicializamos su renderX
            if (j.renderX === undefined) { 
                j.renderX = j.x; 
                j.renderY = j.y; 
            }

            // Factor de suavizado (0.12 es ideal para 60fps)
            let lerpFactor = 0.12; 
            
            // Si la distancia es muy grande (teletransportación), no interpolamos
            if (Math.hypot(j.x - j.renderX, j.y - j.renderY) > 80) {
                j.renderX = j.x;
                j.renderY = j.y;
            } else {
                j.renderX += (j.x - j.renderX) * lerpFactor;
                j.renderY += (j.y - j.renderY) * lerpFactor;
            }

            dibujarTanqueHD(j, (id === ultimoEstadoTurno), (id === socket.id));
        }
    }

    // 4. Elementos Dinámicos (Proyectiles, Partículas, Daño)
    if (window.dibujarProyectilesGlobal) window.dibujarProyectilesGlobal(ctx);
    dibujarParticulas(ctx);
    dibujarTextosFlotantes(ctx);

    ctx.restore();
}

// --- DIBUJO DE TANQUES ---
function dibujarTanqueHD(j, esTurno, esMio) {
    if (j.hp <= 0) return;
    ctx.save();

    // Aura de turno (Efecto neón)
    if (esTurno && esMio) {
        const pulso = Math.sin(Date.now() * 0.005) * 8 + 25; 
        const gradAura = ctx.createRadialGradient(j.renderX + 17, j.renderY - 7, 0, j.renderX + 17, j.renderY - 7, pulso);
        gradAura.addColorStop(0, j.color + "88");
        gradAura.addColorStop(1, "transparent");
        ctx.fillStyle = gradAura;
        ctx.beginPath();
        ctx.arc(j.renderX + 17, j.renderY - 7, pulso, 0, Math.PI * 2);
        ctx.fill();
    }

    // Cuerpo del Tanque
    const gradTanque = ctx.createLinearGradient(j.renderX, j.renderY - 14, j.renderX, j.renderY);
    gradTanque.addColorStop(0, j.color);
    gradTanque.addColorStop(1, "#000");
    ctx.fillStyle = gradTanque;
    
    // Base
    ctx.beginPath();
    ctx.roundRect(j.renderX, j.renderY - 14, 34, 15, [3, 3, 0, 0]);
    ctx.fill();
    
    // Cabina
    ctx.beginPath();
    ctx.arc(j.renderX + 17, j.renderY - 14, 9, 0, Math.PI, true);
    ctx.fill();

    // Guía de disparo
    if (esTurno && !window.animacionActiva) {
        if (esMio) {
            dibujarGuiaParabolica(j);
        } else if (j.remoteAngulo !== undefined) {
            dibujarGuiaRemota(j); 
        }
    }
    
    ctx.restore();
    dibujarUIJugador(j);
}

// --- GUÍAS DE DISPARO (LOCALE Y REMOTA) ---
function dibujarGuiaParabolica(j) {
    const startX = j.renderX + 17;
    const startY = j.renderY - 15;
    const dx = mousePosJuego.x - startX;
    const dy = mousePosJuego.y - startY;
    const angulo = Math.atan2(dy, dx);
    const potencia = Math.min(Math.sqrt(dx*dx + dy*dy) / 2, 100);
    renderizarFlecha(startX, startY, angulo, potencia);
}

function dibujarGuiaRemota(j) {
    const startX = j.renderX + 17;
    const startY = j.renderY - 15;
    renderizarFlecha(startX, startY, j.remoteAngulo, j.remotePotencia);
}

function renderizarFlecha(x, y, ang, pot) {
    if (pot < 5) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);

    const L = 15 + (pot * 0.9);
    const H = 3 + (pot * 0.05);
    const hue = 190 - (pot * 1.9); 
    const color = `hsl(${hue}, 100%, 50%)`;

    ctx.shadowBlur = 10;
    ctx.shadowColor = color;
    
    const grad = ctx.createLinearGradient(0, 0, L, 0);
    grad.addColorStop(0, "rgba(255,255,255,0.2)");
    grad.addColorStop(1, color);
    
    ctx.fillStyle = grad;
    dibujarPathFlecha(ctx, L, H);
    ctx.fill();
    ctx.restore();
}

function dibujarPathFlecha(c, l, h) {
    const pL = l * 0.2; // Cabeza de flecha
    const pH = h * 2.5; // Ancho cabeza
    c.beginPath();
    c.moveTo(0, -h/2);
    c.lineTo(l - pL, -h/2);
    c.lineTo(l - pL, -pH/2);
    c.lineTo(l, 0);
    c.lineTo(l - pL, pH/2);
    c.lineTo(l - pL, h/2);
    c.lineTo(0, h/2);
    c.closePath();
}

// --- UI SOBRE EL JUGADOR ---
function dibujarUIJugador(j) {
    ctx.save();
    ctx.font = "900 11px 'Orbitron'";
    ctx.textAlign = "center";
    ctx.fillStyle = "white";
    ctx.fillText(j.nombre.toUpperCase(), j.renderX + 17, j.renderY + 22);

    // Barra de Vida
    const bx = j.renderX, by = j.renderY - 26, bw = 34, bh = 4;
    ctx.fillStyle = "rgba(0,0,0,0.8)";
    ctx.fillRect(bx, by, bw, bh);

    const porcentajeVida = Math.max(0, j.hp / 1000);
    ctx.fillStyle = porcentajeVida < 0.3 ? "#ff3d00" : (j.id === socket.id ? "#00e5ff" : "#76ff03");
    ctx.fillRect(bx, by, bw * porcentajeVida, bh);
    ctx.restore();
}

// --- CONFIGURACIÓN TÉCNICA (4K / RESIZE) ---
function configurarHD() {
    const dpr = window.devicePixelRatio || 1;
    const dw = window.innerWidth;
    const dh = window.innerHeight;
    const ratioMundo = MUNDO.w / MUNDO.h;
    
    let anchoVisual = dw, altoVisual = dw / ratioMundo;
    if (dw / dh > ratioMundo) {
        altoVisual = dh;
        anchoVisual = dh * ratioMundo;
    }

    canvas.style.width = anchoVisual + 'px';
    canvas.style.height = altoVisual + 'px';
    canvas.width = anchoVisual * dpr;
    canvas.height = altoVisual * dpr;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale((anchoVisual * dpr) / MUNDO.w, (altoVisual * dpr) / MUNDO.h);
}

// --- INPUTS ---
canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    mousePosJuego.x = (e.clientX - rect.left) * (MUNDO.w / rect.width);
    mousePosJuego.y = (e.clientY - rect.top) * (MUNDO.h / rect.height);

    // Sincronización de apuntado (Para que otros vean hacia donde miras)
    if (typeof socket !== 'undefined' && window.ultimoEstadoTurno === socket.id && !window.animacionActiva) {
        const j = window.misJugadores[socket.id];
        if (j) {
            const dx = mousePosJuego.x - (j.x + 17);
            const dy = mousePosJuego.y - (j.y - 15);
            socket.emit('apuntando', { 
                angulo: Math.atan2(dy, dx), 
                potencia: Math.min(Math.sqrt(dx*dx + dy*dy) / 2, 100) 
            });
        }
    }
});

// --- LOOP ---
function loop() {
    if (typeof aplicarFisicaEntorno === 'function') aplicarFisicaEntorno();
    dibujarEscena();
    requestAnimationFrame(loop);
}

window.addEventListener('load', () => {
    configurarHD();
    cargarRecursos(); 
    requestAnimationFrame(loop);
});

window.addEventListener('resize', configurarHD);