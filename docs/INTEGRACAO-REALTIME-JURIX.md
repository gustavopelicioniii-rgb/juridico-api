# Integração da Juridico-API com Sistema Jurix (Realtime)

Este guia descreve como integrar a `juridico-api` (scraping de processos) com o sistema frontend `sistema-advocacia-jurix` usando Supabase Realtime.

---

## 1. Visão Geral da Arquitetura

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Sistema Jurix                                │
│                                                                     │
│  ┌─────────────┐                      ┌──────────────────────┐     │
│  │  Frontend  │ ◄─── WebSocket ──── │  juridico-api       │     │
│  │  (Jurix)   │      Realtime       │  (Scrapers + Bull)  │     │
│  │            │                      │                      │     │
│  │ React +    │      POST webhook   │  POST /webhook      │     │
│  │ Supabase   │ ──────────────────► │  (quando scraping    │     │
│  │ Realtime   │                      │   completa)          │     │
│  └─────────────┘                      └──────────────────────┘     │
│         │                                     │                    │
│         │         ┌──────────────────────┐     │                    │
│         └────────►│   Supabase          │◄────┘                    │
│                   │   Database +       │                            │
│                   │   Realtime         │                            │
│                   └──────────────────────┘                            │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Pré-requisitos

- [ ] `juridico-api` hospedada no Render (ou outro provedor)
- [ ] `sistema-advocacia-jurix` com Supabase configurado
- [ ] Canal Realtime do Supabase criado (`processos_notifications`)
- [ ] URL da juridico-api configurada

---

## 3. Passo a Passo

### 3.1. Criar Channel Realtime no Supabase

No Supabase Dashboard, crie uma tabela ou habilite Realtime em uma tabela existente:

```sql
-- Habilitar Realtime na tabela de processos (se já existir)
ALTER PUBLICATION supabase_realtime ADD TABLE processos;

-- Ou criar uma tabela específica para notificações
CREATE TABLE scraping_notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tipo VARCHAR(50) NOT NULL, -- 'SCRAPING_COMPLETO', 'NOVO_PROCESSO', 'ERRO'
  oab VARCHAR(20) NOT NULL,
  numero_processo VARCHAR(50),
  advogado_id UUID,
  dados JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Habilitar Realtime
ALTER TABLE scraping_notifications ENABLE ROW LEVEL SECURITY;

-- Policy para permitir leitura
CREATE POLICY "Allow all reads" ON scraping_notifications
  FOR SELECT USING (true);

-- Policy para permitir inserção (apenas via service role)
CREATE POLICY "Service role insert" ON scraping_notifications
  FOR INSERT WITH CHECK (true);
```

### 3.2. Configurar Variáveis de Ambiente no Jurix

No arquivo `.env` do `sistema-advocacia-jurix`:

```env
# URL da API de scraping
VITE_JURIDICO_API_URL=https://sua-api.onrender.com

# Supabase Realtime (opcional, se quiser separar)
VITE_SUPABASE_REALTIME_URL=https://xyz.supabase.co
VITE_SUPABASE_REALTIME_KEY=sua-chave-anon
```

### 3.3. Criar Serviço de Realtime no Frontend

Crie o arquivo `src/lib/realtime.ts`:

```typescript
// src/lib/realtime.ts
import { createClient } from '@supabase/supabase-js';
import type { RealtimeChannel } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// Cliente Supabase (já deve existir no seu projeto)
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export interface ScrapingNotification {
  id: string;
  tipo: 'SCRAPING_COMPLETO' | 'NOVO_PROCESSO' | 'ERRO_SCRAPING' | 'PROCESSO_ATUALIZADO';
  oab: string;
  numero_processo?: string;
  advogado_id?: string;
  dados?: Record<string, unknown>;
  created_at: string;
}

type NotificationCallback = (notification: ScrapingNotification) => void;

class RealtimeService {
  private channel: RealtimeChannel | null = null;
  private listeners: Set<NotificationCallback> = new Set();

  /**
   * Inscreve-se no canal Realtime de notificações de scraping.
   * Deve ser chamado quando o usuário faz login.
   */
  subscribe(advogadoId?: string): void {
    // Já existe channel? Não recriar.
    if (this.channel) return;

    this.channel = supabase
      .channel('scraping_notifications')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'scraping_notifications',
          filter: advogadoId ? `advogado_id=eq.${advogadoId}` : undefined,
        },
        (payload) => {
          const notification = payload.new as ScrapingNotification;
          this.notifyListeners(notification);
        }
      )
      .subscribe();

    console.log('[Realtime] Inscrito no canal de notificações');
  }

  /**
   * Cancela a inscrição do canal.
   * Deve ser chamado quando o usuário faz logout.
   */
  unsubscribe(): void {
    if (this.channel) {
      supabase.removeChannel(this.channel);
      this.channel = null;
      console.log('[Realtime] Desinscrito do canal de notificações');
    }
  }

  /**
   * Adiciona um listener para notificações.
   */
  addListener(callback: NotificationCallback): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private notifyListeners(notification: ScrapingNotification): void {
    this.listeners.forEach((callback) => {
      try {
        callback(notification);
      } catch (error) {
        console.error('[Realtime] Erro no listener:', error);
      }
    });
  }
}

export const realtimeService = new RealtimeService();
```

### 3.4. Integrar no AuthContext

No seu `AuthContext.tsx`, inscreva-se ao Realtime quando o usuário fizer login:

```typescript
// Exemplo genérico - adapte ao seu AuthContext existente
import { realtimeService } from '@/lib/realtime';
import { toast } from 'sonner'; // ou sua lib de notificações

// No método de login:
const login = async (email: string, password: string) => {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (data.user) {
    // Inscrição no Realtime após login
    realtimeService.subscribe(data.user.id);
    
    // Exemplo de listener para notificações
    const unsubscribe = realtimeService.addListener((notification) => {
      switch (notification.tipo) {
        case 'SCRAPING_COMPLETO':
          toast.success(
            `Scraping concluído para OAB ${notification.oab}`,
            {
              description: `${notification.dados?.total || 0} processos encontrados`,
              action: {
                label: 'Ver',
                onClick: () => router.push('/processos'),
              },
            }
          );
          break;
          
        case 'NOVO_PROCESSO':
          toast.info(`Novo processo encontrado: ${notification.numero_processo}`);
          break;
          
        case 'ERRO_SCRAPING':
          toast.error(`Erro no scraping: ${notification.dados?.erro}`);
          break;
      }
    });

    // Guardar unsubscribe para limpar no logout
    // (você pode armazenar no contexto ou cleanup)
  }
};

// No método de logout:
const logout = async () => {
  realtimeService.unsubscribe();
  await supabase.auth.signOut();
};
```

### 3.5. Configurar Webhook na juridico-api

No código da `juridico-api`, quando um scraping completar, envie uma notificação para o Supabase:

```typescript
// Em src/queues/ScraperQueue.ts ou serviço de scraping

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!; // Usar service role para bypass RLS

const supabase = createClient(supabaseUrl, supabaseKey);

async function notificarScrapingCompleto(
  oab: string,
  advogadoId: string,
  resultado: { total: number; novos: number; erros: number }
): Promise<void> {
  const { error } = await supabase.from('scraping_notifications').insert({
    tipo: 'SCRAPING_COMPLETO',
    oab,
    advogado_id: advogadoId,
    dados: {
      total: resultado.total,
      novos: resultado.novos,
      erros: resultado.erros,
    },
  });

  if (error) {
    logger.error(`[Webhook] Erro ao notificar: ${error.message}`);
  } else {
    logger.info(`[Webhook] Notificação enviada para OAB ${oab}`);
  }
}
```

Adicione no `.env` da `juridico-api`:

```env
SUPABASE_URL=https://xyz.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...
```

---

## 4. Variáveis de Ambiente Necessárias

### No `sistema-advocacia-jurix` (.env):

```env
VITE_JURIDICO_API_URL=https://sua-juridico-api.onrender.com
```

### Na `juridico-api` (.env):

```env
SUPABASE_URL=https://xyz.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sua-service-role-key
```

---

## 5. Testando a Integração

### 5.1. Testar manualmente

1. Faça uma requisição POST para iniciar scraping:
```bash
curl -X POST https://sua-juridico-api.onrender.com/api/oab/monitorar \
  -H "Content-Type: application/json" \
  -d '{"oab": "SP123456", "advogadoId": "uuid-do-advogado"}'
```

2. Verifique no Supabase se o registro foi inserido na tabela `scraping_notifications`

3. Verifique se o frontend recebeu a notificação em tempo real

### 5.2. Verificar WebSocket

No browser, abra DevTools > Network > WS (WebSocket) e veja as conexões.

---

## 6. Troubleshooting

| Problema | Solução |
|----------|---------|
| Notificação não chega | Verificar se Realtime está habilitado no Supabase |
| Erro RLS | Usar `SUPABASE_SERVICE_ROLE_KEY` (bypass RLS) |
| CORS no webhook | Adicionar origem do Supabase nas allowed origins |
| WebSocket disconnect | Verificar se há proxy/reverse proxy bloqueando |

---

## 7. Estrutura de Arquivos a Criar/Modificar

```
sistema-advocacia-jurix/
├── src/
│   ├── lib/
│   │   └── realtime.ts          # (NOVO) Serviço de realtime
│   ├── contexts/
│   │   └── AuthContext.tsx     # (MODIFICAR) Adicionar subscribe/unsubscribe
│   └── pages/
│       └── Processos.tsx       # (MODIFICAR) Exibir notificações de scraping
├── .env                         # (MODIFICAR) Adicionar VITE_JURIDICO_API_URL
└── ...
```

---

## 8. Links Úteis

- [Supabase Realtime Documentation](https://supabase.com/docs/guides/realtime)
- [Supabase JavaScript Client](https://supabase.com/docs/reference/javascript/subscribe)
- [React Query + Realtime Pattern](https://tanstack.com/query/latest/docs/react/reference/useQuery)

---

*Documento gerado em: 2026-04-29*
*Versão da API: juridico-api (minha-api)*
*Stack: React 18 + Vite + Supabase + Bull Queue*
