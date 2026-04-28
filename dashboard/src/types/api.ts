export interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'lawyer' | 'assistant';
  avatar?: string;
}

export interface Advogado {
  id: string;
  nome: string;
  oab: string;
  uf: string;
  telefone?: string;
  email?: string;
  ativo: boolean;
  createdAt: string;
}

export interface Processo {
  id: string;
  numero: string;
  tribunalId: string;
  tribunalNome?: string;
  tribunalCodigo?: string;
  tipo: string;
  area: string;
  classe: string;
  assunto: string;
  distribuicao: string;
  relator?: string;
  valorCausa?: number;
  status: 'MONITORANDO' | 'ARQUIVADO' | 'SUSPENSO' | 'ATIVO';
  ultimaAtualizacao: string;
  createdAt: string;
}

export interface Movimentacao {
  id: string;
  processoId: string;
  data: string;
  titulo: string;
  descricao: string;
  documento?: string;
}

export interface Parte {
  id: string;
  processoId: string;
  tipo: 'AUTOR' | 'RÉU' | 'ADVOGADO' | 'OUTRO';
  nome: string;
  documento?: string;
  papel: string;
}

export interface Monitoramento {
  id: string;
  advogadoId: string;
  processoId: string;
  frequencia: 'DIARIA' | 'SEMANAL' | 'MENSAL';
  ativo: boolean;
  ultimaVerificacao?: string;
  processo?: Processo;
  advogado?: Advogado;
}

export interface Job {
  id: string;
  tipo: 'SCRAPE' | 'NOTIFICATION' | 'REFRESH';
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  processoId?: string;
  tribunalCodigo?: string;
  tentativas: number;
  erro?: string;
  createdAt: string;
  completedAt?: string;
}

export interface Tribunal {
  id: string;
  codigo: string;
  nome: string;
  tipo: 'TJ' | 'STJ' | 'STF' | 'TRT' | 'TRF';
  regiao?: string;
  ativo: boolean;
}

export interface Notification {
  id: string;
  tipo: 'NOVO_JOB' | 'JOB_COMPLETED' | 'JOB_FAILED' | 'NOVA_MOVIMENTACAO';
  titulo: string;
  mensagem: string;
  processoId?: string;
  jobId?: string;
  lida: boolean;
  createdAt: string;
}

export interface DashboardStats {
  totalProcessos: number;
  processosAtivos: number;
  totalAdvogados: number;
  jobsPendentes: number;
  jobsFalhas: number;
  totalMovimentacoesHoje: number;
}
