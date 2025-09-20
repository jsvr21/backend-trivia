// lobbies.ts - Sistema mejorado con Game Manager integrado + Limpieza automática
import { v4 as uuidv4 } from "uuid";

interface Player {
    socketId: string;
    name: string;
    email?: string;
    isReady: boolean;
    // Datos del juego
    isAlive?: boolean;
    correctAnswers?: number;
    questionsAnswered?: number;
    joinTime?: number;
    eliminationTime?: number;
    finalPosition?: number;
    won?: boolean;
    hasCompletedAllQuestions?: boolean;
}

export interface Lobby {
    id: string;
    players: Player[];
    maxPlayers: number;
    started: boolean;
    // Datos del juego
    gameState?: 'waiting' | 'playing' | 'finished';
    currentQuestion?: number;
    eliminationOrder?: string[];
    startTime?: number;
    totalPlayersAtStart?: number;
    lastActivity?: number; // Para tracking de actividad
}

export const lobbies: Lobby[] = [];

// Unirse a lobby o crear uno nuevo
export function joinLobby(playerName: string, socketId: string, email?: string, maxPlayers: number = 5) {
    let lobby = lobbies.find(l => !l.started && l.players.length < l.maxPlayers);

    if (!lobby) {
        lobby = {
            id: uuidv4(),
            players: [],
            maxPlayers,
            started: false,
            gameState: 'waiting',
            eliminationOrder: [],
            lastActivity: Date.now()
        };
        lobbies.push(lobby);
    }

    // Verificar si el jugador ya está en el lobby (reconexión)
    const existingPlayer = lobby.players.find(p => p.email === email);
    if (existingPlayer) {
        console.log(`🔄 Jugador ${playerName} reconectándose, actualizando socketId`);
        existingPlayer.socketId = socketId;
    } else {
        // Nuevo jugador
        lobby.players.push({
            socketId,
            name: playerName,
            email,
            isReady: false,
            isAlive: true,
            correctAnswers: 0,
            questionsAnswered: 0,
            joinTime: Date.now()
        });
    }

    // Actualizar actividad del lobby
    lobby.lastActivity = Date.now();

    return lobby;
}

// Marcar jugador listo
export function setPlayerReady(socketId: string) {
    console.log("🔍 Buscando jugador:", socketId);

    const lobby = lobbies.find(l => l.players.some(p => p.socketId === socketId));
    if (!lobby) {
        console.log("❌ Lobby no encontrado para:", socketId);
        return null;
    }

    const player = lobby.players.find(p => p.socketId === socketId);
    if (player) {
        player.isReady = true;
        console.log("✅ Jugador marcado como listo:", player.name);
    }

    // Actualizar actividad del lobby
    lobby.lastActivity = Date.now();

    const allReady = lobby.players.every(p => p.isReady);
    console.log("🎯 Todos listos:", allReady, "- Jugadores:", lobby.players.length);

    if (lobby.players.length >= 2 && lobby.players.length <= 5 && allReady) {
        lobby.started = true;
        lobby.gameState = 'playing';
        lobby.startTime = Date.now();
        lobby.totalPlayersAtStart = lobby.players.length;
        console.log("🚀 Juego marcado como iniciado!");
    }

    return lobby;
}

// ✅ NUEVA FUNCIÓN: Remover jugador de lobby con limpieza automática
export function removePlayerFromLobby(socketId: string): {
    lobby: Lobby | null;
    wasEmpty: boolean;
    shouldCleanup: boolean;
} {
    const lobby = findLobbyBySocketId(socketId);
    if (!lobby) return { lobby: null, wasEmpty: false, shouldCleanup: false };

    const playerName = lobby.players.find(p => p.socketId === socketId)?.name || "Desconocido";
    console.log(`🚶 Removiendo jugador ${playerName} (${socketId}) del lobby ${lobby.id}`);

    // Encontrar y remover el jugador
    const initialPlayerCount = lobby.players.length;
    lobby.players = lobby.players.filter(p => p.socketId !== socketId);

    const removedCount = initialPlayerCount - lobby.players.length;
    console.log(`🧹 Removidos ${removedCount} jugador(es). Quedan ${lobby.players.length} en lobby ${lobby.id}`);

    const isEmpty = lobby.players.length === 0;
    let shouldCleanup = false;

    if (isEmpty) {
        console.log(`🏠 Lobby ${lobby.id} quedó vacío después de la desconexión`);
        shouldCleanup = true;
    }

    // Actualizar actividad
    lobby.lastActivity = Date.now();

    return { lobby, wasEmpty: isEmpty, shouldCleanup };
}

// ✅ NUEVA FUNCIÓN: Limpiar lobbies vacíos automáticamente
export function cleanupEmptyLobbies(): number {
    let cleaned = 0;

    for (let i = lobbies.length - 1; i >= 0; i--) {
        const lobby = lobbies[i];

        if (lobby.players.length === 0) {
            console.log(`🧹 Eliminando lobby vacío: ${lobby.id}`);
            lobbies.splice(i, 1);
            cleaned++;
        }
        // También limpiar jugadores fantasma (sin socketId válido)
        else {
            const validPlayers = lobby.players.filter(p => p.socketId && p.socketId.trim() !== '');
            if (validPlayers.length === 0) {
                console.log(`🧹 Eliminando lobby con jugadores fantasma: ${lobby.id}`);
                lobbies.splice(i, 1);
                cleaned++;
            } else if (validPlayers.length < lobby.players.length) {
                lobby.players = validPlayers;
                console.log(`🧹 Limpiados ${lobby.players.length - validPlayers.length} jugadores fantasma del lobby ${lobby.id}`);
            }
        }
    }

    if (cleaned > 0) {
        console.log(`🧹 Se eliminaron ${cleaned} lobbies vacíos`);
    }

    return cleaned;
}

// ✅ NUEVA FUNCIÓN: Limpiar lobbies por inactividad
export function cleanupInactiveLobbies(maxInactivityMs: number = 30 * 60 * 1000): number {
    let cleaned = 0;
    const now = Date.now();

    for (let i = lobbies.length - 1; i >= 0; i--) {
        const lobby = lobbies[i];
        const inactiveTime = now - (lobby.lastActivity || lobby.startTime || 0);

        // Solo limpiar lobbies terminados o en espera que estén inactivos
        if (inactiveTime > maxInactivityMs &&
            (lobby.gameState === 'finished' ||
                (lobby.gameState === 'waiting' && !lobby.started))) {

            console.log(`🧹 Eliminando lobby inactivo: ${lobby.id} (inactivo por ${Math.round(inactiveTime / 1000)}s)`);
            lobbies.splice(i, 1);
            cleaned++;
        }
    }

    if (cleaned > 0) {
        console.log(`🧹 Se eliminaron ${cleaned} lobbies inactivos`);
    }

    return cleaned;
}

// ✅ NUEVA FUNCIÓN: Limpieza completa (vacíos + inactivos)
export function performFullCleanup(): { emptyLobbies: number; inactiveLobbies: number } {
    console.log("🧹 Iniciando limpieza completa de lobbies...");

    const emptyLobbies = cleanupEmptyLobbies();
    const inactiveLobbies = cleanupInactiveLobbies();

    console.log(`🧹 Limpieza completa terminada: ${emptyLobbies} vacíos, ${inactiveLobbies} inactivos`);

    return { emptyLobbies, inactiveLobbies };
}

// ✅ NUEVA FUNCIÓN: Obtener estadísticas de lobbies
export function getLobbiesStats(): {
    totalLobbies: number;
    waitingLobbies: number;
    playingLobbies: number;
    finishedLobbies: number;
    emptyLobbies: number;
    totalPlayers: number;
} {
    let waiting = 0, playing = 0, finished = 0, empty = 0, totalPlayers = 0;

    for (const lobby of lobbies) {
        if (lobby.players.length === 0) {
            empty++;
        } else {
            totalPlayers += lobby.players.length;

            if (lobby.gameState === 'playing') playing++;
            else if (lobby.gameState === 'finished') finished++;
            else waiting++;
        }
    }

    return {
        totalLobbies: lobbies.length,
        waitingLobbies: waiting,
        playingLobbies: playing,
        finishedLobbies: finished,
        emptyLobbies: empty,
        totalPlayers
    };
}




export function eliminatePlayerFromLobby(
    socketId: string,
    questionIndex: number,
    correctAnswers: number,
    questionsAnswered: number
) {
    const lobby = lobbies.find(l => l.players.some(p => p.socketId === socketId));
    if (!lobby) {
        console.error(`Lobby no encontrado para socketId: ${socketId}`);
        return null;
    }

    const player = lobby.players.find(p => p.socketId === socketId);
    if (!player || !player.isAlive) {
        console.log(`Jugador no encontrado o ya eliminado: ${player?.name || 'Desconocido'}`);
        return null;
    }

    // NO eliminar jugadores que ya ganaron
    if (player.won === true || (player.finalPosition && player.finalPosition === 1)) {
        console.log(`${player.name} ya es ganador confirmado - NO procesar eliminación`);
        return null;
    }

    const totalPlayers = lobby.totalPlayersAtStart || lobby.players.length;

    // 🚨 CRÍTICO: ACTUALIZAR ESTADÍSTICAS CON LOS DATOS RECIBIDOS
    // Estos son los datos más actualizados del cliente
    console.log(`📊 ACTUALIZANDO estadísticas de ${player.name}:`);
    console.log(`   Antes: ${player.correctAnswers}/${player.questionsAnswered}`);
    console.log(`   Después: ${correctAnswers}/${questionsAnswered}`);

    player.correctAnswers = correctAnswers;
    player.questionsAnswered = questionsAnswered;

    console.log(`Eliminando jugador: ${player.name} del lobby ${lobby.id}`);
    console.log(`Total jugadores en el juego: ${totalPlayers}`);
    console.log(`Estadísticas finales: ${player.correctAnswers}/${player.questionsAnswered}`);

    // Contar jugadores vivos ANTES de eliminar
    const alivePlayersBeforeElimination = getAlivePlayers(lobby.id);
    console.log(`Jugadores vivos ANTES: ${alivePlayersBeforeElimination.length}`);

    // Determinar si habrá ganador automático
    let automaticWinner = null;
    if (alivePlayersBeforeElimination.length === 2) {
        // Solo quedan 2 vivos, el otro será ganador automático
        automaticWinner = alivePlayersBeforeElimination.find(p => p.socketId !== socketId);
        console.log(`DETECTADO: ${automaticWinner?.name} será ganador automático`);
    }

    // Marcar como eliminado
    const eliminationTimestamp = player.eliminationTime || Date.now();
    if (!player.eliminationTime) {
        player.eliminationTime = eliminationTimestamp;
        console.log(`${player.name} marcado como eliminado en: ${new Date(eliminationTimestamp).toISOString()}`);
    }

    player.isAlive = false;
    player.won = false;

    // Contar jugadores vivos DESPUÉS de eliminar
    const alivePlayersAfterElimination = getAlivePlayers(lobby.id);
    const remainingPlayers = alivePlayersAfterElimination.length;
    console.log(`Jugadores vivos DESPUÉS: ${remainingPlayers}`);

    // CÁLCULO DE POSICIÓN BASADO EN JUGADORES RESTANTES
    const correctPosition = remainingPlayers + 1;

    console.log(`Cálculo posición: ${remainingPlayers} jugadores restantes → Posición ${correctPosition} para ${player.name}`);
    console.log(`📊 VERIFICACIÓN: ${player.name} con ${player.correctAnswers}/${player.questionsAnswered} → Posición ${correctPosition}`);

    player.finalPosition = correctPosition;

    // Si hay ganador automático, actualizarlo
    if (automaticWinner && remainingPlayers === 1) {
        // 🚨 IMPORTANTE: NO alterar las estadísticas del ganador automático aquí
        // Sus estadísticas se actualizarán cuando termine naturalmente
        automaticWinner.finalPosition = 1;
        automaticWinner.won = true;
        automaticWinner.isAlive = true;
        console.log(`Ganador automático: ${automaticWinner.name} → Posición 1 (estadísticas se preservan)`);
    }

    console.log(`RESULTADO ELIMINACIÓN:`);
    console.log(`   - ${player.name}: ${correctAnswers}/${questionsAnswered} → Posición ${correctPosition}`);
    console.log(`   - Jugadores restantes: ${remainingPlayers}/${totalPlayers}`);
    if (automaticWinner) {
        console.log(`   - Ganador automático: ${automaticWinner.name} → Posición 1`);
    }

    // Actualizar actividad del lobby
    lobby.lastActivity = Date.now();

    // Agregar a orden de eliminación
    if (!lobby.eliminationOrder) lobby.eliminationOrder = [];
    if (!lobby.eliminationOrder.includes(player.name)) {
        lobby.eliminationOrder.push(player.name);
    }

    return {
        lobby,
        player,
        position: correctPosition,
        totalPlayers: totalPlayers,
        remainingPlayers,
        eliminationOrder: lobby.eliminationOrder,
        automaticWinner: automaticWinner
    };
}


export function declareWinnerInLobby(socketId: string, correctAnswers: number, questionsAnswered: number) {
    const lobby = lobbies.find(l => l.players.some(p => p.socketId === socketId));
    if (!lobby) return null;

    const winner = lobby.players.find(p => p.socketId === socketId);
    if (!winner || !winner.isAlive) return null;

    console.log(`🏆 ${winner.name} es el ganador del lobby ${lobby.id}!`);

    winner.finalPosition = 1;
    winner.correctAnswers = correctAnswers;
    winner.questionsAnswered = questionsAnswered;

    const otherAlivePlayers = lobby.players.filter(p => p.isAlive && p.socketId !== socketId);
    otherAlivePlayers.forEach(player => {
        player.isAlive = false;
        if (!player.finalPosition || player.finalPosition <= 0) {
            player.finalPosition = lobby.totalPlayersAtStart || lobby.players.length;
        }
    });

    lobby.gameState = 'finished';
    lobby.lastActivity = Date.now();

    return {
        lobby,
        winner,
        position: 1,
        totalPlayers: lobby.totalPlayersAtStart || lobby.players.length
    };
}

export function checkGameEndInLobby(lobbyId: string) {
    const lobby = lobbies.find(l => l.id === lobbyId);
    if (!lobby) return null;

    const alivePlayers = getAlivePlayers(lobbyId);

    if (alivePlayers.length <= 1) {
        lobby.gameState = 'finished';
        lobby.lastActivity = Date.now();

        if (alivePlayers.length === 1) {
            const lastPlayer = alivePlayers[0];
            lastPlayer.finalPosition = 1;

            return {
                shouldEnd: true,
                winner: lastPlayer.name,
                lobby
            };
        } else {
            return {
                shouldEnd: true,
                winner: null,
                lobby
            };
        }
    }

    return { shouldEnd: false, lobby };
}

export function getAlivePlayers(lobbyId: string) {
    console.log(`\n🔍 ========== getAlivePlayers(${lobbyId}) ==========`);

    const lobby = lobbies.find(l => l.id === lobbyId);
    if (!lobby) {
        console.log(`❌ Lobby ${lobbyId} no encontrado`);
        return [];
    }

    console.log(`🔍 Lobby encontrado con ${lobby.players.length} jugadores:`);
    lobby.players.forEach((p, i) => {
        console.log(`   ${i + 1}. ${p.name}:`);
        console.log(`      - socketId: ${p.socketId}`);
        console.log(`      - isAlive: ${p.isAlive} (tipo: ${typeof p.isAlive})`);
        console.log(`      - finalPosition: ${p.finalPosition}`);
    });

    const alivePlayers = lobby.players.filter(p => {
        const isAlive = p.isAlive === true;
        console.log(`   🔍 ${p.name}: p.isAlive === true? ${isAlive}`);
        return isAlive;
    });

    console.log(`🔍 Resultado: ${alivePlayers.length} jugadores vivos`);
    alivePlayers.forEach(p => {
        console.log(`   ✅ ${p.name} (${p.socketId}) está vivo`);
    });

    console.log(`🔍 ========== FIN getAlivePlayers ==========\n`);
    return alivePlayers;
}

export function createFinalRankingFromLobby(lobby: Lobby) {
    if (!lobby) return null;

    const finalPositions: Record<string, number> = {};
    const finalRanking: string[] = [];
    const stats: Record<string, { questionsAnswered: number; correctAnswers: number }> = {};

    const totalPlayers = lobby.totalPlayersAtStart || lobby.players.length;
    const usedPositions = new Set<number>();

    lobby.players.forEach(player => {
        if (!player.finalPosition || player.finalPosition <= 0 || player.finalPosition > totalPlayers) {
            for (let pos = 1; pos <= totalPlayers; pos++) {
                if (!usedPositions.has(pos) && !lobby.players.some(p => p.finalPosition === pos && p !== player)) {
                    player.finalPosition = pos;
                    break;
                }
            }
        }

        if (player.finalPosition !== undefined) {
            usedPositions.add(player.finalPosition);
        }
    });

    const sortedPlayers = [...lobby.players].sort((a, b) => {
        return (a.finalPosition || 999) - (b.finalPosition || 999);
    });

    sortedPlayers.forEach(player => {
        if (player.finalPosition !== undefined) {
            finalPositions[player.name] = player.finalPosition;
            finalRanking.push(player.name);
            stats[player.name] = {
                questionsAnswered: player.questionsAnswered || 0,
                correctAnswers: player.correctAnswers || 0
            };
        }
    });

    return {
        positions: finalPositions,
        ranking: finalRanking,
        eliminationOrder: lobby.eliminationOrder || [],
        totalPlayers: totalPlayers,
        stats
    };
}

export function cleanupLobby(lobbyId: string) {
    const index = lobbies.findIndex(l => l.id === lobbyId);
    if (index !== -1) {
        console.log(`🧹 Limpiando lobby terminado: ${lobbyId}`);
        lobbies.splice(index, 1);
    }
}

export function findLobbyBySocketId(socketId: string) {
    return lobbies.find(l => l.players.some(p => p.socketId === socketId));
}

// ✅ CONFIGURAR LIMPIEZA AUTOMÁTICA PERIÓDICA
setInterval(() => {
    performFullCleanup();
}, 5 * 60 * 1000); // Cada 5 minutos