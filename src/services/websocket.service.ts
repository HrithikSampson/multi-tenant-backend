import { Server as SocketIOServer } from 'socket.io';
import { Server as HTTPServer } from 'http';
import { Activity } from '../entity/activity.entity';
import { ActivityKind } from '../db/enums';

export class WebSocketService {
  private io: SocketIOServer;
  private connectedUsers: Map<string, Set<string>> = new Map(); // roomKey -> Set of socketIds

  constructor(httpServer: HTTPServer) {
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: [
          'http://localhost:3000',
          'http://localhost:3001',
          'https://multi-tenant-frontend-opal.vercel.app'
        ],
        credentials: true
      }
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    this.io.on('connection', (socket) => {
      console.log(`User connected: ${socket.id}`);

      // Join organization room
      socket.on('join-organization', (roomKey: string) => {
        console.log(`User ${socket.id} joining room: ${roomKey}`);
        socket.join(roomKey);
        
        // Track connected users for this room
        if (!this.connectedUsers.has(roomKey)) {
          this.connectedUsers.set(roomKey, new Set());
        }
        this.connectedUsers.get(roomKey)!.add(socket.id);
        
        socket.emit('joined-room', { roomKey, message: `Joined organization room: ${roomKey}` });
      });

      // Leave organization room
      socket.on('leave-organization', (roomKey: string) => {
        console.log(`User ${socket.id} leaving room: ${roomKey}`);
        socket.leave(roomKey);
        
        // Remove from tracking
        const roomUsers = this.connectedUsers.get(roomKey);
        if (roomUsers) {
          roomUsers.delete(socket.id);
          if (roomUsers.size === 0) {
            this.connectedUsers.delete(roomKey);
          }
        }
        
        socket.emit('left-room', { roomKey, message: `Left organization room: ${roomKey}` });
      });

      // Handle activity filter changes
      socket.on('filter-activities', (data: { roomKey: string, kind?: string }) => {
        console.log(`User ${socket.id} filtering activities in room ${data.roomKey} by kind: ${data.kind}`);
        // This could trigger a re-fetch of activities with the new filter
        socket.to(data.roomKey).emit('activity-filter-changed', data);
      });

      socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        
        // Remove from all rooms
        for (const [roomKey, users] of this.connectedUsers.entries()) {
          if (users.has(socket.id)) {
            users.delete(socket.id);
            if (users.size === 0) {
              this.connectedUsers.delete(roomKey);
            }
          }
        }
      });
    });
  }

  // Broadcast new activity to organization room
  public broadcastActivity(roomKey: string, activity: Activity) {
    console.log(`Broadcasting activity to room: ${roomKey}`, activity);
    this.io.to(roomKey).emit('new-activity', {
      activity,
      timestamp: new Date().toISOString()
    });
  }

  // Broadcast activity update to organization room
  public broadcastActivityUpdate(roomKey: string, activity: Activity) {
    console.log(`Broadcasting activity update to room: ${roomKey}`, activity);
    this.io.to(roomKey).emit('activity-updated', {
      activity,
      timestamp: new Date().toISOString()
    });
  }

  // Broadcast activity deletion to organization room
  public broadcastActivityDeletion(roomKey: string, activityId: string) {
    console.log(`Broadcasting activity deletion to room: ${roomKey}`, activityId);
    this.io.to(roomKey).emit('activity-deleted', {
      activityId,
      timestamp: new Date().toISOString()
    });
  }

  // Get connected users count for a room
  public getRoomUserCount(roomKey: string): number {
    return this.connectedUsers.get(roomKey)?.size || 0;
  }

  // Get all connected rooms
  public getConnectedRooms(): string[] {
    return Array.from(this.connectedUsers.keys());
  }

  // Broadcast system message to organization room
  public broadcastSystemMessage(roomKey: string, message: string, kind: ActivityKind = ActivityKind.ANNOUNCE) {
    console.log(`Broadcasting system message to room: ${roomKey}`, message);
    this.io.to(roomKey).emit('system-message', {
      message,
      kind,
      timestamp: new Date().toISOString()
    });
  }

  // Get the Socket.IO instance for direct access if needed
  public getIO(): SocketIOServer {
    return this.io;
  }
}

// Singleton instance
let webSocketService: WebSocketService | null = null;

export const initializeWebSocket = (httpServer: HTTPServer): WebSocketService => {
  if (!webSocketService) {
    webSocketService = new WebSocketService(httpServer);
  }
  return webSocketService;
};

export const getWebSocketService = (): WebSocketService | null => {
  return webSocketService;
};
