import { useState, useEffect } from 'react';
import { Bell, Check, CheckCheck, Trash2, FileText, AlertTriangle, Clock, Loader2 } from 'lucide-react';
import { notificationService } from '../services/api';
import type { Notification } from '../types/api';

function getNotificationTitle(tipo: string, mensagem: string): string {
  switch (tipo) {
    case 'SCRAPING_COMPLETO':
      return 'Scraping Concluído';
    case 'ERRO_SCRAPING':
      return 'Erro no Scraping';
    case 'PROCESSO_ATUALIZADO':
      return 'Processo Atualizado';
    case 'NOVA_MOVIMENTACAO':
      return 'Nova Movimentação';
    case 'NOVO_JOB':
      return 'Novo Job Agendado';
    case 'JOB_COMPLETED':
      return 'Job Concluído';
    case 'JOB_FAILED':
      return 'Job Falhou';
    default:
      return mensagem.split(':')[0] || 'Notificação';
  }
}

export default function NotificacoesPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');

  const filteredNotifications = notifications.filter((n) => {
    return filter === 'all' || (filter === 'unread' && !n.lida);
  });

  const unreadCount = notifications.filter((n) => !n.lida).length;

  const fetchNotifications = () => {
    setLoading(true);
    setError(null);
    notificationService.getAll({ limite: 50 })
      .then(setNotifications)
      .catch(() => setError('Erro ao carregar notificações'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchNotifications();
  }, []);

  const markAsRead = async (id: string) => {
    try {
      await notificationService.markAsRead(id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, lida: true } : n))
      );
    } catch {
      setError('Erro ao marcar como lida');
    }
  };

  const markAllAsRead = async () => {
    try {
      await notificationService.markAllAsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, lida: true })));
    } catch {
      setError('Erro ao marcar todas como lidas');
    }
  };

  const deleteNotification = async (id: string) => {
    try {
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    } catch {
      setError('Erro ao excluir notificação');
    }
  };

  const getIcon = (tipo: Notification['tipo']) => {
    switch (tipo) {
      case 'SCRAPING_COMPLETO':
      case 'JOB_COMPLETED':
        return <Check className="w-5 h-5" />;
      case 'ERRO_SCRAPING':
      case 'JOB_FAILED':
        return <AlertTriangle className="w-5 h-5" />;
      case 'NOVA_MOVIMENTACAO':
      case 'PROCESSO_ATUALIZADO':
        return <FileText className="w-5 h-5" />;
      default:
        return <Bell className="w-5 h-5" />;
    }
  };

  const getIconColor = (tipo: Notification['tipo']) => {
    switch (tipo) {
      case 'SCRAPING_COMPLETO':
      case 'JOB_COMPLETED':
        return 'bg-emerald-500/20 text-emerald-400';
      case 'ERRO_SCRAPING':
      case 'JOB_FAILED':
        return 'bg-red-500/20 text-red-400';
      case 'NOVA_MOVIMENTACAO':
      case 'PROCESSO_ATUALIZADO':
        return 'bg-brand-500/20 text-brand-400';
      default:
        return 'bg-slate-500/20 text-slate-400';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-8 h-8 animate-spin text-brand-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display font-bold text-2xl text-white">Notificações</h1>
          <p className="text-slate-400 text-sm mt-1">
            {unreadCount > 0 ? `${unreadCount} não lidas` : 'Todas as notificações foram lidas'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as 'all' | 'unread')}
            className="px-4 py-2.5 bg-dark-200 border border-brand-900/30 rounded-xl text-slate-300 focus:outline-none focus:border-brand-500/50 cursor-pointer"
          >
            <option value="all">Todas</option>
            <option value="unread">Não lidas</option>
          </select>
          {unreadCount > 0 && (
            <button
              onClick={markAllAsRead}
              className="flex items-center gap-2 px-4 py-2.5 bg-brand-500/10 text-brand-400 hover:bg-brand-500/20 border border-brand-500/30 rounded-xl transition-colors"
            >
              <CheckCheck className="w-4 h-4" />
              Marcar todas como lidas
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="glass rounded-2xl p-4 border border-red-500/30">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      <div className="space-y-3">
        {filteredNotifications.map((notification) => (
          <div
            key={notification.id}
            className={`glass rounded-2xl p-5 transition-all ${
              notification.lida ? 'opacity-70' : 'border-l-4 border-l-brand-500'
            }`}
          >
            <div className="flex items-start gap-4">
              <div className={`p-3 rounded-xl ${getIconColor(notification.tipo)}`}>
                {getIcon(notification.tipo)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <h3 className={`font-semibold ${notification.lida ? 'text-slate-300' : 'text-white'}`}>
                    {getNotificationTitle(notification.tipo, notification.mensagem)}
                  </h3>
                  <span className="text-xs text-slate-500 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {new Date(notification.createdAt).toLocaleString('pt-BR')}
                  </span>
                </div>
                <p className="text-sm text-slate-400 mb-3">{notification.mensagem}</p>
                <div className="flex items-center gap-2">
                  {!notification.lida && (
                    <button
                      onClick={() => markAsRead(notification.id)}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-brand-500/10 text-brand-400 hover:bg-brand-500/20 transition-colors text-sm"
                    >
                      <Check className="w-3 h-3" />
                      Marcar como lida
                    </button>
                  )}
                  <button
                    onClick={() => deleteNotification(notification.id)}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors text-sm"
                  >
                    <Trash2 className="w-3 h-3" />
                    Excluir
                  </button>
                </div>
              </div>
              {!notification.lida && (
                <div className="w-2 h-2 rounded-full bg-brand-500" />
              )}
            </div>
          </div>
        ))}

        {filteredNotifications.length === 0 && (
          <div className="glass rounded-2xl p-12 text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-slate-500/10 mb-4">
              <Bell className="w-8 h-8 text-slate-500" />
            </div>
            <h3 className="font-semibold text-slate-300 mb-2">Nenhuma notificação</h3>
            <p className="text-sm text-slate-500">
              {filter === 'unread' ? 'Todas as notificações foram lidas' : 'Você ainda não tem notificações'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
