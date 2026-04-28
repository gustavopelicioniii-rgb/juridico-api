import { useState, useEffect } from 'react';
import {
  FileText,
  Activity,
  AlertTriangle,
  RefreshCw,
  ArrowUpRight,
  ArrowDownRight,
  Scale,
  Loader2,
} from 'lucide-react';
import { ResponsiveContainer, AreaChart, CartesianGrid, XAxis, YAxis, Tooltip, Area } from 'recharts';
import { dashboardService, processoService, jobService } from '../services/api';
import type { Processo, Job } from '../types/api';

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
        <span className={`px-2 py-1 rounded-lg text-xs font-medium border ${statusColors[processo.status] || 'bg-slate-500/20 text-slate-400 border-slate-500/30'}`}>
          {processo.status}
        </span>
        <span className="text-xs text-slate-500">{processo.tribunalNome || processo.tribunalCodigo}</span>
      </div>
      <h4 className="font-mono text-sm text-slate-200 mb-2">{processo.numeroProcesso || processo.numero}</h4>
      <p className="text-sm text-slate-400 mb-3">{processo.classe}</p>
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>{processo.area || processo.assunto}</span>
        <span>Atualizado: {processo.ultimaAtualizacao ? new Date(processo.ultimaAtualizacao).toLocaleDateString('pt-BR') : '—'}</span>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [stats, setStats] = useState<{
    totalProcessos: number;
    jobsPendentes: number;
    jobsFalhos: number;
    monitoramentosAtivos: number;
  } | null>(null);
  const [processos, setProcessos] = useState<Processo[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      dashboardService.getStats().catch(() => null),
      processoService.getAll({ limit: 6 }).catch(() => ({ processos: [] })),
      jobService.getAll({ limite: 4 }).catch(() => []),
    ]).then(([statsData, procData, jobsData]) => {
      if (statsData) setStats(statsData);
      if (procData?.processos) setProcessos(procData.processos);
      if (Array.isArray(jobsData)) setJobs(jobsData);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-8 h-8 animate-spin text-brand-500" />
      </div>
    );
  }

  const jobStatusColors: Record<string, string> = {
    CONCLUIDO: 'bg-emerald-500',
    COMPLETED: 'bg-emerald-500',
    PROCESSANDO: 'bg-brand-500 animate-pulse',
    PROCESSING: 'bg-brand-500 animate-pulse',
    PENDENTE: 'bg-amber-500',
    PENDING: 'bg-amber-500',
    FALHO: 'bg-red-500',
    FAILED: 'bg-red-500',
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          title="Processos Monitorados"
          value={stats?.totalProcessos ?? 0}
          change={12}
          icon={FileText}
          trend="up"
        />
        <StatCard
          title="Monitoramentos Ativos"
          value={stats?.monitoramentosAtivos ?? 0}
          change={0}
          icon={Activity}
          trend="up"
        />
        <StatCard
          title="Jobs Pendentes"
          value={stats?.jobsPendentes ?? 0}
          change={-25}
          icon={RefreshCw}
          trend="down"
        />
        <StatCard
          title="Falhas Recentes"
          value={stats?.jobsFalhos ?? 0}
          change={-50}
          icon={AlertTriangle}
          trend="up"
        />
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
            {jobs.slice(0, 4).map((job) => (
              <div key={job.id} className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${jobStatusColors[job.status] || 'bg-slate-500'}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-300 truncate">{job.tipo} — {job.status}</p>
                  <p className="text-xs text-slate-500">{new Date(job.createdAt).toLocaleTimeString('pt-BR')}</p>
                </div>
              </div>
            ))}
            {jobs.length === 0 && (
              <p className="text-sm text-slate-500 text-center py-4">Nenhum job encontrado</p>
            )}
          </div>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display font-semibold text-lg text-white">Processos Recentes</h3>
          <a href="/processos" className="text-sm text-brand-400 hover:text-brand-300 transition-colors">Ver todos →</a>
        </div>
        {processos.length === 0 ? (
          <div className="glass rounded-2xl p-8 text-center">
            <p className="text-slate-400">Nenhum processo encontrado</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {processos.map((processo) => (
              <ProcessCard key={processo.id} processo={processo} />
            ))}
          </div>
        )}
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
