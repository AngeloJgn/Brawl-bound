/**
 * SERVER.JS - EL ÁRBITRO CENTRAL AUTORITARIO
 * Optimizado para seguridad, validación de daño y sincronización 4K.
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    pingTimeout: 30000,
    cors: { origin: "*" }
});

app.use(express.static('public'));

// CONFIGURACIÓN DE BALANCEO
const SETTINGS = {
    TIEMPO_TURNO: 20,
    TIEMPO_ESCAPE: 3000,
    DANO_NORMAL: 90,
    DANO_ESPECIAL: 200,
    VIDA_MAXIMA: 1000,   // <--- Nueva vida base
    ESCUDO_MAXIMO: 500, // El escudo es la mitad de la vida
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
            hp: SETTINGS.VIDA_MAXIMA, // Usa la constante
            sp: SETTINGS.ESCUDO_MAXIMO, // SP = Shield Points
            puntos: 0,
            x: Math.random() * 600 + 100,
            y: 0, 
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
        ids.sort(() => Math.random() - 0.5); // Randomizar orden
        
        // Distribución táctica de posiciones iniciales
        ids.forEach((id, index) => {
            jugadores[id].x = (index * (650 / (ids.length - 1 || 1))) + 75;
            jugadores[id].y = -50; // <--- Empiezan fuera de la pantalla (arriba) para que caigan
            jugadores[id].hp = SETTINGS.VIDA_MAXIMA; // Asegúrate de cambiarlo aquí también
        });

        turnoDe = ids[0];
        io.emit('comenzar_juego', { jugadores, turnoDe });
        reiniciarTemporizador();
    }

    socket.on('mover', (datos) => {
    const j = jugadores[socket.id];
    if (!j || j.hp <= 0) return;
    
    j.x = datos.x;
    j.y = datos.y;
    
    // IMPORTANTE: Emitimos a TODOS para que sepan que este tanque se movió/cayó
    io.emit('actualizar_estado', { jugadores }); 
});

    socket.on('saltar', () => {
        if (socket.id === turnoDe && !proyectilEnVuelo) {
            io.emit('jugador_salto', socket.id);
        }
    });


// ---Evento que permite ver el apuntado de los enemigos
    socket.on('apuntando', (datos) => {
    const j = jugadores[socket.id];
    if (j && socket.id === turnoDe) {
        // Reenviamos el ángulo y potencia a todos los demás
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
    // 1. Validación de seguridad
    if (socket.id !== turnoDe) return; 

    // --- NUEVO: Manejo de Pisotón (STOMP) ---
    if (data.tipo === 'stomp') {
        const victima = jugadores[data.idEnemigo];
        const atacante = jugadores[socket.id];

        if (victima && victima.hp > 0) {
            // Usamos el daño enviado por el cliente (calculado por la velocidad de caída)
            const damage = data.dano || 15; 
            victima.hp = Math.max(0, victima.hp - damage);
            
            // Premiar al atacante (puedes darle más puntos por ser un movimiento pro)
            if (atacante) atacante.puntos += 15; 

            io.emit('actualizar_estado', { jugadores });
            verificarFinDelJuego();
        }
        return; // IMPORTANTE: Cortamos aquí para no ejecutar la destrucción del mapa
    }

    // --- LÓGICA ORIGINAL PARA DISPAROS ---
    // 2. RETRANSMISIÓN DE DESTRUCCIÓN
    io.emit('mapa_destruccion', {
        x: data.x,
        y: data.y,
        radio: data.radio || 30
    });

    // 3. PROCESAMIENTO DE DAÑO POR BALA
    const victima = jugadores[data.idEnemigo];
    if (victima && victima.hp > 0) {
        // Daño basado en el arma
        const damage = data.arma === 'especial' ? SETTINGS.DANO_ESPECIAL : SETTINGS.DANO_NORMAL;
        victima.hp = Math.max(0, victima.hp - damage);
        
        if (jugadores[socket.id]) jugadores[socket.id].puntos += 10;

        io.emit('actualizar_estado', { jugadores });
        verificarFinDelJuego();
    }
    
    // 4. SINCRONIZACIÓN DE POSICIONES
    setTimeout(() => {
        io.emit('sincronizar_posiciones', jugadores);
    }, 800);
});

// En el archivo del servidor (Node.js)
socket.on('actualizar_hp', (data) => {
    if (jugadores[socket.id]) {
        // Actualizamos la vida en el objeto del servidor
        jugadores[socket.id].hp = data.hp;

        // Avisamos a todos los clientes para que actualicen las barras de vida
        io.emit('actualizar_estado', { jugadores });

        // Si el jugador murió por la caída, verificamos si terminó la partida
        if (data.hp <= 0) {
            console.log(`Jugador ${socket.id} murió por caída.`);
            verificarFinDelJuego(); 
        }
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
            // Reset de estado para nueva partida
            Object.values(jugadores).forEach(j => j.listo = false);
        }
    }

    // --- DESCONEXIÓN ---
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

server.listen(SETTINGS.PORT, () => {
    console.log(`\n--- BRAWL-BOUND: WILD EDITION 2026 ---`);
    console.log(`🚀 NEURAL_LINK_ACTIVE: PORT ${SETTINGS.PORT}`);
    console.log(`--------------------------------------\n`);
    
    
});

// --- EL CAMBIO CLAVE PARA RENDER ---
server.listen(SETTINGS.PORT, '0.0.0.0', () => {
    console.log(`🚀 Brawl-bound live on port ${SETTINGS.PORT}`);
});