import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import http from "http";
import { Server } from "socket.io";

import userRoutes from "./routes/user.routes.js";
import gameRoutes from "./routes/game.routes.js";
import questionRoutes from "./routes/question.routes.js";
import gameResultRoutes from "./routes/gameResult.routes.js";
import dashboardRoutes from "./routes/dashboard.routes.js";

import {
  joinLobby,
  setPlayerReady,
  lobbies,
  eliminatePlayerFromLobby,
  declareWinnerInLobby,
  checkGameEndInLobby,
  getAlivePlayers,
  createFinalRankingFromLobby,
  findLobbyBySocketId,
  cleanupLobby,
  removePlayerFromLobby,
  cleanupEmptyLobbies,
  performFullCleanup,
  getLobbiesStats
} from "./lobbies.js";

// ✅ IMPORTAR EL SISTEMA DE SESIONES
import { SessionManager } from "./sessionManager.js";

dotenv.config();

const app = express();
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(express.json());

// Rutas REST
app.use("/api/users", userRoutes);
app.use("/api/game", gameRoutes);
app.use("/api/questions", questionRoutes);
app.use("/api/results", gameResultRoutes);
app.use("/api/dashboard", dashboardRoutes);

// Conexión a MongoDB
mongoose.connect(process.env.MONGO_URI || "")
  .then(() => console.log("MongoDB conectado 🚀"))
  .catch(err => console.error(err));

// Servidor HTTP
const server = http.createServer(app);

// Socket.IO
const io = new Server(server, {
  path: "/socket.io",
  cors: { origin: "*" }
});

// Protección contra ejecución múltiple de finishGame
const finishedLobbies = new Set<string>();

// ... [Mantener todas las funciones debug y finishGame igual] ...
function debugLobbyState(lobby: any, context: string) {
  console.log(`\n🔍 DEBUG LOBBY STATE - ${context}`);
  console.log(`📍 Lobby ID: ${lobby.id}`);
  console.log(`📍 Game State: ${lobby.gameState}`);
  console.log(`📍 Total Players at Start: ${lobby.totalPlayersAtStart}`);
  console.log(`📍 Players (${lobby.players.length}):`);

  lobby.players.forEach((p: any, index: number) => {
    console.log(`  ${index + 1}. ${p.name}:`);
    console.log(`     - isAlive: ${p.isAlive}`);
    console.log(`     - finalPosition: ${p.finalPosition}`);
    console.log(`     - won: ${p.won}`);
    console.log(`     - correctAnswers: ${p.correctAnswers}`);
    console.log(`     - questionsAnswered: ${p.questionsAnswered}`);
    console.log(`     - eliminationTime: ${p.eliminationTime ? new Date(p.eliminationTime).toISOString() : 'N/A'}`);
    console.log(`     - socketId: ${p.socketId}`);
  });

  console.log(`📍 Elimination Order: ${JSON.stringify(lobby.eliminationOrder || [])}`);
  console.log(`🔍 END DEBUG\n`);
}

function createCorrectFinalRanking(lobby: any) {
  console.log(`\n🎯 INICIANDO createCorrectFinalRanking para lobby ${lobby.id}`);

  debugLobbyState(lobby, "ANTES del ranking");

  const totalPlayers = lobby.totalPlayersAtStart || lobby.players.length;
  const positions: Record<string, number> = {};
  const stats: Record<string, any> = {};

  // 🚨 CRÍTICO: PRIORIZAR ESTADÍSTICAS DE RENDIMIENTO SOBRE TODO LO DEMÁS
  const allPlayersSorted = [...lobby.players].sort((a: any, b: any) => {
    const aCorrect = a.correctAnswers || 0;
    const bCorrect = b.correctAnswers || 0;
    const aAnswered = a.questionsAnswered || 0;
    const bAnswered = b.questionsAnswered || 0;

    console.log(`\n🏆 COMPARANDO JUGADORES:`);
    console.log(`   ${a.name}: ${aCorrect}/${aAnswered} correctas`);
    console.log(`   ${b.name}: ${bCorrect}/${bAnswered} correctas`);

    // ✅ CRITERIO 1: MÁS RESPUESTAS CORRECTAS = SIEMPRE MEJOR POSICIÓN
    if (aCorrect !== bCorrect) {
      const winner = aCorrect > bCorrect ? a.name : b.name;
      console.log(`   🥇 GANADOR POR CORRECTAS: ${winner} (${aCorrect > bCorrect ? aCorrect : bCorrect} vs ${aCorrect > bCorrect ? bCorrect : aCorrect})`);
      return bCorrect - aCorrect; // Mayor número de correctas = mejor posición
    }

    // ✅ CRITERIO 2: Si empatan en correctas, más preguntas respondidas = mejor
    if (aAnswered !== bAnswered) {
      const winner = aAnswered > bAnswered ? a.name : b.name;
      console.log(`   📊 GANADOR POR RESPONDIDAS: ${winner} (${aAnswered > bAnswered ? aAnswered : bAnswered} vs ${aAnswered > bAnswered ? bAnswered : aAnswered})`);
      return bAnswered - aAnswered;
    }

    // ✅ CRITERIO 3: Si empatan en TODO el rendimiento, jugadores vivos tienen ventaja
    if (a.isAlive && !b.isAlive) {
      console.log(`   🟢 ${a.name} VIVO vs 🔴 ${b.name} ELIMINADO - Ventaja a vivo`);
      return -1; // a es mejor (vivo)
    }
    if (!a.isAlive && b.isAlive) {
      console.log(`   🔴 ${a.name} ELIMINADO vs 🟢 ${b.name} VIVO - Ventaja a vivo`);
      return 1;  // b es mejor (vivo)
    }

    // ✅ CRITERIO 4: SOLO si TODO lo anterior empata, usar tiempo de eliminación
    if (!a.isAlive && !b.isAlive) {
      const aElimTime = a.eliminationTime || 0;
      const bElimTime = b.eliminationTime || 0;

      // 🚨 IMPORTANTE: Eliminado MÁS TARDE = mejor posición (sobrevivió más tiempo)
      if (aElimTime !== bElimTime) {
        const winner = aElimTime > bElimTime ? a.name : b.name;
        console.log(`   ⏰ GANADOR POR SUPERVIVENCIA: ${winner}`);
        console.log(`      ${a.name}: ${new Date(aElimTime).toISOString()}`);
        console.log(`      ${b.name}: ${new Date(bElimTime).toISOString()}`);
        return bElimTime - aElimTime; // Eliminado más tarde = mejor posición
      }
    }

    console.log(`   🤝 EMPATE TOTAL entre ${a.name} y ${b.name}`);
    return 0;
  });

  console.log(`\n📊 RANKING FINAL POR RENDIMIENTO (PRIORIDAD ABSOLUTA):`);
  allPlayersSorted.forEach((p, i) => {
    const statusIcon = p.isAlive ? '🟢' : '🔴';
    const elimTime = p.eliminationTime ? new Date(p.eliminationTime).toISOString() : 'N/A';
    console.log(`   ${i + 1}. ${statusIcon} ${p.name}: ${p.correctAnswers}/${p.questionsAnswered} - eliminado: ${elimTime}`);
  });

  // 2. ASIGNAR POSICIONES CONSECUTIVAS (el mejor = posición 1)
  allPlayersSorted.forEach((player, index) => {
    const position = index + 1;
    positions[player.name] = position;

    // Actualizar en el lobby
    const lobbyPlayer = lobby.players.find((p: any) => p.name === player.name);
    if (lobbyPlayer) {
      lobbyPlayer.finalPosition = position;
      lobbyPlayer.won = position === 1;
    }

    stats[player.name] = {
      correctAnswers: player.correctAnswers || 0,
      questionsAnswered: player.questionsAnswered || 0,
      finalPosition: position,
      won: position === 1,
      isAlive: player.isAlive
    };

    const winIcon = position === 1 ? ' 👑 GANADOR' : '';
    console.log(`   🏅 #${position}: ${player.name} → (${player.correctAnswers}/${player.questionsAnswered})${winIcon}`);
  });

  // 3. VERIFICACIÓN FINAL
  const allPositions = Object.values(positions);
  const uniquePositions = new Set(allPositions);

  console.log(`\n🔍 VERIFICACIÓN FINAL:`);
  console.log(`   - Posiciones asignadas: [${allPositions.join(', ')}]`);
  console.log(`   - Total jugadores: ${totalPlayers}`);
  console.log(`   - Posiciones únicas: ${uniquePositions.size}`);
  console.log(`   - ¿Correctas?: ${allPositions.length === totalPlayers && uniquePositions.size === totalPlayers ? '✅' : '❌'}`);

  if (allPositions.length !== totalPlayers || uniquePositions.size !== totalPlayers) {
    console.error(`🚨 ERROR EN RANKING DETECTADO - USANDO FALLBACK`);

    // 🚨 FALLBACK: Ordenar por correctAnswers primero, luego questionsAnswered
    const fallbackSorted = [...lobby.players].sort((a: any, b: any) => {
      const aScore = (a.correctAnswers || 0) * 1000 + (a.questionsAnswered || 0);
      const bScore = (b.correctAnswers || 0) * 1000 + (b.questionsAnswered || 0);
      return bScore - aScore;
    });

    const fallbackPositions: Record<string, number> = {};
    const fallbackStats: Record<string, any> = {};
    const fallbackRanking: string[] = [];

    fallbackSorted.forEach((player, index) => {
      const pos = index + 1;
      fallbackPositions[player.name] = pos;
      fallbackRanking.push(player.name);
      fallbackStats[player.name] = {
        correctAnswers: player.correctAnswers || 0,
        questionsAnswered: player.questionsAnswered || 0,
        finalPosition: pos,
        won: pos === 1,
        isAlive: player.isAlive
      };

      // Actualizar lobby
      const lobbyPlayer = lobby.players.find((p: any) => p.name === player.name);
      if (lobbyPlayer) {
        lobbyPlayer.finalPosition = pos;
        lobbyPlayer.won = pos === 1;
      }

      console.log(`   🔄 FALLBACK #${pos}: ${player.name} → ${player.correctAnswers}/${player.questionsAnswered}`);
    });

    return {
      positions: fallbackPositions,
      ranking: fallbackRanking,
      eliminationOrder: lobby.eliminationOrder || [],
      totalPlayers,
      stats: fallbackStats,
      winner: fallbackRanking[0]
    };
  }

  const finalRanking = Object.entries(positions)
    .sort(([, a], [, b]) => a - b)
    .map(([name]) => name);

  const winner = finalRanking[0];

  console.log(`\n🏁 RANKING FINAL POR RENDIMIENTO:`);
  console.log(`   - 🏆 GANADOR: ${winner} (mejor rendimiento)`);
  console.log(`   - 📋 Ranking: ${finalRanking.join(' → ')}`);
  console.log(`   - 📊 Estadísticas usadas como criterio principal\n`);

  return {
    positions,
    ranking: finalRanking,
    eliminationOrder: lobby.eliminationOrder || [],
    totalPlayers,
    stats,
    winner
  };
}




// 🚨 NUEVAS VARIABLES GLOBALES para manejo de estadísticas tardías
const lobbyStatsTimeout = new Map<string, NodeJS.Timeout>();
const pendingStats = new Map<string, Set<string>>();



function finishGame(lobbyId: string, suggestedWinner: string | null) {
  if (finishedLobbies.has(lobbyId)) {
    console.log(`⚠️ Lobby ${lobbyId} ya finalizado, ignorando`);
    return;
  }

  finishedLobbies.add(lobbyId);

  console.log(`\n🏁 ========== FINALIZANDO JUEGO ==========`);
  console.log(`🏁 Lobby: ${lobbyId} | Ganador sugerido: ${suggestedWinner || 'NINGUNO'}`);

  const lobby = lobbies.find((l: any) => l.id === lobbyId);
  if (!lobby) {
    console.error(`❌ Lobby ${lobbyId} no encontrado`);
    finishedLobbies.delete(lobbyId);
    return;
  }

  lobby.gameState = 'finished';

  // ✅ VALIDAR DATOS antes de crear ranking
  lobby.players.forEach((player: any) => {
    if (!player.isAlive && !player.eliminationTime) {
      player.eliminationTime = Date.now();
      console.log(`⚠️ Asignando timestamp faltante a ${player.name}`);
    }

    if (player.correctAnswers === undefined) player.correctAnswers = 0;
    if (player.questionsAnswered === undefined) player.questionsAnswered = 0;

    // ✅ VALIDAR posiciones
    if (!player.finalPosition || player.finalPosition <= 0) {
      console.log(`⚠️ Posición inválida para ${player.name}: ${player.finalPosition}`);
    }
  });

  const rankingData = createCorrectFinalRanking(lobby);
  if (!rankingData) {
    console.error("❌ Error generando ranking final");
    finishedLobbies.delete(lobbyId);
    return;
  }

  const { positions, ranking, eliminationOrder, totalPlayers, stats, winner } = rankingData;

  // ✅ VALIDACIÓN FINAL más estricta
  const positionValues = Object.values(positions);
  const uniquePositions = new Set(positionValues);
  const hasValidPositions = positionValues.every(pos => pos >= 1 && pos <= totalPlayers);
  const hasCorrectCount = positionValues.length === totalPlayers;
  const hasUniquePositions = uniquePositions.size === totalPlayers;

  if (!hasValidPositions || !hasCorrectCount || !hasUniquePositions) {
    console.error(`🚨 RANKING INVÁLIDO DETECTADO:`);
    console.error(`   - Posiciones válidas: ${hasValidPositions}`);
    console.error(`   - Cantidad correcta: ${hasCorrectCount} (${positionValues.length}/${totalPlayers})`);
    console.error(`   - Posiciones únicas: ${hasUniquePositions} (${uniquePositions.size}/${totalPlayers})`);
    console.error(`   - Posiciones: ${JSON.stringify(positions)}`);

    finishedLobbies.delete(lobbyId);
    return;
  }

  console.log(`📤 ENVIANDO gameEnded final a ${lobby.players.length} jugadores`);

  // ✅ ENVIAR con datos completos y validados
  lobby.players.forEach((player: any) => {
    const playerPosition = positions[player.name];
    const playerStats = stats[player.name];

    if (!playerPosition || !playerStats) {
      console.error(`❌ Datos faltantes para ${player.name}`);
      return;
    }

    console.log(`   📤 ${player.name} → Posición ${playerPosition}`);

    io.to(player.socketId).emit("gameEnded", {
      winner: winner,
      positions: positions,
      finalRanking: ranking,
      totalPlayers: totalPlayers,
      eliminationOrder: eliminationOrder,
      stats: stats,
      playerStats: {
        [player.name]: {
          correctAnswers: playerStats.correctAnswers,
          questionsAnswered: playerStats.questionsAnswered,
          finalPosition: playerPosition,
          won: playerPosition === 1,
          gameTime: formatGameTime(Date.now() - (lobby.startTime || Date.now()))
        }
      }
    });
  });

  console.log(`✅ Juego finalizado correctamente: ${winner} ganó`);
  console.log(`🏁 ========== FIN FINALIZACIÓN ==========\n`);

  // Limpiar sesiones 
  lobby.players.forEach((player: any) => {
    SessionManager.setInGame(player.socketId, false);
    SessionManager.updateSessionLobby(player.socketId, null);
  });

  // 🚨 CRÍTICO: RETRASAR limpieza del lobby para permitir estadísticas tardías
  setTimeout(() => {
    console.log(`🧹 Limpiando lobby después de delay: ${lobbyId}`);
    cleanupLobby(lobbyId);
    finishedLobbies.delete(lobbyId);

    // Limpiar cualquier tracking de estadísticas pendientes
    const timeoutId = lobbyStatsTimeout.get(lobbyId);
    if (timeoutId) {
      clearTimeout(timeoutId);
      lobbyStatsTimeout.delete(lobbyId);
    }
    pendingStats.delete(lobbyId);

  }, 60000); // 60 segundos en lugar de 30
}



function formatGameTime(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}


io.on("connection", (socket) => {
  console.log("✅ Nuevo jugador conectado:", socket.id);

  // ✅ NUEVO: Heartbeat para mantener conexión activa
  const heartbeatInterval = setInterval(() => {
    if (socket.connected) {
      socket.emit("ping");
    }
  }, 30000); // Cada 30 segundos

  socket.on("pong", () => {
    console.log(`💓 Heartbeat recibido de ${socket.id}`);
    SessionManager.updateActivity(socket.id);
  });

  // ✅ NUEVO EVENTO: Verificar sesión existente ANTES de login
  socket.on("checkExistingSession", (email: string) => {
    console.log(`🔍 Verificando sesión existente para: ${email}`);

    const isConnected = SessionManager.isAccountConnected(email);
    const existingSession = SessionManager.getActiveSession(email);

    if (isConnected && existingSession) {
      console.log(`⚠️ Sesión activa encontrada para ${email}:`);
      console.log(`   - Socket: ${existingSession.socketId}`);
      console.log(`   - Lobby: ${existingSession.lobbyId}`);
      console.log(`   - En juego: ${existingSession.isInGame}`);

      socket.emit("existingSessionFound", {
        hasActiveSession: true,
        sessionData: {
          lobbyId: existingSession.lobbyId,
          isInGame: existingSession.isInGame,
          lastActivity: existingSession.lastActivity,
          name: existingSession.name
        }
      });
    } else {
      socket.emit("existingSessionFound", {
        hasActiveSession: false
      });
    }
  });



  // NUEVO: Evento para logout completo que limpia la sesión del servidor
  socket.on("logout", (data: { email: string }) => {
    console.log(`🚪 Logout completo solicitado para: ${data.email}`);

    // Obtener sesión antes de limpiar
    const session = SessionManager.getSessionBySocketId(socket.id);

    if (session && session.email === data.email) {
      console.log(`🗑️ Limpiando sesión completa para ${session.name} (${session.email})`);

      // Remover del lobby si está en uno
      const lobby = findLobbyBySocketId(socket.id);
      if (lobby) {
        const playerIndex = lobby.players.findIndex((p: any) => p.socketId === socket.id);
        if (playerIndex !== -1) {
          console.log(`🚶 Removiendo ${session.name} del lobby ${lobby.id}`);
          lobby.players.splice(playerIndex, 1);

          // Notificar a otros jugadores en el lobby
          socket.to(lobby.id).emit("lobbyUpdate", lobby);
        }
      }

      // CRÍTICO: Remover sesión completamente del servidor
      SessionManager.removeSession(socket.id);

      console.log(`✅ Logout completo exitoso para ${session.name}`);
    } else {
      console.log(`⚠️ No se encontró sesión válida para logout: ${data.email}`);
    }
  });

  // ✅ NUEVO EVENTO: Reconectar a sesión existente
  socket.on("reconnectToSession", (data: { email: string, name: string }) => {
    console.log(`🔄 Reconectando a sesión existente: ${data.email}`);

    const existingSession = SessionManager.getActiveSession(data.email);
    if (!existingSession) {
      socket.emit("reconnectionFailed", { message: "Sesión no encontrada" });
      return;
    }

    // CRÍTICO: Desconectar sesión anterior ANTES de crear la nueva
    SessionManager.disconnectPreviousSession(io, existingSession.socketId, "Reconexión autorizada");

    // AGREGAR: Pequeña pausa para asegurar desconexión completa
    setTimeout(() => {
      // Crear nueva sesión con los mismos datos
      const { currentSession } = SessionManager.createSession(socket.id, data.email, data.name);

      // Si tenía un lobby, intentar reconectar
      if (currentSession.lobbyId) {
        const lobby = lobbies.find(l => l.id === currentSession.lobbyId);
        if (lobby) {
          console.log(`🏠 Reconectando al lobby ${currentSession.lobbyId}`);

          // Actualizar socketId del jugador en el lobby
          const player = lobby.players.find(p => p.email === data.email);
          if (player) {
            player.socketId = socket.id;
            socket.join(lobby.id);

            // Actualizar estado de la sesión
            SessionManager.setInGame(socket.id, lobby.gameState === 'playing');

            socket.emit("reconnectedSuccessfully", {
              lobby: lobby,
              gameState: lobby.gameState,
              isInGame: lobby.gameState === 'playing'
            });

            // Notificar al resto del lobby
            socket.to(lobby.id).emit("lobbyUpdate", lobby);

            if (lobby.gameState === 'playing') {
              const aliveCount = getAlivePlayers(lobby.id).length;
              io.to(lobby.id).emit("updatePlayersLeft", aliveCount);
            }

            console.log(`✅ ${data.name} reconectado exitosamente al lobby ${lobby.id}`);
            return;
          }
        }
      }

      // Si no había lobby o no se pudo reconectar, sesión limpia
      socket.emit("reconnectedSuccessfully", {
        lobby: null,
        gameState: 'waiting',
        isInGame: false
      });
    }, 500); // Pausa para asegurar desconexión completa
  });

  // ✅ NUEVO EVENTO: Forzar nueva sesión (desconectar la anterior)
  socket.on("forceNewSession", (data: { email: string, name: string }) => {
    console.log(`💥 Forzando nueva sesión para: ${data.email}`);

    const existingSession = SessionManager.getActiveSession(data.email);
    if (existingSession) {
      // CRÍTICO: Marcar sesión anterior como siendo reemplazada
      SessionManager.markSessionForReplacement(data.email);

      // Desconectar sesión anterior
      SessionManager.disconnectPreviousSession(io, existingSession.socketId, "Nueva sesión forzada");
    }

    // CAMBIO CRÍTICO: Crear nueva sesión INMEDIATAMENTE sin timeout
    // El timeout estaba causando que el cliente conectara antes de que el servidor limpiara
    const { currentSession } = SessionManager.createSession(socket.id, data.email, data.name);

    console.log(`✅ Nueva sesión forzada creada inmediatamente: ${socket.id}`);

    socket.emit("newSessionCreated", {
      sessionId: currentSession.socketId,
      message: "Nueva sesión creada exitosamente"
    });
  });

  // 🎮 EVENTOS DE LOBBY MODIFICADOS

  // ✅ MODIFICAR: Unirse a un lobby CON verificación de sesión
  socket.on("joinLobby", (data: { playerName: string, email: string }) => {
    console.log(`🎮 Intento de unión al lobby:`, data);

    try {
      const existingSession = SessionManager.getActiveSession(data.email);
      if (existingSession && existingSession.socketId !== socket.id && !existingSession.isBeingReplaced) {
        console.log(`⚠️ Sesión duplicada detectada para ${data.email}`);
        socket.emit("sessionConflict", {
          message: "Ya tienes una sesión activa en otro dispositivo",
          canReconnect: true
        });
        return;
      }

      const { currentSession } = SessionManager.createSession(socket.id, data.email, data.playerName);
      const lobby = joinLobby(data.playerName, socket.id, data.email);

      // ✅ CRÍTICO: Unirse al room antes de emitir eventos
      socket.join(lobby.id);
      SessionManager.updateSessionLobby(socket.id, lobby.id);

      // ✅ CONFIRMAR unión exitosa al cliente ANTES del broadcast
      socket.emit("lobbyJoinConfirmed", {
        lobbyId: lobby.id,
        message: "Te has unido al lobby exitosamente"
      });

      // Luego broadcast a todos
      io.to(lobby.id).emit("lobbyUpdate", lobby);
      console.log(`✅ Jugador ${data.playerName} se unió a la sala ${lobby.id}`);

    } catch (error) {
      console.error("❌ Error en joinLobby:", error);
      socket.emit("joinLobbyError", {
        message: "Error al unirse al lobby"
      });
    }
  });

  // ✅ MODIFICAR: Marcar jugador como listo CON actualización de actividad
  socket.on("playerReady", () => {
    console.log("🎯 Evento playerReady recibido de:", socket.id);

    try {
      SessionManager.updateActivity(socket.id);
      const lobby = setPlayerReady(socket.id);

      if (lobby) {
        console.log("✅ Jugador marcado como listo en lobby:", lobby.id);

        // ✅ CONFIRMAR al cliente que está listo
        socket.emit("readyConfirmed", {
          message: "Marcado como listo exitosamente"
        });

        io.to(lobby.id).emit("lobbyUpdate", lobby);

        if (lobby.started) {
          console.log("🚀 Iniciando juego para lobby:", lobby.id);

          // Marcar jugadores como en juego
          lobby.players.forEach((player: any) => {
            SessionManager.setInGame(player.socketId, true);
          });

          // ✅ SECUENCIA MEJORADA: Enviar eventos en orden específico
          io.to(lobby.id).emit("startGame", {
            message: "Todos listos, partida iniciada!"
          });

          setTimeout(() => {
            io.to(lobby.id).emit("gameStarted", {
              totalPlayers: lobby.totalPlayersAtStart,
              playerList: lobby.players.map((p: any) => p.name)
            });

            const aliveCount = getAlivePlayers(lobby.id).length;
            io.to(lobby.id).emit("updatePlayersLeft", aliveCount);
          }, 500); // Dar tiempo para procesar startGame
        }
      } else {
        console.error("❌ No se pudo marcar jugador como listo");
        socket.emit("readyError", {
          message: "Error al marcar como listo"
        });
      }
    } catch (error) {
      console.error("❌ Error en playerReady:", error);
      socket.emit("readyError", {
        message: "Error interno del servidor"
      });
    }
  });

  // ✅ MODIFICAR: Unirse directamente al juego CON verificación de sesión
  socket.on("joinGame", (userData: { name: string, email: string }) => {
    console.log(`🎮 ${userData.name} se une directamente al juego`);

    // Verificar sesión existente
    const existingSession = SessionManager.getActiveSession(userData.email);
    if (existingSession && existingSession.socketId !== socket.id) {
      console.log(`⚠️ Sesión duplicada detectada en joinGame para ${userData.email}`);
      socket.emit("sessionConflict", {
        message: "Ya tienes una sesión activa",
        canReconnect: true
      });
      return;
    }

    // Crear o actualizar sesión
    SessionManager.createSession(socket.id, userData.email, userData.name);

    const lobby = joinLobby(userData.name, socket.id, userData.email, 10);
    socket.join(lobby.id);

    // Actualizar sesión con lobby
    SessionManager.updateSessionLobby(socket.id, lobby.id);

    const updatedLobby = setPlayerReady(socket.id);

    if (updatedLobby) {
      io.to(lobby.id).emit("lobbyUpdate", updatedLobby);

      if (updatedLobby.started) {
        console.log("🚀 Auto-iniciando juego para lobby:", lobby.id);

        // Marcar jugadores como en juego
        updatedLobby.players.forEach((player: any) => {
          SessionManager.setInGame(player.socketId, true);
        });

        io.to(updatedLobby.id).emit("gameStarted", {
          totalPlayers: updatedLobby.totalPlayersAtStart,
          playerList: updatedLobby.players.map((p: any) => p.name)
        });

        const aliveCount = getAlivePlayers(updatedLobby.id).length;
        io.to(updatedLobby.id).emit("updatePlayersLeft", aliveCount);
      }
    }
  });

  function formatGameTime(milliseconds: number): string {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  }

  // ❌ Jugador perdió/eliminado - CON actualización de actividad
  // MODIFICAR el evento playerLost para NO enviar gameEnded automáticamente
  socket.on("playerLost", (data: {
    playerId?: string,
    playerName?: string,
    questionIndex?: number,
    correctAnswers?: number,
    questionsAnswered?: number
  }) => {
    console.log(`\n❌ ========== PLAYER LOST RECIBIDO ==========`);
    console.log(`❌ Socket: ${socket.id} | Conectado: ${socket.connected}`);
    console.log(`❌ Datos:`, JSON.stringify(data, null, 2));
    console.log(`❌ Timestamp: ${new Date().toISOString()}`);

    try {
      const lobby = findLobbyBySocketId(socket.id);

      // 🚨 MODIFICACIÓN CRÍTICA: Buscar por NOMBRE DE JUGADOR, no por socket ID
      if (!lobby) {
        console.log(`❌ Lobby activo no encontrado para socket ${socket.id}`);

        // 🚨 NUEVO: Buscar lobbies pendientes por NOMBRE de jugador
        let foundPendingLobby = null;
        let foundLobbyData = null;

        for (const [lobbyId, expectedPlayers] of pendingStats.entries()) {
          console.log(`🔍 Verificando lobby pendiente ${lobbyId} para jugador: ${data.playerName}`);
          console.log(`   Jugadores esperados: ${Array.from(expectedPlayers).join(', ')}`);

          if (expectedPlayers.has(data.playerName || '')) {
            foundPendingLobby = lobbyId;
            foundLobbyData = lobbies.find(l => l.id === lobbyId);
            break;
          }
        }

        if (foundPendingLobby && foundLobbyData) {
          console.log(`✅ ENCONTRADAS ESTADÍSTICAS TARDÍAS para ${data.playerName} en lobby ${foundPendingLobby}`);

          const targetPlayer = foundLobbyData.players.find(p => p.name === data.playerName);

          if (targetPlayer) {
            console.log(`📊 ACTUALIZANDO ESTADÍSTICAS TARDÍAS de ${data.playerName}:`);
            console.log(`   Antes: ${targetPlayer.correctAnswers}/${targetPlayer.questionsAnswered}`);
            console.log(`   Recibido: ${data.correctAnswers}/${data.questionsAnswered}`);

            // ✅ ACTUALIZAR estadísticas con los datos reales
            targetPlayer.correctAnswers = data.correctAnswers || 0;
            targetPlayer.questionsAnswered = data.questionsAnswered || 0;

            console.log(`   Después: ${targetPlayer.correctAnswers}/${targetPlayer.questionsAnswered}`);
            console.log(`   🎯 ESTADÍSTICAS TARDÍAS APLICADAS CORRECTAMENTE`);

            // Marcar como recibido
            const expectedPlayers = pendingStats.get(foundPendingLobby);
            if (expectedPlayers) {
              expectedPlayers.delete(data.playerName || '');
              console.log(`✅ Estadísticas de ${data.playerName} recibidas. Jugadores restantes: ${expectedPlayers.size}`);
              console.log(`   Aún esperando: ${Array.from(expectedPlayers).join(', ')}`);

              // Si ya recibimos todas las estadísticas esperadas
              if (expectedPlayers.size === 0) {
                console.log(`🎯 TODAS LAS ESTADÍSTICAS RECIBIDAS - Finalizando juego inmediatamente`);

                // Limpiar timeout
                const timeoutId = lobbyStatsTimeout.get(foundPendingLobby);
                if (timeoutId) {
                  clearTimeout(timeoutId);
                  lobbyStatsTimeout.delete(foundPendingLobby);
                  console.log(`⏰ Timeout cancelado - procediendo con finalización`);
                }

                // Limpiar tracking
                pendingStats.delete(foundPendingLobby);

                // 🚨 CRUCIAL: Mostrar estadísticas antes de finalizar
                console.log(`\n📊 ESTADÍSTICAS FINALES ANTES DE RANKING:`);
                foundLobbyData.players.forEach(p => {
                  console.log(`   ${p.name}: ${p.correctAnswers}/${p.questionsAnswered}`);
                });

                // Finalizar juego con estadísticas completas
                setTimeout(() => {
                  console.log(`🏁 Iniciando finalización con estadísticas completas`);
                  finishGame(foundPendingLobby, null);
                }, 500);
              }
            }

            // ✅ RESPONDER al cliente
            socket.emit("eliminationConfirmed", {
              position: 2, // Posición temporal, se calculará correctamente en el ranking
              totalPlayers: foundLobbyData.totalPlayersAtStart || 2,
              correctAnswers: data.correctAnswers || 0,
              questionsAnswered: data.questionsAnswered || 0,
              message: "Estadísticas tardías recibidas correctamente"
            });

            console.log(`✅ Estadísticas tardías procesadas exitosamente para ${data.playerName}`);
            console.log(`❌ ========== FIN PLAYER LOST (TARDÍAS PROCESADAS) ==========\n`);
            return;

          } else {
            console.error(`❌ No se encontró jugador ${data.playerName} en lobby ${foundPendingLobby}`);
          }
        } else {
          console.log(`❌ No se encontraron estadísticas pendientes para ${data.playerName}`);
          console.log(`📋 Lobbies pendientes actuales:`);
          for (const [lobbyId, expectedPlayers] of pendingStats.entries()) {
            console.log(`   ${lobbyId}: esperando ${Array.from(expectedPlayers).join(', ')}`);
          }
        }

        // Si llegamos aquí, no pudimos procesar las estadísticas tardías
        socket.emit("eliminationConfirmed", {
          position: 2,
          totalPlayers: 2,
          correctAnswers: data.correctAnswers || 0,
          questionsAnswered: data.questionsAnswered || 0,
          error: "No se pudo procesar estadísticas tardías"
        });

        console.log(`❌ ========== FIN PLAYER LOST (NO PROCESADAS) ==========\n`);
        return;
      }

      // ✅ RESTO DEL CÓDIGO PARA LOBBIES ACTIVOS (mantener igual)
      if (lobby.gameState !== 'playing') {
        console.log(`⚠️ Juego no activo en lobby ${lobby.id}, estado: ${lobby.gameState}`);

        socket.emit("eliminationConfirmed", {
          position: lobby.players.length,
          totalPlayers: lobby.totalPlayersAtStart || lobby.players.length,
          correctAnswers: data.correctAnswers || 0,
          questionsAnswered: data.questionsAnswered || 0,
          error: "Juego no activo"
        });
        return;
      }

      // PROCESAR ELIMINACIÓN NORMAL (código existente igual)
      const finalCorrectAnswers = data.correctAnswers !== undefined ? data.correctAnswers : 0;
      const finalQuestionsAnswered = data.questionsAnswered !== undefined ? data.questionsAnswered : 0;

      console.log(`📊 PROCESANDO ELIMINACIÓN NORMAL CON ESTADÍSTICAS:`);
      console.log(`   - Jugador: ${data.playerName || 'Desconocido'}`);
      console.log(`   - Correctas: ${finalCorrectAnswers}`);
      console.log(`   - Respondidas: ${finalQuestionsAnswered}`);

      const result = eliminatePlayerFromLobby(
        socket.id,
        data.questionIndex ?? 0,
        finalCorrectAnswers,
        finalQuestionsAnswered
      );

      if (!result) {
        console.error("❌ eliminatePlayerFromLobby falló");
        socket.emit("eliminationConfirmed", {
          position: lobby.players.length,
          totalPlayers: lobby.totalPlayersAtStart || lobby.players.length,
          correctAnswers: finalCorrectAnswers,
          questionsAnswered: finalQuestionsAnswered,
          error: "Error procesando eliminación"
        });
        return;
      }

      const { lobby: updatedLobby, player, position, remainingPlayers, automaticWinner } = result;

      console.log(`✅ Eliminación normal procesada: ${player.name} → posición ${position}`);
      console.log(`📊 Estadísticas confirmadas: ${player.correctAnswers}/${player.questionsAnswered}`);

      socket.emit("eliminationConfirmed", {
        position: position,
        totalPlayers: updatedLobby.totalPlayersAtStart || updatedLobby.players.length,
        correctAnswers: player.correctAnswers,
        questionsAnswered: player.questionsAnswered
      });

      io.to(updatedLobby.id).emit("playerEliminated", {
        playerName: player.name,
        position: position,
        playersLeft: remainingPlayers,
        eliminatedStats: {
          correctAnswers: player.correctAnswers,
          questionsAnswered: player.questionsAnswered
        }
      });

      if (automaticWinner && remainingPlayers === 1) {
        console.log(`🏆 GANADOR AUTOMÁTICO: ${automaticWinner.name}`);
        io.to(automaticWinner.socketId).emit("automaticWinnerNotification", {
          message: "¡Eres el ganador automático! Tu oponente fue eliminado.",
          position: 1,
          totalPlayers: updatedLobby.totalPlayersAtStart || updatedLobby.players.length,
          eliminatedPlayer: player.name
        });

        setTimeout(() => {
          finishGame(updatedLobby.id, automaticWinner.name);
        }, 3000);

      } else if (remainingPlayers === 0) {
        console.log("💀 Todos eliminados - terminando juego");
        setTimeout(() => finishGame(updatedLobby.id, null), 1000);

      } else {
        io.to(updatedLobby.id).emit("updatePlayersLeft", remainingPlayers);
      }

    } catch (error) {
      console.error("❌ Error crítico en playerLost:", error);
      socket.emit("eliminationConfirmed", {
        position: 2,
        totalPlayers: 2,
        correctAnswers: data.correctAnswers || 0,
        questionsAnswered: data.questionsAnswered || 0,
        error: "Error interno del servidor"
      });
    }

    console.log(`❌ ========== FIN PLAYER LOST ==========\n`);
  });

  // AGREGAR NUEVO EVENTO: Terminar juego manualmente como ganador automático
  socket.on("finishAsAutomaticWinner", (data: {
    correctAnswers: number,
    questionsAnswered: number,
    finalPosition?: number,
    won?: boolean
  }) => {
    console.log(`🏁 finishAsAutomaticWinner recibido:`, data);

    const lobby = findLobbyBySocketId(socket.id);
    if (!lobby) {
      console.error("❌ Lobby no encontrado para finishAsAutomaticWinner");
      return;
    }

    const player = lobby.players.find(p => p.socketId === socket.id);
    if (!player) {
      console.error("❌ Jugador no encontrado para finishAsAutomaticWinner");
      return;
    }

    // ✅ CRÍTICO: Actualizar estadísticas CORRECTAS del ganador
    player.correctAnswers = data.correctAnswers;
    player.questionsAnswered = data.questionsAnswered;
    player.finalPosition = data.finalPosition || 1;
    player.won = data.won !== undefined ? data.won : true;
    player.isAlive = true; // ✅ Mantener como vivo hasta el final

    console.log(`🏆 ${player.name} termina como ganador con estadísticas:`, {
      correctAnswers: player.correctAnswers,
      questionsAnswered: player.questionsAnswered,
      finalPosition: player.finalPosition,
      won: player.won
    });

    // ✅ Marcar lobby como terminado
    lobby.gameState = 'finished';

    // ✅ ASEGURAR que otros jugadores mantengan sus estadísticas originales
    lobby.players.forEach((p: any) => {
      if (p.socketId !== socket.id && p.isAlive === false) {
        // ✅ NO alterar las estadísticas de jugadores ya eliminados
        console.log(`📊 Manteniendo estadísticas de ${p.name}: ${p.correctAnswers}/${p.questionsAnswered} - Posición: ${p.finalPosition}`);
      }
    });

    // Finalizar el juego inmediatamente
    setTimeout(() => {
      finishGame(lobby.id, player.name);
    }, 500);
  });

  // Función para guardar resultado de jugador eliminado
  async function saveEliminatedPlayerResult(gameData: any) {
    try {
      console.log("💾 Guardando resultado de jugador eliminado:", gameData);

      const response = await fetch(`${process.env.NEXT_PUBLIC_URL_BASE || 'http://localhost:4000'}/api/results/save-result`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(gameData)
      });

      if (response.ok) {
        console.log("✅ Resultado de jugador eliminado guardado correctamente");
      } else {
        console.error("❌ Error al guardar resultado eliminado:", await response.text());
      }
    } catch (err) {
      console.error("❌ Error guardando resultado eliminado:", err);
    }
  }





  socket.on("playerFinished", (data: {
    playerId: string,
    playerName: string,
    correctAnswers: number,
    questionsAnswered: number,
    completedAllQuestions: boolean
  }) => {
    console.log(`🏁 playerFinished recibido de ${data.playerName}:`, data);

    const lobby = findLobbyBySocketId(socket.id);
    if (!lobby) {
      console.error("❌ Lobby no encontrado para playerFinished");
      return;
    }

    const player = lobby.players.find(p => p.socketId === socket.id);
    if (!player) {
      console.error("❌ Jugador no encontrado para playerFinished");
      return;
    }

    // Actualizar estadísticas del jugador
    player.correctAnswers = data.correctAnswers;
    player.questionsAnswered = data.questionsAnswered;

    // ✅ MARCAR como "terminado" pero NO como ganador automáticamente
    player.hasCompletedAllQuestions = true;

    console.log(`📊 ${player.name} terminó todas las preguntas: ${data.correctAnswers}/${data.questionsAnswered}`);

    // Verificar si este jugador debe ganar automáticamente
    const alivePlayers = getAlivePlayers(lobby.id);
    const otherAlivePlayers = alivePlayers.filter(p => p.socketId !== socket.id);

    console.log(`👥 Jugadores vivos: ${alivePlayers.length}, otros vivos: ${otherAlivePlayers.length}`);

    if (otherAlivePlayers.length === 0) {
      // ✅ Es el último superviviente
      console.log(`🏆 ${player.name} es el último superviviente - GANADOR AUTOMÁTICO`);

      player.finalPosition = 1;
      player.won = true;

      // ✅ Actualizar estadísticas recibidas
      player.correctAnswers = data.correctAnswers;
      player.questionsAnswered = data.questionsAnswered;

      console.log(`📊 Estadísticas finales del ganador: ${player.correctAnswers}/${player.questionsAnswered}`);

      // Enviar confirmación de victoria
      socket.emit("victoryConfirmed", {
        position: 1,
        totalPlayers: lobby.totalPlayersAtStart || lobby.players.length,
        correctAnswers: player.correctAnswers,
        questionsAnswered: player.questionsAnswered,
        reason: "lastSurvivor"
      });

      // ✅ CRÍTICO: Finalizar SOLO UNA VEZ con el ganador correcto
      setTimeout(() => {
        console.log(`🏁 Finalizando juego con ganador: ${player.name}`);
        finishGame(lobby.id, player.name);
      }, 2000); // Dar tiempo para que el cliente procese la confirmación

    } else {
      // ✅ Hay otros jugadores vivos - solo notificar estado
      console.log(`⏳ ${player.name} terminó pero otros siguen jugando: ${otherAlivePlayers.map(p => p.name).join(', ')}`);

      // ✅ Actualizar estadísticas del jugador que terminó
      player.correctAnswers = data.correctAnswers;
      player.questionsAnswered = data.questionsAnswered;
      player.hasCompletedAllQuestions = true;

      // Notificar a todos que este jugador terminó
      io.to(lobby.id).emit("playerFinishedAllQuestions", {
        playerName: player.name,
        correctAnswers: data.correctAnswers,
        questionsAnswered: data.questionsAnswered,
        playersStillPlaying: otherAlivePlayers.length
      });

      // Responder al jugador que debe esperar
      socket.emit("waitingForOthers", {
        message: "Has completado todas las preguntas. Esperando que otros jugadores terminen...",
        playersStillPlaying: otherAlivePlayers.length,
        otherPlayers: otherAlivePlayers.map(p => p.name)
      });
    }
  });






  // AGREGAR NUEVO EVENTO: Terminar juego manualmente como ganador automático
  socket.on("finishAsAutomaticWinner", (data: {
    correctAnswers: number,
    questionsAnswered: number
  }) => {
    console.log(`🏁 Ganador automático decide terminar:`, data);

    // Actualizar actividad
    SessionManager.updateActivity(socket.id);

    const lobby = findLobbyBySocketId(socket.id);
    if (!lobby) {
      console.error("❌ Lobby no encontrado para finishAsAutomaticWinner");
      return;
    }

    const player = lobby.players.find(p => p.socketId === socket.id);
    if (!player) {
      console.error("❌ Jugador no encontrado para finishAsAutomaticWinner");
      return;
    }

    // Actualizar estadísticas finales
    player.correctAnswers = data.correctAnswers;
    player.questionsAnswered = data.questionsAnswered;
    player.finalPosition = 1;
    player.won = true;
    player.isAlive = true;

    console.log(`🏆 ${player.name} termina como ganador automático con ${data.correctAnswers}/${data.questionsAnswered}`);

    // Finalizar el juego
    finishGame(lobby.id, player.name);
  });

  // 🏆 Jugador ganó - CON actualización de actividad
  socket.on("playerWon", (data: {
    playerId?: string,
    playerName?: string,
    correctAnswers?: number,
    questionsAnswered?: number
  }) => {
    console.log(`🏆 ========== PLAYER WON RECIBIDO ==========`);
    console.log(`🏆 Socket: ${socket.id} | Datos:`, data);

    try {
      SessionManager.updateActivity(socket.id);

      const lobby = findLobbyBySocketId(socket.id);
      if (!lobby) {
        console.log("❌ Lobby no encontrado para playerWon");

        // ✅ RESPONDER incluso sin lobby
        socket.emit("victoryConfirmed", {
          position: 1,
          totalPlayers: 2,
          correctAnswers: data.correctAnswers || 0,
          questionsAnswered: data.questionsAnswered || 0
        });

        setTimeout(() => {
          socket.emit("gameEnded", {
            winner: data.playerName || "Ganador",
            positions: { [data.playerName || "Ganador"]: 1 },
            finalRanking: [data.playerName || "Ganador"],
            totalPlayers: 2,
            eliminationOrder: [],
            stats: {
              [data.playerName || "Ganador"]: {
                correctAnswers: data.correctAnswers || 0,
                questionsAnswered: data.questionsAnswered || 0,
                finalPosition: 1,
                won: true
              }
            }
          });
        }, 1000);
        return;
      }

      const player = lobby.players.find((p: any) => p.socketId === socket.id);
      if (!player) {
        console.log("❌ Jugador no encontrado para playerWon");
        socket.emit("victoryConfirmed", {
          position: 1,
          totalPlayers: lobby.totalPlayersAtStart || lobby.players.length,
          correctAnswers: data.correctAnswers || 0,
          questionsAnswered: data.questionsAnswered || 0
        });
        return;
      }

      // ✅ CRÍTICO: ACTUALIZAR estadísticas con los datos MÁS RECIENTES del cliente
      console.log(`📊 ACTUALIZANDO estadísticas del ganador ${player.name}:`);
      console.log(`   Antes: ${player.correctAnswers}/${player.questionsAnswered}`);
      console.log(`   Datos recibidos: ${data.correctAnswers}/${data.questionsAnswered}`);

      // 🚨 USAR LOS DATOS MÁS ACTUALIZADOS DEL CLIENTE
      player.correctAnswers = data.correctAnswers !== undefined ? data.correctAnswers : player.correctAnswers || 0;
      player.questionsAnswered = data.questionsAnswered !== undefined ? data.questionsAnswered : player.questionsAnswered || 0;
      player.finalPosition = 1;
      player.won = true;
      player.isAlive = true;

      console.log(`   Después: ${player.correctAnswers}/${player.questionsAnswered}`);
      console.log(`🏆 ${player.name} confirmado como GANADOR con estadísticas actualizadas`);

      // Marcar otros jugadores como eliminados si no lo están ya
      const otherAlivePlayers = lobby.players.filter((p: any) =>
        p.isAlive && p.socketId !== socket.id
      );

      console.log(`📊 Marcando ${otherAlivePlayers.length} jugadores restantes como eliminados`);

      otherAlivePlayers.forEach((otherPlayer: any, index: number) => {
        // 🚨 IMPORTANTE: NO alterar las estadísticas de jugadores ya eliminados
        if (!otherPlayer.eliminationTime) {
          otherPlayer.eliminationTime = Date.now();
        }

        otherPlayer.isAlive = false;
        otherPlayer.won = false;

        // Solo asignar posición si no tiene una ya
        if (!otherPlayer.finalPosition || otherPlayer.finalPosition <= 0) {
          otherPlayer.finalPosition = index + 2; // Posiciones 2, 3, 4...
        }

        console.log(`   ${otherPlayer.name}: Posición ${otherPlayer.finalPosition} (estadísticas preservadas: ${otherPlayer.correctAnswers}/${otherPlayer.questionsAnswered})`);
      });

      // ✅ CONFIRMAR victoria al ganador
      socket.emit("victoryConfirmed", {
        position: 1,
        totalPlayers: lobby.totalPlayersAtStart || lobby.players.length,
        correctAnswers: player.correctAnswers,
        questionsAnswered: player.questionsAnswered
      });

      // Marcar lobby como terminado
      lobby.gameState = 'finished';
      lobby.lastActivity = Date.now();

      // ✅ Finalizar juego con delay para procesar datos
      setTimeout(() => {
        console.log(`🏁 Finalizando juego con ganador confirmado: ${player.name}`);
        finishGame(lobby.id, player.name);
      }, 1000);

    } catch (error) {
      console.error("❌ Error en playerWon:", error);

      socket.emit("victoryConfirmed", {
        position: 1,
        totalPlayers: 2,
        correctAnswers: data.correctAnswers || 0,
        questionsAnswered: data.questionsAnswered || 0,
        error: "Error interno"
      });
    }

    console.log(`🏆 ========== FIN PLAYER WON ==========\n`);
  });




  //  Manejo de desconexión CON limpieza de sesión
  socket.on("disconnect", (reason) => {
    console.log(`\n🔌 ========== DESCONEXIÓN DETECTADA ==========`);
    console.log(`🔌 Socket: ${socket.id} | Razón: ${reason}`);
    console.log(`🔌 Timestamp: ${new Date().toISOString()}`);

    // Limpiar heartbeat
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
    }

    try {
      const session = SessionManager.getSessionBySocketId(socket.id);
      const lobby = findLobbyBySocketId(socket.id);

      if (session) {
        console.log(`🚶 Sesión encontrada: ${session.name} (${session.email})`);

        if (session.isBeingReplaced) {
          console.log(`🔄 Sesión reemplazada - limpieza completa`);
          SessionManager.removeSession(socket.id);
        } else {
          console.log(`⏰ Manteniendo sesión para reconexión`);
        }
      }

      if (!lobby) {
        console.log(`🏠 Sin lobby asociado - solo limpieza de sesión`);
        console.log(`🔌 ========== FIN DESCONEXIÓN ==========\n`);
        return;
      }

      const player = lobby.players.find((p: any) => p.socketId === socket.id);
      if (!player) {
        console.log(`👤 Jugador no encontrado en lobby`);
        console.log(`🔌 ========== FIN DESCONEXIÓN ==========\n`);
        return;
      }

      console.log(`🚶 Desconexión: ${player.name} del lobby ${lobby.id}`);
      console.log(`🎮 Estado del juego: ${lobby.gameState}`);
      console.log(`👤 Jugador vivo: ${player.isAlive}`);
      console.log(`📊 Rendimiento actual: ${player.correctAnswers}/${player.questionsAnswered}`);

      // ✅ CRÍTICO: Solo eliminar si el juego está activo y el jugador está vivo
      if (lobby.gameState === 'playing' && player.isAlive) {
        console.log(`🚫 Procesando desconexión durante juego activo: ${player.name}`);

        const eliminationTimestamp = Date.now();

        // 🚨 CONSERVAR estadísticas existentes del jugador
        const currentCorrectAnswers = player.correctAnswers || 0;
        const currentQuestionsAnswered = player.questionsAnswered || 0;

        console.log(`📊 PRESERVANDO estadísticas de ${player.name}:`);
        console.log(`   - Correctas: ${currentCorrectAnswers}`);
        console.log(`   - Respondidas: ${currentQuestionsAnswered}`);
        console.log(`   - Timestamp eliminación: ${new Date(eliminationTimestamp).toISOString()}`);

        // Marcar como eliminado preservando estadísticas
        player.isAlive = false;
        player.eliminationTime = eliminationTimestamp;
        player.won = false;
        // 🚨 NO alterar correctAnswers ni questionsAnswered aquí

        // Agregar a orden de eliminación si no está
        if (!lobby.eliminationOrder) lobby.eliminationOrder = [];
        if (!lobby.eliminationOrder.includes(player.name)) {
          lobby.eliminationOrder.push(player.name);
        }

        const remainingAlivePlayers = lobby.players.filter((p: any) => p.isAlive);
        const remainingCount = remainingAlivePlayers.length;

        console.log(`📊 Jugadores vivos restantes: ${remainingCount}`);
        console.log(`📍 ${player.name} eliminado por desconexión (posición se calculará por estadísticas)`);

        // Notificar eliminación por desconexión
        io.to(lobby.id).emit("playerEliminated", {
          playerName: player.name,
          position: -1, // Posición temporal, se calculará después
          playersLeft: remainingCount,
          reason: "disconnection",
          eliminatedStats: {
            correctAnswers: currentCorrectAnswers,
            questionsAnswered: currentQuestionsAnswered
          }
        });

        io.to(lobby.id).emit("updatePlayersLeft", remainingCount);

        // ✅ NUEVO: MANEJAR FIN DE JUEGO CON DELAY PARA ESTADÍSTICAS
        if (remainingCount <= 1) {
          if (remainingCount === 1) {
            const winner = remainingAlivePlayers[0];

            console.log(`🏆 JUGADOR RESTANTE: ${winner.name} (continuará jugando)`);

            // Solo notificar que es el último superviviente
            io.to(winner.socketId).emit("automaticWinnerNotification", {
              message: "¡Eres el último superviviente! Puedes continuar jugando o terminar ahora.",
              position: 1,
              totalPlayers: lobby.totalPlayersAtStart || lobby.players.length,
              eliminatedPlayer: player.name
            });

            // 🚨 CRÍTICO: NO finalizar inmediatamente - esperar estadísticas

          } else {
            console.log(`💀 Todos eliminados por desconexión`);

            // 🚨 NUEVO: CONFIGURAR ESPERA DE ESTADÍSTICAS
            console.log(`⏳ CONFIGURANDO ESPERA DE ESTADÍSTICAS para lobby ${lobby.id}`);

            // Crear set de jugadores de los que esperamos estadísticas
            const playersExpected = new Set<string>();
            lobby.players.forEach((p: any) => {
              // Solo esperar estadísticas de jugadores que se desconectaron recientemente
              const timeSinceElimination = Date.now() - (p.eliminationTime || 0);
              if (timeSinceElimination < 30000) { // 30 segundos
                playersExpected.add(p.name);
                console.log(`   📋 Esperando estadísticas de: ${p.name}`);
              }
            });

            pendingStats.set(lobby.id, playersExpected);

            // ✅ TIMEOUT: Finalizar después de 15 segundos aunque no lleguen todas las estadísticas
            const timeoutId = setTimeout(() => {
              console.log(`⏰ TIMEOUT: Finalizando juego ${lobby.id} por tiempo agotado`);
              console.log(`📊 Estadísticas pendientes que no llegaron: ${Array.from(pendingStats.get(lobby.id) || []).join(', ')}`);

              // Limpiar tracking
              pendingStats.delete(lobby.id);
              lobbyStatsTimeout.delete(lobby.id);

              // Finalizar con las estadísticas que tenemos
              finishGame(lobby.id, null);
            }, 15000); // 15 segundos de timeout

            lobbyStatsTimeout.set(lobby.id, timeoutId);

            console.log(`⏳ Esperando estadísticas de ${playersExpected.size} jugadores durante máximo 15 segundos...`);
          }
        }

      } else {
        // ✅ SOLO remover del lobby si no está en juego
        console.log(`🚶 Removiendo jugador del lobby (no en juego activo)`);
        const { shouldCleanup } = removePlayerFromLobby(socket.id);

        if (shouldCleanup) {
          console.log(`🧹 Lobby vacío, será limpiado automáticamente`);
        } else if (lobby.players.length > 0) {
          io.to(lobby.id).emit("lobbyUpdate", lobby);
        }
      }

    } catch (error) {
      console.error("❌ Error manejando desconexión:", error);
    }

    console.log(`🔌 ========== FIN DESCONEXIÓN ==========\n`);
  });

  // ✅ AGREGAR: Nuevo evento para manejar sessionReplaced en el cliente
  socket.on("sessionReplaced", (data: any) => {
    console.log(`📱 Cliente notificado de sesión reemplazada: ${socket.id}`);
    // El cliente debe manejar este evento y mostrar mensaje apropiado
    // No necesitamos hacer nada más aquí, el socket ya se desconectará
  });

  // 🔧 Debug: Obtener estado del lobby CON actualización de actividad
  socket.on("getLobbyState", () => {
    SessionManager.updateActivity(socket.id);

    const lobby = findLobbyBySocketId(socket.id);
    if (lobby) {
      socket.emit("lobbyState", {
        id: lobby.id,
        players: lobby.players.map((p: any) => ({
          name: p.name,
          isAlive: p.isAlive,
          finalPosition: p.finalPosition,
          correctAnswers: p.correctAnswers,
          questionsAnswered: p.questionsAnswered,
          won: p.won,
          eliminationTime: p.eliminationTime
        })),
        gameState: lobby.gameState,
        eliminationOrder: lobby.eliminationOrder,
        totalPlayersAtStart: lobby.totalPlayersAtStart
      });
    }
  });

  // ✅ NUEVO EVENTO: Debug de sesiones
  socket.on("getSessionStats", () => {
    const stats = SessionManager.getStats();
    const currentSession = SessionManager.getSessionBySocketId(socket.id);

    socket.emit("sessionStats", {
      globalStats: stats,
      yourSession: currentSession ? {
        email: currentSession.email,
        name: currentSession.name,
        lobbyId: currentSession.lobbyId,
        isInGame: currentSession.isInGame,
        lastActivity: new Date(currentSession.lastActivity).toISOString(),
        joinTime: new Date(currentSession.joinTime).toISOString()
      } : null
    });
  });
});






// ✅ AGREGAR: Endpoint para estadísticas de sesiones
app.get("/api/sessions/stats", (req, res) => {
  const stats = SessionManager.getStats();
  res.json({
    success: true,
    data: stats,
    timestamp: new Date().toISOString()
  });
});

// ✅ AGREGAR: Limpieza periódica cada 10 minutos
setInterval(() => {
  console.log("🧹 Ejecutando limpieza periódica de sesiones...");
  SessionManager.debugListSessions();
  const cleaned = SessionManager.cleanupInactiveSessions(15 * 60 * 1000); // 15 minutos
  if (cleaned > 0) {
    console.log(`🧹 Se limpiaron ${cleaned} sesiones inactivas`);
  }
}, 10 * 60 * 1000); // Cada 10 minutos

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
const HOST = "0.0.0.0" as string;

server.listen(PORT, HOST, () => {
  console.log(`Servidor corriendo en http://${HOST}:${PORT}`);
});
