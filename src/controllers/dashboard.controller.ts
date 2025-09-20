import { Request, Response } from "express";
import { GameResultModel } from "../models/GameResult.js";
import { QuestionModel } from "../models/Question.js";
import { User } from "../models/User.js";
import { lobbies as rawLobbies } from "../lobbies.js";

// ✅ Tipos para Lobby y Player (actualizados)
interface Player {
    socketId: string;
    name: string;
    email?: string;
    isReady: boolean;
    isAlive?: boolean;
    correctAnswers?: number;
    questionsAnswered?: number;
    joinTime?: number;
    eliminationTime?: number;
    finalPosition?: number;
    won?: boolean;
}

interface Lobby {
    id: string;
    players: Player[];
    maxPlayers: number;
    started: boolean;
    gameState?: 'waiting' | 'playing' | 'finished';
    currentQuestion?: number;
    eliminationOrder?: string[];
    startTime?: number;
    totalPlayersAtStart?: number;
    category?: string;
}

const lobbies: Lobby[] = rawLobbies;

// -------------------- ENDPOINTS EXISTENTES (mantener como están) --------------------

// Obtener estadísticas generales del dashboard (USAR BASE DE DATOS)
export const getDashboardStats = async (req: Request, res: Response) => {
    try {
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        const startOfToday = new Date(today.setHours(0, 0, 0, 0));
        const startOfYesterday = new Date(yesterday.setHours(0, 0, 0, 0));

        const totalUsers = await User.countDocuments();
        const totalQuestions = await QuestionModel.countDocuments();

        const gamesToday = await GameResultModel.countDocuments({
            createdAt: { $gte: startOfToday }
        });

        const gamesYesterday = await GameResultModel.countDocuments({
            createdAt: { $gte: startOfYesterday, $lt: startOfToday }
        });

        const avgGameTimeResult = await GameResultModel.aggregate([
            {
                $addFields: {
                    gameTimeInSeconds: {
                        $let: {
                            vars: { parts: { $split: ["$gameTime", ":"] } },
                            in: {
                                $add: [
                                    { $multiply: [{ $toInt: { $arrayElemAt: ["$$parts", 0] } }, 60] },
                                    { $toInt: { $arrayElemAt: ["$$parts", 1] } }
                                ]
                            }
                        }
                    }
                }
            },
            { $group: { _id: null, avgSeconds: { $avg: "$gameTimeInSeconds" } } }
        ]);

        const avgGameTimeSeconds = avgGameTimeResult[0]?.avgSeconds || 0;
        const avgGameTime = `${Math.floor(avgGameTimeSeconds / 60)}:${String(Math.floor(avgGameTimeSeconds % 60)).padStart(2, '0')}`;

        const gameGrowth = gamesYesterday > 0
            ? Math.round(((gamesToday - gamesYesterday) / gamesYesterday) * 100)
            : gamesToday > 0 ? 100 : 0;

        res.json({
            totalUsers,
            totalQuestions,
            gamesToday,
            gamesYesterday,
            gameGrowth,
            avgGameTime,
            totalGames: await GameResultModel.countDocuments()
        });

    } catch (error) {
        console.error("Error obteniendo estadísticas del dashboard:", error);
        res.status(500).json({ message: "Error al obtener estadísticas", error });
    }
};

// -------------------- NUEVOS ENDPOINTS PARA TIEMPO REAL --------------------

// 📊 ESTADÍSTICAS EN TIEMPO REAL DESDE LOBBIES
export const getRealTimeStats = (req: Request, res: Response) => {
    try {
        const activeLobbies = lobbies.filter(l => l.gameState === 'playing' || l.gameState === 'waiting');
        const waitingLobbies = lobbies.filter(l => l.gameState === 'waiting');
        const playingLobbies = lobbies.filter(l => l.gameState === 'playing');
        
        const totalActivePlayers = activeLobbies.reduce((sum, lobby) => 
            sum + lobby.players.filter(p => p.isAlive !== false).length, 0
        );
        
        const totalActiveGames = playingLobbies.length;
        const totalWaitingGames = waitingLobbies.length;
        
        // Calcular tiempo promedio de juegos en progreso
        const averageGameTime = playingLobbies.length > 0 
            ? playingLobbies.reduce((sum, lobby) => {
                const gameTime = lobby.startTime ? Date.now() - lobby.startTime : 0;
                return sum + gameTime;
              }, 0) / playingLobbies.length
            : 0;
        
        const formatTime = (ms: number) => {
            const minutes = Math.floor(ms / 60000);
            const seconds = Math.floor((ms % 60000) / 1000);
            return `${minutes}:${seconds.toString().padStart(2, '0')}`;
        };

        const stats = {
            totalActiveLobbies: activeLobbies.length,
            totalActivePlayers: totalActivePlayers,
            activeGames: totalActiveGames,
            waitingGames: totalWaitingGames,
            averageGameTime: formatTime(averageGameTime),
            lobbiesDetails: activeLobbies.map(lobby => ({
                id: lobby.id,
                state: lobby.gameState,
                playersCount: lobby.players.length,
                alivePlayersCount: lobby.players.filter(p => p.isAlive !== false).length,
                maxPlayers: lobby.maxPlayers,
                startTime: lobby.startTime,
                currentQuestion: lobby.currentQuestion || 0,
                players: lobby.players.map(p => ({
                    name: p.name,
                    email: p.email,
                    isAlive: p.isAlive,
                    isReady: p.isReady,
                    correctAnswers: p.correctAnswers || 0,
                    questionsAnswered: p.questionsAnswered || 0,
                    finalPosition: p.finalPosition
                }))
            }))
        };

        console.log("📊 Dashboard stats generadas:", {
            activeLobbies: stats.totalActiveLobbies,
            activePlayers: stats.totalActivePlayers,
            activeGames: stats.activeGames
        });

        res.json(stats);
    } catch (error) {
        console.error("❌ Error generando stats del dashboard:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
};

// 🎮 JUEGOS ACTIVOS DETALLADOS DESDE LOBBIES
export const getActiveGames = (req: Request, res: Response) => {
    try {
        const activeGames = lobbies
            .filter(l => l.gameState === 'playing' || l.gameState === 'waiting')
            .map(lobby => ({
                id: lobby.id,
                status: lobby.gameState === 'playing' ? 'En Progreso' : 'Esperando Jugadores',
                playersCount: lobby.players.length,
                maxPlayers: lobby.maxPlayers,
                currentQuestion: lobby.currentQuestion || 1,
                totalQuestions: 5,
                startTime: lobby.startTime,
                gameTime: lobby.startTime ? Date.now() - lobby.startTime : 0,
                players: lobby.players.map(player => ({
                    name: player.name,
                    email: player.email || 'N/A',
                    status: player.isAlive === false ? 'Eliminado' : 
                           player.isReady ? 'Listo' : 'Esperando',
                    isAlive: player.isAlive !== false,
                    correctAnswers: player.correctAnswers || 0,
                    questionsAnswered: player.questionsAnswered || 0,
                    finalPosition: player.finalPosition
                }))
            }));

        console.log("🎮 Juegos activos encontrados:", activeGames.length);
        res.json(activeGames);
    } catch (error) {
        console.error("❌ Error obteniendo juegos activos:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
};

// 📈 ESTADÍSTICAS DE JUGADORES EN TIEMPO REAL
export const getLivePlayerStats = (req: Request, res: Response) => {
    try {
        const playerStats: Record<string, {
            gamesPlayed: number,
            currentlyPlaying: boolean,
            totalCorrectAnswers: number,
            totalQuestionsAnswered: number,
            averagePosition: number,
            lastSeen: number
        }> = {};

        // Recopilar estadísticas de lobbies activos
        lobbies.forEach(lobby => {
            lobby.players.forEach(player => {
                if (!playerStats[player.name]) {
                    playerStats[player.name] = {
                        gamesPlayed: 0,
                        currentlyPlaying: false,
                        totalCorrectAnswers: 0,
                        totalQuestionsAnswered: 0,
                        averagePosition: 0,
                        lastSeen: Date.now()
                    };
                }

                const stats = playerStats[player.name];
                stats.currentlyPlaying = lobby.gameState === 'playing' && player.isAlive !== false;
                stats.totalCorrectAnswers += player.correctAnswers || 0;
                stats.totalQuestionsAnswered += player.questionsAnswered || 0;
                stats.lastSeen = Math.max(stats.lastSeen, player.joinTime || Date.now());

                if (lobby.gameState === 'playing') {
                    stats.gamesPlayed++;
                }
            });
        });

        const topPlayers = Object.entries(playerStats)
            .map(([name, stats]) => ({
                name,
                ...stats,
                accuracy: stats.totalQuestionsAnswered > 0 
                    ? Math.round((stats.totalCorrectAnswers / stats.totalQuestionsAnswered) * 100)
                    : 0
            }))
            .sort((a, b) => b.accuracy - a.accuracy)
            .slice(0, 10);

        console.log("📈 Top players en tiempo real:", topPlayers.length);
        res.json(topPlayers);
    } catch (error) {
        console.error("❌ Error obteniendo stats de jugadores:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
};

// 🔥 ACTIVIDAD EN TIEMPO REAL (ÚLTIMOS 30 MINUTOS)
export const getLiveActivity = (req: Request, res: Response) => {
    try {
        const now = Date.now();

        // Generar puntos de actividad cada 5 minutos en los últimos 30 minutos
        const activityPoints = [];
        for (let i = 6; i >= 0; i--) {
            const timePoint = now - (i * 5 * 60 * 1000);
            const timeLabel = new Date(timePoint).toLocaleTimeString('es-ES', { 
                hour: '2-digit', 
                minute: '2-digit' 
            });

            // Contar lobbies activos aproximadamente en ese momento
            const activeLobbiesAtTime = lobbies.filter(lobby => {
                const lobbyStart = lobby.startTime || lobby.players[0]?.joinTime || now;
                return lobbyStart <= timePoint && 
                       (lobby.gameState === 'playing' || lobby.gameState === 'waiting');
            }).length;

            const activePlayersAtTime = lobbies
                .filter(lobby => {
                    const lobbyStart = lobby.startTime || lobby.players[0]?.joinTime || now;
                    return lobbyStart <= timePoint;
                })
                .reduce((sum, lobby) => sum + lobby.players.length, 0);

            activityPoints.push({
                time: timeLabel,
                games: activeLobbiesAtTime,
                players: activePlayersAtTime
            });
        }

        console.log("🔥 Actividad en tiempo real generada:", activityPoints.length, "puntos");
        res.json(activityPoints);
    } catch (error) {
        console.error("❌ Error generando actividad:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
};

// -------------------- ENDPOINTS EXISTENTES MEJORADOS --------------------

// Obtener top jugadores (MANTENER ORIGINAL - USA BASE DE DATOS)
export const getTopPlayers = async (req: Request, res: Response) => {
    try {
        const topPlayers = await GameResultModel.aggregate([
            {
                $group: {
                    _id: "$userEmail",
                    userName: { $first: "$userName" },
                    totalWins: { $sum: { $cond: [{ $eq: ["$won", true] }, 1, 0] } },
                    totalGames: { $sum: 1 },
                    totalCorrectAnswers: { $sum: "$correctAnswers" },
                    totalQuestionsAnswered: { $sum: "$questionsAnswered" },
                    avgPosition: { $avg: "$position" }
                }
            },
            {
                $addFields: {
                    accuracy: {
                        $cond: [
                            { $gt: ["$totalQuestionsAnswered", 0] },
                            { $multiply: [{ $divide: ["$totalCorrectAnswers", "$totalQuestionsAnswered"] }, 100] },
                            0
                        ]
                    }
                }
            },
            { $sort: { totalWins: -1, accuracy: -1 } },
            { $limit: 10 }
        ]);

        const formattedPlayers = topPlayers.map(player => ({
            name: player.userName,
            email: player._id,
            wins: player.totalWins,
            accuracy: Math.round(player.accuracy),
            totalGames: player.totalGames,
            avgPosition: Math.round(player.avgPosition * 10) / 10
        }));

        res.json(formattedPlayers);

    } catch (error) {
        console.error("Error obteniendo top jugadores:", error);
        res.status(500).json({ message: "Error al obtener top jugadores", error });
    }
};

// Obtener estadísticas por categoría (MANTENER ORIGINAL)
export const getCategoryStats = async (req: Request, res: Response) => {
    try {
        const questionsByCategory = await QuestionModel.aggregate([
            { $group: { _id: "$category", totalQuestions: { $sum: 1 } } }
        ]);

        const categoryStats = questionsByCategory.map(cat => ({
            category: cat._id,
            totalQuestions: cat.totalQuestions,
            accuracy: Math.floor(Math.random() * 30) + 60,
            games: Math.floor(Math.random() * 200) + 100,
            fill: `hsl(var(--chart-${(Math.floor(Math.random() * 5) + 1)}))`
        }));

        res.json(categoryStats);

    } catch (error) {
        console.error("Error obteniendo estadísticas de categorías:", error);
        res.status(500).json({ message: "Error al obtener estadísticas de categorías", error });
    }
};

// Obtener actividad por horas del día (MANTENER ORIGINAL)
export const getPlayerActivity = async (req: Request, res: Response) => {
    try {
        const activityData = await GameResultModel.aggregate([
            { $match: { createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } },
            { $group: { _id: { $hour: "$createdAt" }, players: { $sum: 1 } } },
            { $sort: { _id: 1 } }
        ]);

        const hourlyActivity = Array.from({ length: 24 }, (_, hour) => {
            const activity = activityData.find(item => item._id === hour);
            return { time: `${hour.toString().padStart(2, '0')}:00`, players: activity?.players || 0 };
        });

        const groupedActivity = [
            { time: "00:00", players: hourlyActivity.slice(0, 4).reduce((sum, h) => sum + h.players, 0) },
            { time: "04:00", players: hourlyActivity.slice(4, 8).reduce((sum, h) => sum + h.players, 0) },
            { time: "08:00", players: hourlyActivity.slice(8, 12).reduce((sum, h) => sum + h.players, 0) },
            { time: "12:00", players: hourlyActivity.slice(12, 16).reduce((sum, h) => sum + h.players, 0) },
            { time: "16:00", players: hourlyActivity.slice(16, 20).reduce((sum, h) => sum + h.players, 0) },
            { time: "20:00", players: hourlyActivity.slice(20, 24).reduce((sum, h) => sum + h.players, 0) }
        ];

        res.json(groupedActivity);

    } catch (error) {
        console.error("Error obteniendo actividad de jugadores:", error);
        res.status(500).json({ message: "Error al obtener actividad de jugadores", error });
    }
};

// Obtener estadísticas semanales (MANTENER ORIGINAL)
export const getWeeklyStats = async (req: Request, res: Response) => {
    try {
        const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const now = new Date();
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

        const weeklyData = await GameResultModel.aggregate([
            { $match: { createdAt: { $gte: weekAgo } } },
            { $group: { _id: { $dayOfWeek: "$createdAt" }, games: { $sum: 1 }, players: { $addToSet: "$userEmail" } } },
            { $addFields: { playerCount: { $size: "$players" } } },
            { $sort: { _id: 1 } }
        ]);

        const weeklyStats = weekDays.map((day, index) => {
            const dayData = weeklyData.find(item => item._id === index + 1);
            return { day, games: dayData?.games || 0, players: dayData?.playerCount || 0 };
        });

        res.json(weeklyStats);

    } catch (error) {
        console.error("Error obteniendo estadísticas semanales:", error);
        res.status(500).json({ message: "Error al obtener estadísticas semanales", error });
    }
};

// Obtener resultados de juegos (MANTENER ORIGINAL)
export const getGameOutcomes = async (req: Request, res: Response) => {
    try {
        const totalGames = await GameResultModel.countDocuments();
        const completedGames = await GameResultModel.countDocuments({ questionsAnswered: { $gt: 0 } });

        const outcomes = [
            { name: "Completed", value: Math.round((completedGames / totalGames) * 100) || 75, fill: "hsl(var(--chart-3))" },
            { name: "Eliminated", value: Math.round(((totalGames - completedGames) / totalGames) * 100) || 20, fill: "hsl(var(--chart-5))" },
            { name: "Timeout", value: 5, fill: "hsl(var(--chart-2))" }
        ];

        res.json(outcomes);

    } catch (error) {
        console.error("Error obteniendo resultados de juegos:", error);
        res.status(500).json({ message: "Error al obtener resultados de juegos", error });
    }
};

// ✅ MEJORADO: Obtener juegos recientes/activos DESDE LOBBIES REALES
export const getRecentGames = (req: Request, res: Response) => {
    try {
        // Mostrar SOLO lobbies activos (no terminados)
        const recentGames = lobbies
            .filter(lobby => lobby.gameState === 'playing' || lobby.gameState === 'waiting')
            .map((lobby: Lobby) => {
                const totalQuestions = 5; // Ajustar según tu configuración
                const questionIndex = lobby.currentQuestion ?? 0;

                return {
                    id: lobby.id,
                    players: lobby.players.map((p: Player) => ({
                        name: p.name,
                        email: p.email || (p.name.toLowerCase().replace(/\s/g, "") + "@example.com"),
                        status: p.isAlive === false ? "eliminated" : 
                               p.isReady ? "connected" : "waiting",
                        questionsAnswered: p.questionsAnswered ?? 0,
                        correctAnswers: p.correctAnswers ?? 0,
                        finalPosition: p.finalPosition
                    })),
                    status: lobby.gameState === 'playing' ? "En Progreso" : "Esperando Jugadores",
                    question: questionIndex + 1,
                    totalQuestions,
                    category: lobby.category || "General",
                    startTime: lobby.startTime,
                    playersCount: lobby.players.length,
                    maxPlayers: lobby.maxPlayers
                };
            });

        console.log("🎮 Juegos recientes obtenidos:", recentGames.length);
        res.json(recentGames);
    } catch (error) {
        console.error("Error obteniendo juegos recientes:", error);
        res.status(500).json({ message: "Error al obtener juegos recientes", error });
    }
};