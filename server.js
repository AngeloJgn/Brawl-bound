/**
 * SERVER.JS - EL ÁRBITRO CENTRAL AUTORITARIO (OPEN TUNE 2026)
 * Optimizado para seguridad, pisotones, sincronización 4K y bajo lag.
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    pingTimeout: 30000,
    cors: { origin: "*" }
});

app.use(express.static(path.join(__dirname, 'public')));

// --- CONFIGURACIÓN DE BALANCEO 2026 ---
const SETTINGS = {
    TIEMPO_TURNO: 20,
    TIEMPO_ESCAPE: 3000,
    DANO_NORMAL: 90,
    DANO_ESPECIAL: 200,
    VIDA_MAXIMA: 1000,
    ESCUDO_MAXIMO: 500,
    PORT: process.env.PORT || 3000
};

let jugadores = {};
let turnoDe = null;
let juegoIniciado = false;
let proyectilEnVuelo = false;
let faseEscape = false;
let tiempoTurno = SETTINGS.TIEMPO_TURNO;
let intervaloTurno = null;

io.on('connection', (socket) => {
    console.log(`📡 PILOT_CONNECTED: ${socket.id}`);

    // --- ENTRADA AL LOBBY ---
    socket.on('entrar_al_lobby', (datos) => {
        if (juegoIniciado) return socket.emit('error_juego', 'SQUAD_IN_BATTLE');
        
        jugadores[socket.id] = {
            id: socket.id,
            nombre: datos.nombre?.substring(0, 12) || "GHOST_UNIT",
            listo: false,
            hp: SETTINGS.VIDA_MAXIMA,
            sp: SETTINGS.ESCUDO_MAXIMO,
            puntos: 0,
            x: Math.random() * 600 + 100,
            y: -50, // Caen desde arriba
            color: datos.color || "#00e5ff"
        };
        io.emit('actualizar_lobby', jugadores);
    });

    // --- GESTIÓN DE READY ---
    socket.on('jugador_listo', () => {
        if (!jugadores[socket.id]) return;
        jugadores[socket.id].listo = true;
        
        const lista = Object.values(jugadores);
        if (lista.every(j => j.listo) && lista.length >= 2) {
            iniciarPartida();
        } else {
            io.emit('actualizar_lobby', jugadores);
        }
    });

    function iniciarPartida() {
        if (juegoIniciado) return;
        juegoIniciado = true;
        
        let ids = Object.keys(jugadores);
        ids.sort(() => Math.random() - 0.5);
        
        ids.forEach((id, index) => {
            jugadores[id].x = (index * (650 / (ids.length - 1 || 1))) + 75;
            jugadores[id].y = -100; // Inicio táctico desde el cielo
            jugadores[id].hp = SETTINGS.VIDA_MAXIMA;
        });

        turnoDe = ids[0];
        io.emit('comenzar_juego', { jugadores, turnoDe });
        reiniciarTemporizador();
    }

    // --- MOVIMIENTO OPTIMIZADO ---
    socket.on('mover', (datos) => {
        const j = jugadores[socket.id];
        if (!j || j.hp <= 0) return;
        
        j.x = datos.x;
        j.y = datos.y;
        
        // Broadcast volátil para evitar lag y jitter en el propio jugador
        socket.broadcast.emit('actualizar_estado', { jugadores });
    });

    socket.on('saltar', () => {
        if (socket.id === turnoDe && !proyectilEnVuelo) {
            io.emit('jugador_salto', socket.id);
        }
    });

    socket.on('apuntando', (datos) => {
        if (jugadores[socket.id] && socket.id === turnoDe) {
            socket.broadcast.volatile.emit('enemigo_apuntando', {
                id: socket.id,
                angulo: datos.angulo,
                potencia: datos.potencia
            });
        }
    });

    // --- SISTEMA DE COMBATE AUTORITARIO ---
    socket.on('disparar', (datos) => {
        if (socket.id !== turnoDe || proyectilEnVuelo || faseEscape) return;

        proyectilEnVuelo = true;
        clearInterval(intervaloTurno); 

        io.emit('proyectil_disparado', {
            x: datos.x,
            y: datos.y,
            angulo: datos.angulo,
            potencia: datos.potencia,
            arma: datos.arma || 'normal',
            color: jugadores[socket.id].color,
            id: socket.id
        });
    });

    socket.on('registrar_impacto', (data) => {
        if (socket.id !== turnoDe) return; 

        // 1. Manejo de Pisotón (STOMP)
        if (data.tipo === 'stomp') {
            const victima = jugadores[data.idEnemigo];
            const atacante = jugadores[socket.id];
            if (victima && victima.hp > 0) {
                const damage = data.dano || 15; 
                victima.hp = Math.max(0, victima.hp - damage);
                if (atacante) atacante.puntos += 15; 
                io.emit('actualizar_estado', { jugadores });
                verificarFinDelJuego();
            }
            return;
        }

        // 2. Destrucción de Mapa
        io.emit('mapa_destruccion', {
            x: data.x,
            y: data.y,
            radio: data.radio || 30
        });

        // 3. Daño por proyectil
        const victima = jugadores[data.idEnemigo];
        if (victima && victima.hp > 0) {
            const damage = data.arma === 'especial' ? SETTINGS.DANO_ESPECIAL : SETTINGS.DANO_NORMAL;
            victima.hp = Math.max(0, victima.hp - damage);
            if (jugadores[socket.id]) jugadores[socket.id].puntos += 10;
            
            io.emit('actualizar_estado', { jugadores });
            verificarFinDelJuego();
        }
        
        // Sincronización forzada post-explosión
        setTimeout(() => {
            io.emit('sincronizar_posiciones', jugadores);
        }, 800);
    });

    socket.on('actualizar_hp', (data) => {
        if (jugadores[socket.id]) {
            jugadores[socket.id].hp = data.hp;
            io.emit('actualizar_estado', { jugadores });
            if (data.hp <= 0) verificarFinDelJuego(); 
        }
    });

    socket.on('finalizar_animacion', () => {
        if (socket.id === turnoDe && proyectilEnVuelo) {
            proyectilEnVuelo = false;
            faseEscape = true;
            io.emit('fase_escape');

            setTimeout(() => {
                faseEscape = false;
                pasarSiguienteTurno();
            }, SETTINGS.TIEMPO_ESCAPE);
        }
    });

    // --- LÓGICA DE TURNOS ---
    function pasarSiguienteTurno() {
        const vivos = Object.keys(jugadores).filter(id => jugadores[id].hp > 0);
        if (vivos.length < 2) {
            verificarFinDelJuego();
            return;
        }
        let currentIndex = vivos.indexOf(turnoDe);
        let nextIndex = (currentIndex + 1) % vivos.length;
        turnoDe = vivos[nextIndex];
        reiniciarTemporizador();
        io.emit('nuevo_turno', turnoDe);
    }

    function reiniciarTemporizador() {
        clearInterval(intervaloTurno);
        tiempoTurno = SETTINGS.TIEMPO_TURNO;
        io.emit('tick_tiempo', tiempoTurno);
        intervaloTurno = setInterval(() => {
            if (!proyectilEnVuelo && !faseEscape) {
                tiempoTurno--;
                io.emit('tick_tiempo', tiempoTurno);
                if (tiempoTurno <= 0) {
                    clearInterval(intervaloTurno);
                    pasarSiguienteTurno();
                }
            }
        }, 1000);
    }

    function verificarFinDelJuego() {
        const vivos = Object.values(jugadores).filter(j => j.hp > 0);
        if (vivos.length === 1 && juegoIniciado) {
            io.emit('victoria', { ganador: vivos[0].nombre });
            juegoIniciado = false;
            clearInterval(intervaloTurno);
            Object.values(jugadores).forEach(j => j.listo = false);
        }
    }

    socket.on('disconnect', () => {
        console.log(`❌ PILOT_OFFLINE: ${socket.id}`);
        const eraSuTurno = (socket.id === turnoDe);
        delete jugadores[socket.id];
        
        if (Object.keys(jugadores).length < 2) {
            juegoIniciado = false;
            clearInterval(intervaloTurno);
        } else if (eraSuTurno) {
            pasarSiguienteTurno();
        }
        io.emit('actualizar_lobby', jugadores);
    });
});

// --- INICIO DE SERVIDOR (CONFIGURADO PARA RENDER) ---
server.listen(SETTINGS.PORT, '0.0.0.0', () => {
    console.log(`\n--- BRAWL-BOUND: WILD EDITION 2026 ---`);
    console.log(`🚀 NEURAL_LINK_ACTIVE: PORT ${SETTINGS.PORT}`);
    console.log(`--------------------------------------\n`);
});