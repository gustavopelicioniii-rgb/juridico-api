import { useQuery } from '@tanstack/react-query';
import {
  FileText,
  Users,
  Activity,
  AlertTriangle,
  Clock,
  TrendingUp,
  RefreshCw,
  ArrowUpRight,
  ArrowDownRight,
  Scale,
} from 'lucide-react';
import { dashboardService, processoService, jobService } from '../services/api';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';
import type { Processo, Job } from '../types/api';

const mockProcessos: Processo[] = [
  { id: '1', numero: '5001234-56.2024.8.13.0021', tribunalId: '1', tribunalNome: 'TJMG', tipo: 'Cível', area: 'Direito do Consumidor', classe: 'Procedimento Comum Cível', assunto: 'Contrato Bancário', distribuicao: '2024-01-15', status: 'MONITORANDO', ultimaAtualizacao: '2024-03-10', createdAt: '2024-01-15' },
  { id: '2', numero: '1001234-56.2024.8.13.0608', tribunalId: '2', tribunalNome: 'TJSP', tipo: 'Criminal', area: 'Direito Penal', classe: 'Ação Penal - Procedimento Ordinário', assunto: 'Crime contra o patrimônio', distribuicao: '2024-02-20', status: 'ATIVO', ultimaAtualizacao: '2024-03-12', createdAt: '2024-02-20' },
  { id: '3', numero: '0001234-56.2024.8.26.0102', tribunalId: '3', tribunalNome: 'TRT-2', tipo: 'Trabalhista', area: 'Direito do Trabalho', classe: 'Recurso Ordinário', assunto: 'Hor extras e adicional noturno', distribuicao: '2024-03-01', status: 'ATIVO', ultimaAtualizacao: '2024-03-11', createdAt: '2024-03-01' },
];

const mockJobs: Job[] = [
  { id: '1', tipo: 'SCRAPE', status: 'COMPLETED', tentativas: 1, createdAt: '2024-03-12T10:00:00', completedAt: '2024-03-12T10:00:15' },
  { id: '2', tipo: 'SCRAPE', status: 'PROCESSING', tentativas: 1, createdAt: '2024-03-12T10:01:00' },
  { id: '3', tipo: 'REFRESH', status: 'PENDING', tentativas: 0, createdAt: '2024-03-12T10:02:00' },
  { id: '4', tipo: 'SCRAPE', status: 'FAILED', tentativas: 3, erro: 'CAPTCHA timeout', createdAt: '2024-03-12T09:00:00' },
];

const mockMovimentacoes = [
  { data: '2024-03-10', count: 12 },
  { data: '2024-03-11', count: 8 },
  { data: '2024-03-12', count: 15 },
  { data: '2024-03-13', count: 6 },
  { data: '2024-03-14', count: 18 },
  { data: '2024-03-15', count: 9 },
  { data: '2024-03-16', count: 14 },
];

function StatCard({ title, value, change, icon: Icon, trend }: { title: string; value: number; change: number; icon: React.ElementType; trend: 'up' | 'down' }) {
  return (
    <div className="glass rounded-2xl p-6 card-hover">
      <div className="flex items-start justify-between mb-4">
        <div className={`p-3 rounded-xl ${trend === 'up' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
          <Icon className="w-6 h-6" />
        </div>
        <div className={`flex items-center gap-1 text-sm font-medium ${trend === 'up' ? 'text-emerald-400' : 'text-red-400'}`}>
          {trend === 'up' ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
          {change}%
        </div>
      </div>
      <p className="text-slate-400 text-sm mb-1">{title}</p>
      <p className="text-3xl font-display font-bold text-white">{value}</p>
    </div>
  );
}

function ProcessCard({ processo }: { processo: Processo }) {
  const statusColors: Record<string, string> = {
    MONITORANDO: 'bg-brand-500/20 text-brand-400 border-brand-500/30',
    ATIVO: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    ARQUIVADO: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
    SUSPENSO: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  };

  return (
    <div className="glass-light rounded-xl p-5 card-hover">
      <div className="flex items-start justify-between mb-3">
        <span className={`px-2 py-1 rounded-lg text-xs font-medium border ${statusColors[processo.status]}`}>
          {processo.status}
        </span>
        <span className="text-xs text-slate-500">{processo.tribunalNome}</span>
      </div>
      <h4 className="font-mono text-sm text-slate-200 mb-2">{processo.numero}</h4>
      <p className="text-sm text-slate-400 mb-3">{processo.classe}</p>
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>{processo.area}</span>
        <span>Atualizado: {new Date(processo.ultimaAtualizacao).toLocaleDateString('pt-BR')}</span>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard title="Processos Monitorados" value={156} change={12} icon={FileText} trend="up" />
        <StatCard title="Advogados Ativos" value={8} change={0} icon={Users} trend="up" />
        <StatCard title="Jobs em Andamento" value={3} change={-25} icon={Activity} trend="down" />
        <StatCard title="Falhas Recentes" value={2} change={-50} icon={AlertTriangle} trend="up" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 glass rounded-2xl p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-display font-semibold text-lg text-white">Movimentações por Dia</h3>
            <select className="px-3 py-2 bg-dark-200 border border-brand-900/30 rounded-lg text-sm text-slate-400 focus:outline-none focus:border-brand-500/50">
              <option>Últimos 7 dias</option>
              <option>Últimos 30 dias</option>
            </select>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={mockMovimentacoes}>
                <defs>
                  <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#5478ff" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#5478ff" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="data" stroke="#64748b" fontSize={12} tickFormatter={(value) => new Date(value).toLocaleDateString('pt-BR', { day: '2-digit' })} />
                <YAxis stroke="#64748b" fontSize={12} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #223487', borderRadius: '8px' }}
                  labelStyle={{ color: '#94a3b8' }}
                  labelFormatter={(value) => new Date(value).toLocaleDateString('pt-BR')}
                />
                <Area type="monotone" dataKey="count" stroke="#5478ff" strokeWidth={2} fillOpacity={1} fill="url(#colorCount)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="glass rounded-2xl p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-display font-semibold text-lg text-white">Jobs Recentes</h3>
            <RefreshCw className="w-5 h-5 text-slate-500" />
          </div>
          <div className="space-y-4">
            {mockJobs.slice(0, 4).map((job) => {
              const statusColors: Record<string, string> = {
                COMPLETED: 'bg-emerald-500',
                PROCESSING: 'bg-brand-500 animate-pulse',
                PENDING: 'bg-amber-500',
                FAILED: 'bg-red-500',
              };
              return (
                <div key={job.id} className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${statusColors[job.status]}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-300 truncate">{job.tipo} - {job.status}</p>
                    <p className="text-xs text-slate-500">{new Date(job.createdAt).toLocaleTimeString('pt-BR')}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display font-semibold text-lg text-white">Processos Recentes</h3>
          <a href="/processos" className="text-sm text-brand-400 hover:text-brand-300 transition-colors">Ver todos →</a>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {mockProcessos.map((processo) => (
            <ProcessCard key={processo.id} processo={processo} />
          ))}
        </div>
      </div>

      <div className="glass rounded-2xl p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 rounded-xl bg-brand-500/20">
            <Scale className="w-5 h-5 text-brand-400" />
          </div>
          <div>
            <h3 className="font-display font-semibold text-white">Status dos Tribunais</h3>
            <p className="text-xs text-slate-500">Monitoramento em tempo real</p>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { nome: 'TJ-SP', status: 'online', tempo: '124ms' },
            { nome: 'TJ-MG', status: 'online', tempo: '289ms' },
            { nome: 'STJ', status: 'online', tempo: '201ms' },
            { nome: 'TRT-2', status: 'degraded', tempo: '1.2s' },
          ].map((tribunal) => (
            <div key={tribunal.nome} className="glass-light rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className={`w-2 h-2 rounded-full ${tribunal.status === 'online' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                <span className="text-sm font-medium text-slate-300">{tribunal.nome}</span>
              </div>
              <p className="text-xs text-slate-500">{tribunal.tempo}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
