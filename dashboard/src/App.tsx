import { useState, useEffect } from 'react';
import { Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard,
  FileText,
  Users,
  Bell,
  Settings,
  LogOut,
  Search,
  Activity,
  TrendingUp,
  AlertTriangle,
  Clock,
  ChevronRight,
  Scale,
} from 'lucide-react';
import { authService, notificationService } from './services/api';
import { socketService } from './services/socket';
import type { User, Notification } from './types/api';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import ProcessosPage from './pages/ProcessosPage';
import AdvogadosPage from './pages/AdvogadosPage';
import NotificacoesPage from './pages/NotificacoesPage';

function Sidebar() {
  const location = useLocation();
  
  const navItems = [
    { path: '/', icon: LayoutDashboard, label: 'Dashboard' },
    { path: '/processos', icon: FileText, label: 'Processos' },
    { path: '/advogados', icon: Users, label: 'Advogados' },
    { path: '/notificacoes', icon: Bell, label: 'Notificações' },
    { path: '/configuracoes', icon: Settings, label: 'Configurações' },
  ];

  return (
    <aside className="fixed left-0 top-0 h-full w-64 glass border-r border-brand-900/30 z-50">
      <div className="flex items-center gap-3 p-6 border-b border-brand-900/30">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-lg shadow-brand-500/20">
          <Scale className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="font-display font-bold text-lg text-white">Jurídico</h1>
          <p className="text-xs text-slate-400">Monitor de Processos</p>
        </div>
      </div>

      <nav className="p-4 space-y-1">
        {navItems.map(({ path, icon: Icon, label }) => {
          const isActive = location.pathname === path;
          return (
            <Link
              key={path}
              to={path}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${
                isActive
                  ? 'bg-brand-500/20 text-brand-400 border border-brand-500/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-dark-100/50'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="font-medium">{label}</span>
              {isActive && <ChevronRight className="w-4 h-4 ml-auto" />}
            </Link>
          );
        })}
      </nav>

      <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-brand-900/30">
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center text-white text-sm font-bold">
            JD
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-slate-200 truncate">João Direito</p>
            <p className="text-xs text-slate-500">Administrador</p>
          </div>
          <button className="p-2 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}

function TopBar() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const location = useLocation();

  const pageTitles: Record<string, string> = {
    '/': 'Dashboard',
    '/processos': 'Processos',
    '/advogados': 'Advogados',
    '/notificacoes': 'Notificações',
    '/configuracoes': 'Configurações',
  };

  useEffect(() => {
    socketService.connect();
    socketService.on('notification', (notif) => {
      setNotifications((prev) => [notif as Notification, ...prev]);
    });
    return () => {
      socketService.off('notification', () => {});
    };
  }, []);

  const unreadCount = notifications.filter((n) => !n.lida).length;

  return (
    <header className="h-16 glass border-b border-brand-900/30 flex items-center justify-between px-6">
      <div>
        <h2 className="font-display font-semibold text-xl text-white">
          {pageTitles[location.pathname] || 'Dashboard'}
        </h2>
        <p className="text-xs text-slate-500">
          {new Date().toLocaleDateString('pt-BR', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })}
        </p>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            placeholder="Buscar processo..."
            className="w-64 pl-10 pr-4 py-2 bg-dark-100/50 border border-brand-900/30 rounded-xl text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-brand-500/50 focus:ring-2 focus:ring-brand-500/20 transition-all"
          />
        </div>

        <button className="relative p-2 rounded-xl bg-dark-100/50 border border-brand-900/30 text-slate-400 hover:text-brand-400 hover:border-brand-500/30 transition-all">
          <Bell className="w-5 h-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full text-xs text-white font-bold flex items-center justify-center notification-badge">
              {unreadCount}
            </span>
          )}
        </button>
      </div>
    </header>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem('token');
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <div className="min-h-screen bg-dark-300">
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/*"
          element={
            <ProtectedRoute>
              <div className="flex">
                <Sidebar />
                <main className="flex-1 ml-64">
                  <TopBar />
                  <div className="p-6">
                    <Routes>
                      <Route path="/" element={<DashboardPage />} />
                      <Route path="/processos" element={<ProcessosPage />} />
                      <Route path="/advogados" element={<AdvogadosPage />} />
                      <Route path="/notificacoes" element={<NotificacoesPage />} />
                      <Route path="/configuracoes" element={<div className="text-slate-400">Configurações em breve...</div>} />
                    </Routes>
                  </div>
                </main>
              </div>
            </ProtectedRoute>
          }
        />
      </Routes>
    </div>
  );
}
