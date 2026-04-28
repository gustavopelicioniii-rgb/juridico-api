import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';

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
      localStorage.removeItem('refreshToken');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export const authService = {
  login: async (oab: string, senha: string) => {
    const { data } = await api.post<{
      accessToken: string;
      refreshToken: string;
      advogado: { id: string; oab: string; nome: string; email?: string };
    }>('/auth/login', { oab, senha });
    localStorage.setItem('token', data.accessToken);
    localStorage.setItem('refreshToken', data.refreshToken);
    return data;
  },

  register: async (oab: string, nome: string, email: string, senha: string) => {
    const { data } = await api.post<{
      accessToken: string;
      refreshToken: string;
      advogado: { id: string; oab: string; nome: string; email?: string };
    }>('/auth/register', { oab, nome, email, senha });
    localStorage.setItem('token', data.accessToken);
    localStorage.setItem('refreshToken', data.refreshToken);
    return data;
  },

  logout: () => {
    localStorage.removeItem('token');
    localStorage.removeItem('refreshToken');
    api.post('/auth/logout').catch(() => {});
  },

  refreshToken: async () => {
    const refreshToken = localStorage.getItem('refreshToken');
    if (!refreshToken) throw new Error('No refresh token');
    const { data } = await api.post<{ accessToken: string; refreshToken: string }>('/auth/refresh', { refreshToken });
    localStorage.setItem('token', data.accessToken);
    localStorage.setItem('refreshToken', data.refreshToken);
    return data;
  },

  getMe: async () => {
    const { data } = await api.get<{ id: string; oab: string; nome: string; email?: string; role: string }>('/auth/me');
    return data;
  },
};

export const advogadoService = {
  getAll: async () => {
    const { data } = await api.get<{ advogados: any[] }>('/advogados');
    return data.advogados;
  },

  getById: async (id: string) => {
    const { data } = await api.get<{ advogado: any }>(`/advogados/${id}`);
    return data.advogado;
  },

  create: async (advogado: any) => {
    const { data } = await api.post<{ advogado: any }>('/advogados', advogado);
    return data.advogado;
  },

  update: async (id: string, advogado: Partial<any>) => {
    const { data } = await api.put<{ advogado: any }>(`/advogados/${id}`, advogado);
    return data.advogado;
  },

  delete: async (id: string) => {
    await api.delete(`/advogados/${id}`);
  },

  getProcessos: async (id: string) => {
    const { data } = await api.get<any[]>(`/advogados/${id}/processos`);
    return data;
  },
};

export const processoService = {
  getAll: async (params?: { page?: number; limit?: number; tribunalId?: string }) => {
    const { data } = await api.get<{ processos: any[]; total: number }>('/processos', { params });
    return data;
  },

  getById: async (id: string) => {
    const { data } = await api.get<any>(`/processos/${id}`);
    return data;
  },

  search: async (tribunalCodigo: string, numero: string) => {
    const { data } = await api.post<any>(`/tribunais/${tribunalCodigo}/buscar`, { numero });
    return data;
  },

  searchByOAB: async (tribunalCodigo: string, oab: string, uf: string) => {
    const { data } = await api.post<{ processos: any[] }>(`/tribunais/${tribunalCodigo}/buscar-oab`, { oab, uf });
    return data.processos;
  },

  refresh: async (tribunalCodigo: string, numero: string) => {
    const { data } = await api.post<any>(`/tribunais/${tribunalCodigo}/processos/${numero}/refresh`);
    return data;
  },

  getMovimentacoes: async (id: string) => {
    const { data } = await api.get<any[]>(`/processos/${id}/movimentacoes`);
    return data;
  },

  getNovasMovimentacoes: async (id: string) => {
    const { data } = await api.get<any[]>(`/processos/${id}/movimentacoes/novas`);
    return data;
  },

  getPartes: async (id: string) => {
    const { data } = await api.get<any>(`/processos/${id}/partes`);
    return data;
  },
};

export const monitoramentoService = {
  getAll: async (params?: { advogadoId?: string; ativo?: boolean }) => {
    const { data } = await api.get<any[]>('/monitoramentos', { params });
    return data;
  },

  create: async (processoId: string, advogadoId: string, frequencia: 'DIARIA' | 'SEMANAL' | 'MENSAL') => {
    const { data } = await api.post<any>(`/processos/${processoId}/monitorar`, { advogadoId, frequencia });
    return data;
  },

  delete: async (processoId: string) => {
    await api.delete(`/processos/${processoId}/monitorar`);
  },
};

export const tribunalService = {
  getAll: async () => {
    const { data } = await api.get<any[]>('/tribunais');
    return data;
  },

  getStatus: async (codigo: string) => {
    const { data } = await api.get<any>(`/tribunais/${codigo}/status`);
    return data;
  },
};

export const jobService = {
  getAll: async (params?: { status?: string; tipo?: string; limite?: number }) => {
    const { data } = await api.get<{ jobs: any[] }>('/jobs', { params });
    return data.jobs;
  },

  getById: async (id: string) => {
    const { data } = await api.get<{ job: any }>(`/jobs/${id}`);
    return data.job;
  },

  retry: async (id: string) => {
    const { data } = await api.post<{ job: any }>(`/jobs/${id}/retry`);
    return data.job;
  },
};

export const notificationService = {
  getAll: async (params?: { lida?: boolean; limite?: number }) => {
    const { data } = await api.get<{ notifications: any[] }>('/notifications', { params });
    return data.notifications;
  },

  markAsRead: async (id: string) => {
    await api.put(`/notifications/${id}/read`);
  },

  markAllAsRead: async () => {
    await api.put('/notifications/read-all');
  },
};

export const dashboardService = {
  getStats: async () => {
    const { data } = await api.get<{
      totalAdvogados: number;
      totalProcessos: number;
      jobsPendentes: number;
      jobsFalhos: number;
      monitoramentosAtivos: number;
      totalMovimentacoesHoje: number;
    }>('/dashboard/stats');
    return data;
  },
};
