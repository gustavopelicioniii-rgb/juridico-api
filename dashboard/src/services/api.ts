import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import type {
  User,
  Advogado,
  Processo,
  Movimentacao,
  Monitoramento,
  Job,
  Tribunal,
  Notification,
  DashboardStats,
} from '../types/api';

const api = axios.create({
  baseURL: '/api/v1',
  timeout: 30000,
});

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = localStorage.getItem('token');
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export const authService = {
  login: async (oab: string) => {
    const { data } = await api.post<{ accessToken: string; refreshToken: string; advogado: User }>('/auth/login', {
      oab,
    });
    localStorage.setItem('token', data.accessToken);
    localStorage.setItem('refreshToken', data.refreshToken);
    return data;
  },

  logout: () => {
    localStorage.removeItem('token');
    localStorage.removeItem('refreshToken');
  },

  getMe: async () => {
    const { data } = await api.get<User>('/auth/me');
    return data;
  },

  refreshToken: async () => {
    const refreshToken = localStorage.getItem('refreshToken');
    if (!refreshToken) throw new Error('No refresh token');
    const { data } = await api.post('/auth/refresh', { refreshToken });
    localStorage.setItem('token', data.token);
    return data;
  },
};

export const advogadoService = {
  getAll: async () => {
    const { data } = await api.get<{ advogados: Advogado[] }>('/advogados');
    return data.advogados;
  },

  getById: async (id: string) => {
    const { data } = await api.get<{ advogado: Advogado }>(`/advogados/${id}`);
    return data.advogado;
  },

  create: async (advogado: Omit<Advogado, 'id' | 'createdAt'>) => {
    const { data } = await api.post<{ advogado: Advogado }>('/advogados', advogado);
    return data.advogado;
  },

  update: async (id: string, advogado: Partial<Advogado>) => {
    const { data } = await api.put<{ advogado: Advogado }>(`/advogados/${id}`, advogado);
    return data.advogado;
  },

  delete: async (id: string) => {
    await api.delete(`/advogados/${id}`);
  },

  getProcessos: async (id: string) => {
    const { data } = await api.get<Processo[]>(`/advogados/${id}/processos`);
    return data;
  },
};

export const processoService = {
  getAll: async (params?: { page?: number; limit?: number; tribunalId?: string }) => {
    const { data } = await api.get<{ processos: Processo[]; total: number }>('/processos', { params });
    return data;
  },

  getById: async (id: string) => {
    const { data } = await api.get<Processo>(`/processos/${id}`);
    return data;
  },

  search: async (tribunalCodigo: string, numero: string) => {
    const { data } = await api.post<Processo>(`/tribunais/${tribunalCodigo}/buscar`, { numero });
    return data;
  },

  searchByOAB: async (tribunalCodigo: string, oab: string, uf: string) => {
    const { data } = await api.post<Processo[]>(`/tribunais/${tribunalCodigo}/buscar-oab`, { oab, uf });
    return data;
  },

  refresh: async (tribunalCodigo: string, numero: string) => {
    const { data } = await api.post<Job>(`/tribunais/${tribunalCodigo}/processos/${numero}/refresh`);
    return data;
  },

  getMovimentacoes: async (id: string) => {
    const { data } = await api.get<Movimentacao[]>(`/processos/${id}/movimentacoes`);
    return data;
  },

  getNovasMovimentacoes: async (id: string) => {
    const { data } = await api.get<Movimentacao[]>(`/processos/${id}/movimentacoes/novas`);
    return data;
  },

  getPartes: async (id: string) => {
    const { data } = await api.get(`/processos/${id}/partes`);
    return data;
  },
};

export const monitoramentoService = {
  getAll: async (params?: { advogadoId?: string; ativo?: boolean }) => {
    const { data } = await api.get<Monitoramento[]>('/monitoramentos', { params });
    return data;
  },

  create: async (processoId: string, advogadoId: string, frequencia: 'DIARIA' | 'SEMANAL' | 'MENSAL') => {
    const { data } = await api.post<Monitoramento>(`/processos/${processoId}/monitorar`, {
      advogadoId,
      frequencia,
    });
    return data;
  },

  delete: async (processoId: string) => {
    await api.delete(`/processos/${processoId}/monitorar`);
  },
};

export const tribunalService = {
  getAll: async () => {
    const { data } = await api.get<Tribunal[]>('/tribunais');
    return data;
  },

  getStatus: async (codigo: string) => {
    const { data } = await api.get<{ online: boolean; responseTime: number }>(`/tribunais/${codigo}/status`);
    return data;
  },
};

export const jobService = {
  getAll: async (params?: { status?: Job['status']; tipo?: Job['tipo'] }) => {
    const { data } = await api.get<Job[]>('/jobs', { params });
    return data;
  },

  getById: async (id: string) => {
    const { data } = await api.get<Job>(`/jobs/${id}`);
    return data;
  },

  retry: async (id: string) => {
    const { data } = await api.post<Job>(`/jobs/${id}/retry`);
    return data;
  },
};

export const notificationService = {
  getAll: async () => {
    const { data } = await api.get<Notification[]>('/notifications');
    return data;
  },

  markAsRead: async (id: string) => {
    await api.put(`/notifications/${id}/read`);
  },

  markAllAsRead: async () => {
    await api.put('/notifications/read-all');
  },
};

export const dashboardService = {
  getStats: async (): Promise<DashboardStats> => {
    const [processos, advogados, jobs, tribunais] = await Promise.all([
      processoService.getAll(),
      advogadoService.getAll(),
      jobService.getAll({ status: 'PENDING' }),
      tribunalService.getAll(),
    ]);

    const processosAtivos = processos.processos.filter((p) => p.status === 'ATIVO').length;
    const jobsFalhas = jobs.filter((j) => j.status === 'FAILED').length;

    return {
      totalProcessos: processos.processos.length,
      processosAtivos,
      totalAdvogados: advogados.length,
      jobsPendentes: jobs.length,
      jobsFalhas,
      totalMovimentacoesHoje: 0,
    };
  },
};
