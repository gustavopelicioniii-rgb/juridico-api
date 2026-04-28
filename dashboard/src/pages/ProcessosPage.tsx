import { useState } from 'react';
import { Search, Plus, RefreshCw, Eye, Trash2 } from 'lucide-react';
import type { Processo } from '../types/api';

const mockProcessos: Processo[] = [
  { id: '1', numero: '5001234-56.2024.8.13.0021', tribunalId: '1', tribunalNome: 'TJMG', tribunalCodigo: 'TJMG', tipo: 'Cível', area: 'Direito do Consumidor', classe: 'Procedimento Comum Cível', assunto: 'Contrato Bancário', distribuicao: '2024-01-15', status: 'MONITORANDO', ultimaAtualizacao: '2024-03-10', createdAt: '2024-01-15' },
  { id: '2', numero: '1001234-56.2024.8.13.0608', tribunalId: '2', tribunalNome: 'TJSP', tribunalCodigo: 'TJSP', tipo: 'Criminal', area: 'Direito Penal', classe: 'Ação Penal - Procedimento Ordinário', assunto: 'Crime contra o patrimônio', distribuicao: '2024-02-20', status: 'ATIVO', ultimaAtualizacao: '2024-03-12', createdAt: '2024-02-20' },
  { id: '3', numero: '0001234-56.2024.8.26.0102', tribunalId: '3', tribunalNome: 'TRT-2', tribunalCodigo: 'TRT2', tipo: 'Trabalhista', area: 'Direito do Trabalho', classe: 'Recurso Ordinário', assunto: 'Horas extras e adicional noturno', distribuicao: '2024-03-01', status: 'ATIVO', ultimaAtualizacao: '2024-03-11', createdAt: '2024-03-01' },
  { id: '4', numero: '0012345-78.2024.8.05.0001', tribunalId: '4', tribunalNome: 'TRF-3', tribunalCodigo: 'TRF3', tipo: 'Federal', area: 'Direito Tributário', classe: 'Execução Fiscal', assunto: 'ISSQN', distribuicao: '2024-01-10', status: 'MONITORANDO', ultimaAtualizacao: '2024-03-09', createdAt: '2024-01-10' },
  { id: '5', numero: '5009876-12.2023.8.13.0045', tribunalId: '1', tribunalNome: 'TJMG', tribunalCodigo: 'TJMG', tipo: 'Cível', area: 'Direito de Família', classe: 'Alimentos', assunto: 'Fixação de pensão alimentícia', distribuicao: '2023-11-20', status: 'ATIVO', ultimaAtualizacao: '2024-03-08', createdAt: '2023-11-20' },
];

export default function ProcessosPage() {
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterTribunal, setFilterTribunal] = useState<string>('all');

  const filteredProcessos = mockProcessos.filter((p) => {
    const matchesSearch = p.numero.includes(search) || p.classe.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = filterStatus === 'all' || p.status === filterStatus;
    const matchesTribunal = filterTribunal === 'all' || p.tribunalCodigo === filterTribunal;
    return matchesSearch && matchesStatus && matchesTribunal;
  });

  const statusColors: Record<string, string> = {
    MONITORANDO: 'bg-brand-500/20 text-brand-400 border-brand-500/30',
    ATIVO: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    ARQUIVADO: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
    SUSPENSO: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display font-bold text-2xl text-white">Processos</h1>
          <p className="text-slate-400 text-sm mt-1">{filteredProcessos.length} processos encontrados</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-brand-500 to-brand-600 hover:from-brand-400 hover:to-brand-500 text-white font-medium rounded-xl shadow-lg shadow-brand-500/30 transition-all">
          <Plus className="w-4 h-4" />
          Novo Processo
        </button>
      </div>

      <div className="glass rounded-2xl p-4">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
            <input
              type="text"
              placeholder="Buscar por número ou classe..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-dark-200 border border-brand-900/30 rounded-xl text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-brand-500/50 focus:ring-2 focus:ring-brand-500/20 transition-all"
            />
          </div>
          <div className="flex gap-3">
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="px-4 py-2.5 bg-dark-200 border border-brand-900/30 rounded-xl text-slate-300 focus:outline-none focus:border-brand-500/50 cursor-pointer"
            >
              <option value="all">Todos os Status</option>
              <option value="MONITORANDO">Monitorando</option>
              <option value="ATIVO">Ativo</option>
              <option value="ARQUIVADO">Arquivado</option>
              <option value="SUSPENSO">Suspenso</option>
            </select>
            <select
              value={filterTribunal}
              onChange={(e) => setFilterTribunal(e.target.value)}
              className="px-4 py-2.5 bg-dark-200 border border-brand-900/30 rounded-xl text-slate-300 focus:outline-none focus:border-brand-500/50 cursor-pointer"
            >
              <option value="all">Todos os Tribunais</option>
              <option value="TJSP">TJ-SP</option>
              <option value="TJMG">TJ-MG</option>
              <option value="TRT2">TRT-2</option>
              <option value="TRF3">TRF-3</option>
            </select>
          </div>
        </div>
      </div>

      <div className="glass rounded-2xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-brand-900/30">
              <th className="text-left px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Processo</th>
              <th className="text-left px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Tribunal</th>
              <th className="text-left px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Classe</th>
              <th className="text-left px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
              <th className="text-left px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Última Atualização</th>
              <th className="text-right px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-900/20">
            {filteredProcessos.map((processo) => (
              <tr key={processo.id} className="hover:bg-dark-100/30 transition-colors">
                <td className="px-6 py-4">
                  <p className="font-mono text-sm text-slate-200">{processo.numero}</p>
                  <p className="text-xs text-slate-500 mt-1">{processo.area}</p>
                </td>
                <td className="px-6 py-4">
                  <span className="px-2 py-1 rounded-lg text-xs font-medium bg-dark-100 text-slate-300">
                    {processo.tribunalNome}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <p className="text-sm text-slate-300 max-w-xs truncate">{processo.classe}</p>
                </td>
                <td className="px-6 py-4">
                  <span className={`px-2 py-1 rounded-lg text-xs font-medium border ${statusColors[processo.status]}`}>
                    {processo.status}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <p className="text-sm text-slate-400">
                    {new Date(processo.ultimaAtualizacao).toLocaleDateString('pt-BR')}
                  </p>
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center justify-end gap-2">
                    <button className="p-2 rounded-lg text-slate-400 hover:text-brand-400 hover:bg-brand-500/10 transition-colors" title="Visualizar">
                      <Eye className="w-4 h-4" />
                    </button>
                    <button className="p-2 rounded-lg text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors" title="Atualizar">
                      <RefreshCw className="w-4 h-4" />
                    </button>
                    <button className="p-2 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors" title="Remover">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
