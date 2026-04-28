import { useState, useEffect } from 'react';
import { Search, Plus, Edit2, Trash2, FileText, Phone, Mail, X, Loader2, Search as SearchIcon } from 'lucide-react';
import { advogadoService, processoService } from '../services/api';
import type { Advogado, Processo } from '../types/api';

export default function AdvogadosPage() {
  const [advogados, setAdvogados] = useState<Advogado[]>([]);
  const [search, setSearch] = useState('');
  const [filterAtivo, setFilterAtivo] = useState<string>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingAdvogado, setEditingAdvogado] = useState<Advogado | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  
  // Form state
  const [formData, setFormData] = useState({
    nome: '',
    oab: '',
    email: '',
    telefone: '',
    ativo: true,
  });

  // Processos modal state
  const [showProcessosModal, setShowProcessosModal] = useState(false);
  const [selectedAdvogado, setSelectedAdvogado] = useState<Advogado | null>(null);
  const [processos, setProcessos] = useState<Processo[]>([]);
  const [processosLoading, setProcessosLoading] = useState(false);
  const [onboardingMessage, setOnboardingMessage] = useState<string | null>(null);

  useEffect(() => {
    fetchAdvogados();
  }, []);

  const fetchAdvogados = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await advogadoService.getAll();
      setAdvogados(data);
    } catch (err) {
      setError('Erro ao carregar advogados');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const filteredAdvogados = advogados.filter((a) => {
    const matchesSearch = a.nome.toLowerCase().includes(search.toLowerCase()) || a.oab.includes(search);
    const matchesAtivo = filterAtivo === 'all' || (filterAtivo === 'ativos' && a.ativo) || (filterAtivo === 'inativos' && !a.ativo);
    return matchesSearch && matchesAtivo;
  });

  const openCreateModal = () => {
    setEditingAdvogado(null);
    setFormData({ nome: '', oab: '', email: '', telefone: '', ativo: true });
    setShowModal(true);
  };

  const openEditModal = (advogado: Advogado) => {
    setEditingAdvogado(advogado);
    setFormData({
      nome: advogado.nome,
      oab: advogado.oab,
      email: advogado.email || '',
      telefone: advogado.telefone || '',
      ativo: advogado.ativo,
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    try {
      setIsSaving(true);
      if (editingAdvogado) {
        await advogadoService.update(editingAdvogado.id, formData);
      } else {
        const createdAdvogado = await advogadoService.create(formData as Omit<Advogado, 'id' | 'createdAt'>);
        setOnboardingMessage(
          `Advogado ${createdAdvogado.nome} criado. Coleta inicial por OAB iniciada em background.`
        );
      }
      setShowModal(false);
      fetchAdvogados();
    } catch (err) {
      alert('Erro ao salvar advogado');
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Tem certeza que deseja excluir este advogado?')) return;
    try {
      await advogadoService.delete(id);
      fetchAdvogados();
    } catch (err) {
      alert('Erro ao excluir advogado');
      console.error(err);
    }
  };

  const openProcessosModal = async (advogado: Advogado) => {
    setSelectedAdvogado(advogado);
    setShowProcessosModal(true);
    setProcessosLoading(true);
    try {
      const data = await advogadoService.getProcessos(advogado.id);
      setProcessos(data);
    } catch (err) {
      console.error('Erro ao carregar processos:', err);
      setProcessos([]);
    } finally {
      setProcessosLoading(false);
    }
  };

  const handleBuscarProcessos = async (advogado: Advogado) => {
    const tribunal = window.prompt('Digite o código do tribunal (tjsp, tjmg, trt1, trf1, stj, stf):');
    if (!tribunal) return;
    
    try {
      const resultado = await processoService.searchByOAB(tribunal, {
        oab: advogado.oab,
        nome: advogado.nome,
        advogadoId: advogado.id,
      });
      if (resultado.processos && resultado.processos.length > 0) {
        alert(
          `Encontrado(s) ${resultado.totalEncontrados} processo(s): ${resultado.processos.map((p) => p.numeroProcesso || p.numero).join(', ')}`
        );
      } else {
        alert('Nenhum processo encontrado');
      }
    } catch (err) {
      console.error('Erro ao buscar processos:', err);
      alert('Erro ao buscar processos no tribunal');
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display font-bold text-2xl text-white">Advogados</h1>
          <p className="text-slate-400 text-sm mt-1">{filteredAdvogados.length} advogados encontrados</p>
        </div>
        <button 
          onClick={openCreateModal}
          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-brand-500 to-brand-600 hover:from-brand-400 hover:to-brand-500 text-white font-medium rounded-xl shadow-lg shadow-brand-500/30 transition-all"
        >
          <Plus className="w-4 h-4" />
          Novo Advogado
        </button>
      </div>

      <div className="glass rounded-2xl p-4">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
            <input
              type="text"
              placeholder="Buscar por nome ou OAB..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-dark-200 border border-brand-900/30 rounded-xl text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-brand-500/50 focus:ring-2 focus:ring-brand-500/20 transition-all"
            />
          </div>
          <select
            value={filterAtivo}
            onChange={(e) => setFilterAtivo(e.target.value)}
            className="px-4 py-2.5 bg-dark-200 border border-brand-900/30 rounded-xl text-slate-300 focus:outline-none focus:border-brand-500/50 cursor-pointer"
          >
            <option value="all">Todos</option>
            <option value="ativos">Apenas Ativos</option>
            <option value="inativos">Apenas Inativos</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="glass rounded-2xl p-4 bg-red-500/10 border border-red-500/30">
          <p className="text-red-400">{error}</p>
        </div>
      )}
      {onboardingMessage && (
        <div className="glass rounded-2xl p-4 bg-emerald-500/10 border border-emerald-500/30">
          <p className="text-emerald-300">{onboardingMessage}</p>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-brand-500" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredAdvogados.map((advogado) => (
            <div key={advogado.id} className="glass rounded-2xl p-5 card-hover">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center text-white font-bold text-lg">
                    {advogado.nome.split(' ').map(n => n[0]).slice(0, 2).join('')}
                  </div>
                  <div>
                    <h3 className="font-semibold text-white">{advogado.nome}</h3>
                    <p className="text-sm text-slate-400">OAB {advogado.oab}</p>
                  </div>
                </div>
                <span className={`px-2 py-1 rounded-lg text-xs font-medium ${advogado.ativo ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-500/20 text-slate-400'}`}>
                  {advogado.ativo ? 'Ativo' : 'Inativo'}
                </span>
              </div>
              
              <div className="space-y-2 mb-4">
                {advogado.email && (
                  <div className="flex items-center gap-2 text-sm text-slate-400">
                    <Mail className="w-4 h-4" />
                    {advogado.email}
                  </div>
                )}
                {advogado.telefone && (
                  <div className="flex items-center gap-2 text-sm text-slate-400">
                    <Phone className="w-4 h-4" />
                    {advogado.telefone}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 pt-4 border-t border-brand-900/30">
                <button
                  onClick={() => openProcessosModal(advogado)}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-brand-500/10 text-brand-400 hover:bg-brand-500/20 transition-colors text-sm font-medium"
                >
                  <FileText className="w-4 h-4" />
                  Processos
                </button>
                <button
                  onClick={() => handleBuscarProcessos(advogado)}
                  className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                  title="Buscar processos no tribunal"
                >
                  <SearchIcon className="w-4 h-4" />
                </button>
                <button 
                  onClick={() => openEditModal(advogado)}
                  className="p-2 rounded-lg text-slate-400 hover:text-brand-400 hover:bg-brand-500/10 transition-colors"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                <button 
                  onClick={() => handleDelete(advogado.id)}
                  className="p-2 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="glass rounded-2xl p-6 w-full max-w-md mx-4">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-white">
                {editingAdvogado ? 'Editar Advogado' : 'Novo Advogado'}
              </h2>
              <button 
                onClick={() => setShowModal(false)}
                className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1">Nome Completo</label>
                <input
                  type="text"
                  value={formData.nome}
                  onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
                  className="w-full px-4 py-2.5 bg-dark-200 border border-brand-900/30 rounded-xl text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-brand-500/50"
                  placeholder="João Silva"
                />
              </div>

              <div>
                <label className="block text-sm text-slate-400 mb-1">OAB</label>
                <input
                  type="text"
                  value={formData.oab}
                  onChange={(e) => setFormData({ ...formData, oab: e.target.value.toUpperCase() })}
                  className="w-full px-4 py-2.5 bg-dark-200 border border-brand-900/30 rounded-xl text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-brand-500/50"
                  placeholder="SP123456"
                />
              </div>

              <div>
                <label className="block text-sm text-slate-400 mb-1">Email</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-4 py-2.5 bg-dark-200 border border-brand-900/30 rounded-xl text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-brand-500/50"
                  placeholder="joao@email.com"
                />
              </div>

              <div>
                <label className="block text-sm text-slate-400 mb-1">Telefone</label>
                <input
                  type="text"
                  value={formData.telefone}
                  onChange={(e) => setFormData({ ...formData, telefone: e.target.value })}
                  className="w-full px-4 py-2.5 bg-dark-200 border border-brand-900/30 rounded-xl text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-brand-500/50"
                  placeholder="(11) 98765-4321"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="ativo"
                  checked={formData.ativo}
                  onChange={(e) => setFormData({ ...formData, ativo: e.target.checked })}
                  className="w-4 h-4 rounded border-brand-500 bg-dark-200 text-brand-500 focus:ring-brand-500"
                />
                <label htmlFor="ativo" className="text-sm text-slate-300">Advogado Ativo</label>
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
                disabled={isSaving || !formData.nome || !formData.oab}
                className="flex-1 px-4 py-2.5 rounded-xl bg-brand-500 text-white hover:bg-brand-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
              >
                {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                {editingAdvogado ? 'Salvar' : 'Criar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Processos Modal */}
      {showProcessosModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="glass rounded-2xl p-6 w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-xl font-bold text-white">Processos</h2>
                <p className="text-sm text-slate-400 mt-1">
                  {selectedAdvogado?.nome} - OAB {selectedAdvogado?.oab}
                </p>
              </div>
              <button 
                onClick={() => setShowProcessosModal(false)}
                className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {processosLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-brand-500" />
                </div>
              ) : processos.length === 0 ? (
                <div className="text-center py-12">
                  <FileText className="w-12 h-12 mx-auto text-slate-600 mb-4" />
                  <p className="text-slate-400">Nenhum processo encontrado</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {processos.map((processo) => (
                    <div key={processo.id} className="bg-dark-200/50 rounded-xl p-4 border border-brand-900/20">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <p className="font-mono text-brand-400 font-medium">{processo.numeroProcesso || processo.numero}</p>
                          <p className="text-sm text-slate-400 mt-1">{processo.tribunalNome || processo.tribunalCodigo}</p>
                        </div>
                        <span className={`px-2 py-1 rounded-lg text-xs font-medium ${
                          processo.status === 'ATIVO' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-500/20 text-slate-400'
                        }`}>
                          {processo.status}
                        </span>
                      </div>
                      {processo.classe && (
                        <p className="text-sm text-slate-300">{processo.classe}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
