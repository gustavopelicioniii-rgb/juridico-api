import { io, Socket } from 'socket.io-client';
import type { Notification, Job } from '../types/api';

type ServerToServerEvents = {
  'nova-movimentacao': (data: { processoId: string; movimentacao: Notification }) => void;
  'scraping-completo': (data: { job: Job; processo: Notification }) => void;
  'erro-scraping': (data: { job: Job; erro: string }) => void;
  'job-atualizado': (data: Job) => void;
  connect: () => void;
  disconnect: () => void;
};

type SocketClient = Socket<ServerToServerEvents>;

class SocketService {
  private socket: SocketClient | null = null;
  private listeners: Map<string, Set<(...args: unknown[]) => void>> = new Map();

  connect() {
    if (this.socket?.connected) return;

    const token = localStorage.getItem('token');
    if (!token) {
      console.warn('No token available for socket connection');
      return;
    }

    this.socket = io({
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    this.socket.on('connect', () => {
      console.log('Socket connected');
      this.emit('socket:connected', undefined);
    });

    this.socket.on('disconnect', () => {
      console.log('Socket disconnected');
      this.emit('socket:disconnected', undefined);
    });

    this.socket.on('nova-movimentacao', (data) => {
      this.emit('notification', data.movimentacao);
    });

    this.socket.on('scraping-completo', (data) => {
      this.emit('job:completed', data.job);
    });

    this.socket.on('erro-scraping', (data) => {
      this.emit('job:failed', data.job);
    });

    this.socket.on('job-atualizado', (data) => {
      this.emit('job:updated', data);
    });
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  on(event: string, callback: (...args: unknown[]) => void) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }

  off(event: string, callback: (...args: unknown[]) => void) {
    this.listeners.get(event)?.delete(callback);
  }

  private emit(event: string, data: unknown) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach((cb) => cb(data));
    }
  }
}

export const socketService = new SocketService();
