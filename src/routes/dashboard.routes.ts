import express from "express";
import {
  // Endpoints existentes (base de datos)
  getDashboardStats,
  getTopPlayers,
  getCategoryStats,
  getPlayerActivity,
  getWeeklyStats,
  getGameOutcomes,
  getRecentGames,
  
  // Nuevos endpoints en tiempo real (lobbies)
  getRealTimeStats,
  getActiveGames,
  getLivePlayerStats,
  getLiveActivity
} from "../controllers/dashboard.controller.js";

const router = express.Router();

// ==================== RUTAS EXISTENTES (BASE DE DATOS) ====================
// Ruta para estadísticas generales del dashboard
router.get("/stats", getDashboardStats);

// Ruta para obtener top jugadores (histórico)
router.get("/top-players", getTopPlayers);

// Ruta para estadísticas por categoría
router.get("/category-stats", getCategoryStats);

// Ruta para actividad de jugadores en 24h (histórico)
router.get("/player-activity", getPlayerActivity);

// Ruta para estadísticas semanales
router.get("/weekly-stats", getWeeklyStats);

// Ruta para resultados de juegos (completados, abandonados, etc.)
router.get("/game-outcomes", getGameOutcomes);

// Ruta para juegos recientes/activos (ahora desde lobbies reales)
router.get("/recent-games", getRecentGames);

// ==================== NUEVAS RUTAS EN TIEMPO REAL (LOBBIES) ====================
// 📊 Estadísticas en tiempo real desde lobbies activos
router.get("/real-time-stats", getRealTimeStats);

// 🎮 Juegos activos detallados
router.get("/active-games", getActiveGames);

// 📈 Estadísticas de jugadores en tiempo real
router.get("/live-player-stats", getLivePlayerStats);

// 🔥 Actividad en tiempo real (últimos 30 minutos)
router.get("/live-activity", getLiveActivity);

export default router;