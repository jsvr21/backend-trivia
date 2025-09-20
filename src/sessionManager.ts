// sessionManager.ts - Sistema para prevenir múltiples sesiones - ARREGLADO
import { Socket } from "socket.io";

interface ActiveSession {
    socketId: string;
    email: string;
    name: string;
    lobbyId: string | null;
    joinTime: number;
    lastActivity: number;
    isInGame: boolean;
    isBeingReplaced?: boolean; // NUEVO: flag para evitar loops
}

// Mapa de sesiones activas por email
const activeSessions = new Map<string, ActiveSession>();

// Mapa inverso para buscar por socketId
const socketToSession = new Map<string, string>(); // socketId -> email

export class SessionManager {
    
    // Verificar si una cuenta ya está conectada
    static isAccountConnected(email: string): boolean {
        const session = activeSessions.get(email);
        return session ? !session.isBeingReplaced : false; // No contar como activa si está siendo reemplazada
    }

    // Obtener sesión activa por email
    static getActiveSession(email: string): ActiveSession | null {
        const session = activeSessions.get(email);
        return (session && !session.isBeingReplaced) ? session : null;
    }

    // Obtener sesión por socketId
    static getSessionBySocketId(socketId: string): ActiveSession | null {
        const email = socketToSession.get(socketId);
        return email ? activeSessions.get(email) || null : null;
    }

    // NUEVO: Marcar sesión como siendo reemplazada
    static markSessionForReplacement(email: string): void {
        const session = activeSessions.get(email);
        if (session) {
            session.isBeingReplaced = true;
            console.log(`🔄 Sesión de ${email} marcada para reemplazo`);
        }
    }

    // Crear nueva sesión (reemplaza la anterior si existe)
    static createSession(socketId: string, email: string, name: string): {
        isNewSession: boolean;
        previousSession: ActiveSession | null;
        currentSession: ActiveSession;
    } {
        console.log(`📱 Creando sesión para ${email} (${name})`);

        // Verificar si ya existe una sesión activa
        const existingSession = activeSessions.get(email);
        const isNewSession: boolean = !existingSession || Boolean(existingSession.isBeingReplaced);

        // Si hay sesión anterior, limpiar mapeo del socket anterior
        if (existingSession) {
            console.log(`⚠️ Sesión existente encontrada para ${email}:`);
            console.log(`   - Socket anterior: ${existingSession.socketId}`);
            console.log(`   - Lobby: ${existingSession.lobbyId}`);
            console.log(`   - En juego: ${existingSession.isInGame}`);
            console.log(`   - Siendo reemplazada: ${existingSession.isBeingReplaced}`);
            
            // Limpiar mapeo del socket anterior
            socketToSession.delete(existingSession.socketId);
        }

        // Crear nueva sesión
        const newSession: ActiveSession = {
            socketId,
            email,
            name,
            lobbyId: (existingSession && !existingSession.isBeingReplaced) ? existingSession.lobbyId : null, // Solo heredar si no es reemplazo forzado
            joinTime: Date.now(),
            lastActivity: Date.now(),
            isInGame: (existingSession && !existingSession.isBeingReplaced) ? existingSession.isInGame : false,
            isBeingReplaced: false
        };

        // Actualizar mapas
        activeSessions.set(email, newSession);
        socketToSession.set(socketId, email);

        console.log(`✅ Nueva sesión creada para ${email}`);
        console.log(`   - Socket nuevo: ${socketId}`);
        console.log(`   - Lobby heredado: ${newSession.lobbyId}`);

        return {
            isNewSession,
            previousSession: existingSession || null,
            currentSession: newSession
        };
    }

    // Actualizar actividad de la sesión
    static updateActivity(socketId: string): void {
        const session = SessionManager.getSessionBySocketId(socketId);
        if (session && !session.isBeingReplaced) {
            session.lastActivity = Date.now();
        }
    }

    // Actualizar lobby de la sesión
    static updateSessionLobby(socketId: string, lobbyId: string | null): void {
        const session = SessionManager.getSessionBySocketId(socketId);
        if (session && !session.isBeingReplaced) {
            session.lobbyId = lobbyId;
            console.log(`🏠 Lobby actualizado para ${session.email}: ${lobbyId}`);
        }
    }

    // Marcar sesión como en juego
    static setInGame(socketId: string, inGame: boolean): void {
        const session = SessionManager.getSessionBySocketId(socketId);
        if (session && !session.isBeingReplaced) {
            session.isInGame = inGame;
            console.log(`🎮 Estado de juego para ${session.email}: ${inGame}`);
        }
    }

    // Remover sesión
    static removeSession(socketId: string): ActiveSession | null {
        const email = socketToSession.get(socketId);
        if (!email) return null;

        const session = activeSessions.get(email);
        if (session) {
            activeSessions.delete(email);
            socketToSession.delete(socketId);
            console.log(`🗑️ Sesión removida para ${email}`);
            return session;
        }
        return null;
    }

    // MEJORADO: Desconectar sesión anterior con mejor control
    static disconnectPreviousSession(io: any, previousSocketId: string, reason: string): void {
        console.log(`🔌 Desconectando sesión anterior: ${previousSocketId} - Razón: ${reason}`);
        
        const socket = io.sockets.sockets.get(previousSocketId);
        if (socket) {
            // Notificar al cliente anterior antes de desconectar
            socket.emit("sessionReplaced", {
                message: "Tu cuenta se ha conectado desde otro dispositivo",
                reason: "duplicate_login",
                timestamp: Date.now()
            });

            // Desconectar inmediatamente sin delay
            socket.disconnect(true);
            console.log(`✅ Socket ${previousSocketId} desconectado exitosamente`);
        } else {
            console.log(`⚠️ Socket ${previousSocketId} no encontrado para desconectar`);
        }
    }

    // Limpiar sesiones inactivas (llamar periódicamente)
    static cleanupInactiveSessions(maxInactivityMs: number = 30 * 60 * 1000): number { // 30 minutos por defecto
        const now = Date.now();
        let cleaned = 0;

        for (const [email, session] of activeSessions.entries()) {
            const inactiveTime = now - session.lastActivity;
            // No limpiar sesiones que están siendo reemplazadas o en juego
            if (inactiveTime > maxInactivityMs && !session.isInGame && !session.isBeingReplaced) {
                console.log(`🧹 Limpiando sesión inactiva: ${email} (inactiva por ${Math.round(inactiveTime / 1000)}s)`);
                activeSessions.delete(email);
                socketToSession.delete(session.socketId);
                cleaned++;
            }
        }

        if (cleaned > 0) {
            console.log(`🧹 Se limpiaron ${cleaned} sesiones inactivas`);
        }

        return cleaned;
    }

    // Obtener estadísticas de sesiones
    static getStats(): {
        totalSessions: number;
        inGameSessions: number;
        inLobbySessions: number;
        idleSessions: number;
        beingReplacedSessions: number;
    } {
        let inGame = 0;
        let inLobby = 0;
        let idle = 0;
        let beingReplaced = 0;

        for (const session of activeSessions.values()) {
            if (session.isBeingReplaced) {
                beingReplaced++;
            } else if (session.isInGame) {
                inGame++;
            } else if (session.lobbyId) {
                inLobby++;
            } else {
                idle++;
            }
        }

        return {
            totalSessions: activeSessions.size,
            inGameSessions: inGame,
            inLobbySessions: inLobby,
            idleSessions: idle,
            beingReplacedSessions: beingReplaced
        };
    }

    // Debug: Listar todas las sesiones activas
    static debugListSessions(): void {
        console.log(`📊 SESIONES ACTIVAS (${activeSessions.size}):`);
        for (const [email, session] of activeSessions.entries()) {
            const inactiveTime = Date.now() - session.lastActivity;
            console.log(`  📱 ${email}:`);
            console.log(`     - Socket: ${session.socketId}`);
            console.log(`     - Lobby: ${session.lobbyId || 'ninguno'}`);
            console.log(`     - En juego: ${session.isInGame}`);
            console.log(`     - Siendo reemplazada: ${session.isBeingReplaced}`);
            console.log(`     - Inactivo por: ${Math.round(inactiveTime / 1000)}s`);
        }
    }
}

// Configurar limpieza automática cada 5 minutos
setInterval(() => {
    SessionManager.cleanupInactiveSessions();
}, 5 * 60 * 1000);

// ✅ NUEVA FUNCIÓN: Verificar si un lobby está vacío por email
export function isLobbyEmpty(lobbyId: string): boolean {
    let activePlayersInLobby = 0;
    
    for (const [email, session] of activeSessions.entries()) {
        if (session.lobbyId === lobbyId && !session.isBeingReplaced) {
            activePlayersInLobby++;
        }
    }
    
    return activePlayersInLobby === 0;
}

// ✅ NUEVA FUNCIÓN: Obtener lobbies vacíos
export function getEmptyLobbies(): string[] {
    const allLobbyIds = new Set<string>();
    const activeLobbyIds = new Set<string>();
    
    // Obtener todos los lobby IDs de las sesiones activas
    for (const session of activeSessions.values()) {
        if (session.lobbyId && !session.isBeingReplaced) {
            allLobbyIds.add(session.lobbyId);
            activeLobbyIds.add(session.lobbyId);
        }
    }
    
    return Array.from(allLobbyIds).filter(lobbyId => isLobbyEmpty(lobbyId));
}

// ✅ NUEVA FUNCIÓN: Limpiar sesiones de un lobby específico
export function clearSessionsFromLobby(lobbyId: string): number {
    let cleared = 0;
    
    for (const [email, session] of activeSessions.entries()) {
        if (session.lobbyId === lobbyId) {
            activeSessions.delete(email);
            socketToSession.delete(session.socketId);
            cleared++;
        }
    }
    
    console.log(`🧹 Se limpiaron ${cleared} sesiones del lobby ${lobbyId}`);
    return cleared;
}