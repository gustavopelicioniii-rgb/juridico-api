import { useState, useEffect } from 'react';
import { Search, Plus, RefreshCw, Eye, Trash2, X, Loader2, FileText } from 'lucide-react';
import { processoService, tribunalService, advogadoService } from '../services/api';
import type { Processo } from '../types/api';

export default function ProcessosPage() {
  const [processos, setProcessos] = useState<Processo[]>([]);
  const [tribunais, setTribunais] = useState<any[]>([]);
  const [advogados, setAdvogados] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterTribunal, setFilterTribunal] = useState<string>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    numeroProcesso: '',
    tribunalId: '',
    advogadoId: '',
    classe: '',
    assunto: '',
  });

  // Detail modal state
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedProcesso, setSelectedProcesso] = useState<Processo | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const [procData, tribData, advData] = await Promise.all([
        processoService.getAll(),
        tribunalService.getAll(),
        advogadoService.getAll(),
      ]);
      setProcessos(procData.processos || []);
      setTribunais(tribData || []);
      setAdvogados(advData || []);
    } catch (err) {
      setError('Erro ao carregar processos');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const filteredProcessos = processos.filter((p) => {
    const matchesSearch =
      (p.numeroProcesso || '').includes(search) ||
      (p.classe || '').toLowerCase().includes(search.toLowerCase());
    const matchesStatus = filterStatus === 'all' || p.status === filterStatus;
    const matchesTribunal = filterTribunal === 'all' || p.tribunalCodigo === filterTribunal;
    return matchesSearch && matchesStatus && matchesTribunal;
  });

  const statusColors: Record<string, string> = {
    MONITORANDO: 'bg-brand-500/20 text-brand-400 border-brand-500/30',
    ATIVO: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    ARQUIVADO: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
    SUSPENSO: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    ERRO: 'bg-red-500/20 text-red-400 border-red-500/30',
    ENCERRADO: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
  };

  const handleOpenCreateModal = () => {
    setFormData({ numeroProcesso: '', tribunalId: '', advogadoId: '', classe: '', assunto: '' });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!formData.numeroProcesso || !formData.tribunalId || !formData.advogadoId) {
      alert('Número do processo, tribunal e advogado são obrigatórios.');
      return;
    }
    try {
      setIsSaving(true);
      await processoService.create({
        numeroProcesso: formData.numeroProcesso,
        tribunalId: formData.tribunalId,
        advogadoId: formData.advogadoId,
        classe: formData.classe || undefined,
        assunto: formData.assunto || undefined,
      });
      setShowModal(false);
      fetchData();
    } catch (err) {
      alert('Erro ao criar processo');
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Tem certeza que deseja remover este processo?')) return;
    try {
      await (processoService as any).delete(id);
      fetchData();
    } catch (err) {
      alert('Erro ao remover processo');
      console.error(err);
    }
  };

  const handleRefresh = async (processo: Processo) => {
    const tribunalCodigo = processo.tribunalCodigo || window.prompt('Código do tribunal para refresh:');
    if (!tribunalCodigo) return;
    try {
      await processoService.refresh(tribunalCodigo, processo.numeroProcesso || processo.numero || '');
      fetchData();
    } catch (err) {
      alert('Erro ao atualizar processo');
      console.error(err);
    }
  };

  const handleViewDetails = async (processo: Processo) => {
    setSelectedProcesso(processo);
    setShowDetailModal(true);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display font-bold text-2xl text-white">Processos</h1>
          <p className="text-slate-400 text-sm mt-1">{filteredProcessos.length} processos encontrados</p>
        </div>
        <button
          onClick={handleOpenCreateModal}
          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-brand-500 to-brand-600 hover:from-brand-400 hover:to-brand-500 text-white font-medium rounded-xl shadow-lg shadow-brand-500/30 transition-all"
        >
          <Plus className="w-4 h-4" />
          Novo Processo
        </button>
      </div>

      {error && (
        <div className="glass rounded-2xl p-4 bg-red-500/10 border border-red-500/30">
          <p className="text-red-400">{error}</p>
        </div>
      )}

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
              <option value="ERRO">Erro</option>
              <option value="ENCERRADO">Encerrado</option>
            </select>
            <select
              value={filterTribunal}
              onChange={(e) => setFilterTribunal(e.target.value)}
              className="px-4 py-2.5 bg-dark-200 border border-brand-900/30 rounded-xl text-slate-300 focus:outline-none focus:border-brand-500/50 cursor-pointer"
            >
              <option value="all">Todos os Tribunais</option>
              {tribunais.map((t) => (
                <option key={t.id || t.codigo} value={t.codigo}>{t.nome || t.codigo}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-brand-500" />
        </div>
      ) : filteredProcessos.length === 0 ? (
        <div className="text-center py-12">
          <FileText className="w-12 h-12 mx-auto text-slate-600 mb-4" />
          <p className="text-slate-400">Nenhum processo encontrado</p>
        </div>
      ) : (
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
                    <p className="font-mono text-sm text-slate-200">{processo.numeroProcesso}</p>
                    <p className="text-xs text-slate-500 mt-1">{processo.area || processo.assunto || '—'}</p>
                  </td>
                  <td className="px-6 py-4">
                    <span className="px-2 py-1 rounded-lg text-xs font-medium bg-dark-100 text-slate-300">
                      {processo.tribunalNome || processo.tribunalCodigo || '—'}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-sm text-slate-300 max-w-xs truncate">{processo.classe || '—'}</p>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 rounded-lg text-xs font-medium border ${statusColors[processo.status] || 'bg-slate-500/20 text-slate-400 border-slate-500/30'}`}>
                      {processo.status}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-sm text-slate-400">
                      {processo.ultimaAtualizacao
                        ? new Date(processo.ultimaAtualizacao).toLocaleDateString('pt-BR')
                        : '—'}
                    </p>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleViewDetails(processo)}
                        className="p-2 rounded-lg text-slate-400 hover:text-brand-400 hover:bg-brand-500/10 transition-colors"
                        title="Visualizar"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleRefresh(processo)}
                        className="p-2 rounded-lg text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                        title="Atualizar"
                      >
                        <RefreshCw className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(processo.id)}
                        className="p-2 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        title="Remover"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create Processo Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="glass rounded-2xl p-6 w-full max-w-md mx-4">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-white">Novo Processo</h2>
              <button
                onClick={() => setShowModal(false)}
                className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1">Número do Processo *</label>
                <input
                  type="text"
                  value={formData.numeroProcesso}
                  onChange={(e) => setFormData({ ...formData, numeroProcesso: e.target.value })}
                  className="w-full px-4 py-2.5 bg-dark-200 border border-brand-900/30 rounded-xl text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-brand-500/50"
                  placeholder="0001234-56.2024.8.13.0021"
                />
              </div>

              <div>
                <label className="block text-sm text-slate-400 mb-1">Tribunal *</label>
                <select
                  value={formData.tribunalId}
                  onChange={(e) => setFormData({ ...formData, tribunalId: e.target.value })}
                  className="w-full px-4 py-2.5 bg-dark-200 border border-brand-900/30 rounded-xl text-slate-200 focus:outline-none focus:border-brand-500/50 cursor-pointer"
                >
                  <option value="">Selecione o tribunal</option>
                  {tribunais.map((t) => (
                    <option key={t.id || t.codigo} value={t.id}>{t.nome || t.codigo}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm text-slate-400 mb-1">Advogado *</label>
                <select
                  value={formData.advogadoId}
                  onChange={(e) => setFormData({ ...formData, advogadoId: e.target.value })}
                  className="w-full px-4 py-2.5 bg-dark-200 border border-brand-900/30 rounded-xl text-slate-200 focus:outline-none focus:border-brand-500/50 cursor-pointer"
                >
                  <option value="">Selecione o advogado</option>
                  {advogados.map((a) => (
                    <option key={a.id} value={a.id}>{a.nome} - OAB {a.oab}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm text-slate-400 mb-1">Classe</label>
                <input
                  type="text"
                  value={formData.classe}
                  onChange={(e) => setFormData({ ...formData, classe: e.target.value })}
                  className="w-full px-4 py-2.5 bg-dark-200 border border-brand-900/30 rounded-xl text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-brand-500/50"
                  placeholder="Procedimento Comum Cível"
                />
              </div>

              <div>
                <label className="block text-sm text-slate-400 mb-1">Assunto</label>
                <input
                  type="text"
                  value={formData.assunto}
                  onChange={(e) => setFormData({ ...formData, assunto: e.target.value })}
                  className="w-full px-4 py-2.5 bg-dark-200 border border-brand-900/30 rounded-xl text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-brand-500/50"
                  placeholder="Contrato Bancário"
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 px-4 py-2.5 rounded-xl border border-slate-600 text-slate-300 hover:bg-slate-700 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving || !formData.numeroProcesso || !formData.tribunalId || !formData.advogadoId}
                className="flex-1 px-4 py-2.5 rounded-xl bg-brand-500 text-white hover:bg-brand-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
              >
                {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                Criar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {showDetailModal && selectedProcesso && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="glass rounded-2xl p-6 w-full max-w-lg mx-4">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-white">Detalhes do Processo</h2>
              <button
                onClick={() => setShowDetailModal(false)}
                className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-slate-500 uppercase">Número</p>
                  <p className="font-mono text-brand-400">{selectedProcesso.numeroProcesso}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase">Status</p>
                  <span className={`inline-block mt-1 px-2 py-1 rounded-lg text-xs font-medium border ${statusColors[selectedProcesso.status] || ''}`}>
                    {selectedProcesso.status}
                  </span>
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase">Tribunal</p>
                  <p className="text-slate-200">{selectedProcesso.tribunalNome || selectedProcesso.tribunalCodigo || '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase">Classe</p>
                  <p className="text-slate-200">{selectedProcesso.classe || '—'}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-xs text-slate-500 uppercase">Assunto</p>
                  <p className="text-slate-200">{selectedProcesso.assunto || selectedProcesso.area || '—'}</p>
                </div>
                {selectedProcesso.distribuicao && (
                  <div>
                    <p className="text-xs text-slate-500 uppercase">Distribuição</p>
                    <p className="text-slate-200">{new Date(selectedProcesso.distribuicao).toLocaleDateString('pt-BR')}</p>
                  </div>
                )}
                {selectedProcesso.relator && (
                  <div>
                    <p className="text-xs text-slate-500 uppercase">Relator</p>
                    <p className="text-slate-200">{selectedProcesso.relator}</p>
                  </div>
                )}
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowDetailModal(false)}
                className="flex-1 px-4 py-2.5 rounded-xl border border-slate-600 text-slate-300 hover:bg-slate-700 transition-colors"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
