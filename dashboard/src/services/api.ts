import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';

/** Busca por OAB / refresh em tribunal pode ultrapassar 30s (DataJud + persistência). */
const LONG_OPERATION_TIMEOUT_MS = 300_000;

const api = axios.create({
  baseURL: `${import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'}/api/v1`,
  timeout: 30000,
});

type RetryConfig = InternalAxiosRequestConfig & { _retry?: boolean };

let isRefreshing = false;
let refreshQueue: Array<(token: string | null) => void> = [];

const processQueue = (token: string | null) => {
  refreshQueue.forEach((cb) => cb(token));
  refreshQueue = [];
};

const redirectToLogin = () => {
  localStorage.removeItem('token');
  localStorage.removeItem('refreshToken');
  if (!window.location.pathname.startsWith('/login') && !window.location.pathname.startsWith('/register')) {
    window.location.href = '/login';
  }
};

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as RetryConfig | undefined;
    const isAuthRoute = originalRequest?.url?.startsWith('/auth/');

    if (
      error.response?.status !== 401 ||
      !originalRequest ||
      originalRequest._retry ||
      isAuthRoute
    ) {
      return Promise.reject(error);
    }

    const refreshToken = localStorage.getItem('refreshToken');
    if (!refreshToken) {
      redirectToLogin();
      return Promise.reject(error);
    }

    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        refreshQueue.push((token) => {
          if (!token) {
            reject(error);
            return;
          }
          originalRequest.headers.Authorization = `Bearer ${token}`;
          resolve(api(originalRequest));
        });
      });
    }

    originalRequest._retry = true;
    isRefreshing = true;

    try {
      const { data } = await axios.post<{ accessToken: string; refreshToken: string }>(
        `${api.defaults.baseURL}/auth/refresh`,
        { refreshToken }
      );
      localStorage.setItem('token', data.accessToken);
      localStorage.setItem('refreshToken', data.refreshToken);
      processQueue(data.accessToken);
      originalRequest.headers.Authorization = `Bearer ${data.accessToken}`;
      return api(originalRequest);
    } catch (refreshError) {
      processQueue(null);
      redirectToLogin();
      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
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

  isAuthenticated: () => Boolean(localStorage.getItem('token')),
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

  getProcessos: async (id: string, limite = 200) => {
    const { data } = await api.get<{ processos: any[] }>(`/advogados/${id}/processos`, {
      params: { limite },
    });
    return data.processos;
  },
};

export const processoService = {
  getAll: async (params?: { page?: number; limit?: number; tribunalId?: string; advogadoId?: string; status?: string }) => {
    const { data } = await api.get<{ processos: any[]; pagination: any }>('/processos', { params });
    return data;
  },

  getById: async (id: string) => {
    const { data } = await api.get<any>(`/processos/${id}`);
    return data;
  },

  create: async (processo: {
    numeroProcesso: string;
    tribunalId: string;
    advogadoId: string;
    classe?: string;
    assunto?: string;
  }) => {
    const { data } = await api.post<{ processo: any }>('/processos', processo);
    return data.processo;
  },

  delete: async (id: string) => {
    const { data } = await api.delete<{ mensagem: string }>(`/processos/${id}`);
    return data;
  },

  search: async (tribunalCodigo: string, numero: string) => {
    const { data } = await api.post<any>(
      `/tribunais/${tribunalCodigo}/buscar`,
      { numeroProcesso: numero },
      { timeout: LONG_OPERATION_TIMEOUT_MS }
    );
    return data;
  },

  searchByOAB: async (
    tribunalCodigo: string,
    params: {
      oab: string;
      nome?: string;
      advogadoId?: string;
      forceRefresh?: boolean;
      limiteProcessos?: number;
      onlyMissing?: boolean;
    }
  ) => {
    const { data } = await api.post<{ processos: any[]; totalEncontrados: number }>(
      `/tribunais/${tribunalCodigo}/buscar-oab`,
      params,
      { timeout: LONG_OPERATION_TIMEOUT_MS }
    );
    return data;
  },

  searchByOABAsync: async (
    tribunalCodigo: string,
    params: {
      oab: string;
      nome?: string;
      advogadoId: string;
    }
  ) => {
    const { data } = await api.post<{
      sucesso: boolean;
      status: 'queued';
      jobId: string;
      queueJobId: string;
      mensagem: string;
    }>(
      `/tribunais/${tribunalCodigo}/buscar-oab/async`,
      params,
      { timeout: 30000 }
    );
    return data;
  },

  refresh: async (tribunalCodigo: string, numero: string) => {
    const { data } = await api.post<any>(
      `/tribunais/${tribunalCodigo}/processos/${encodeURIComponent(numero)}/refresh`,
      {},
      { timeout: LONG_OPERATION_TIMEOUT_MS }
    );
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
    const intervaloMinutos: Record<string, number> = { DIARIA: 1440, SEMANAL: 10080, MENSAL: 43200 };
    const { data } = await api.post<any>(`/processos/${processoId}/monitorar`, {
      intervaloMinutos: intervaloMinutos[frequencia] ?? 60,
    });
    return data;
  },

  delete: async (processoId: string) => {
    await api.delete(`/processos/${processoId}/monitorar`);
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

  getMovimentacoes: async (dias = 7) => {
    const { data } = await api.get<{ movimentacoes: { data: string; count: number }[] }>(
      '/dashboard/movimentacoes',
      { params: { dias } }
    );
    return data.movimentacoes;
  },
};

export const tribunalService = {
  getAll: async () => {
    const { data } = await api.get<{ tribunais: any[] }>('/tribunais');
    return data.tribunais;
  },

  getStatus: async (codigo: string) => {
    const { data } = await api.get<any>(`/tribunais/${codigo}/status`);
    return data;
  },

  getBatchStatus: async (codigos: string[]) => {
    const { data } = await api.get<{ tribunais: any[] }>('/tribunais/batch-status', {
      params: { codigos: codigos.join(',') },
    });
    return data.tribunais;
  },
};
