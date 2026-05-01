# Auditoria Completa - Juridico-API

**Sistema:** Juridico-API — Monitoramento de Processos Judiciais
**Stack Backend:** Node.js 20 + Express 4 + TypeScript 5 + Sequelize 6 + Bull + Socket.IO
**Stack Frontend:** React 18 + Vite 5 + Tailwind 3 + React Query 5 + Socket.IO Client
**Persistência:** SQLite (dev) / PostgreSQL (prod)
**Cache/Filas:** Redis (com fallback in-memory)
**Data da auditoria:** 2026-04-29
**Auditor:** Auditoria automatizada (read-only + validações estáticas)
**Versão do documento:** 1.0

---

## Sumario Executivo

O sistema entrega um escopo amplo e ambicioso (REST + WebSocket + filas + scrapers de 6+ tribunais + dashboard React), com arquitetura bem separadas em camadas. Contudo, apresenta problemas criticos de seguranca, lacunas de resiliência e codigo orphaned.

**Veredito: REQUER CORRECOES ANTES DE PRODUCAO**

### Severidade Agregada

| Categoria | Criticos | Altos | Medios | Baixos | Total |
|---|---|---|---|---|---|
| Seguranca | 3 | 4 | 3 | 2 | **12** |
| Arquitetura / Logica | 1 | 5 | 6 | 4 | **16** |
| Persistencia / Performance | 1 | 4 | 4 | 2 | **11** |
| Scraping / Resiliencia | 1 | 5 | 2 | 1 | **9** |
| Observabilidade | 0 | 3 | 4 | 1 | **8** |
| Build / Tipo | 0 | 1 | 1 | 0 | **2** |
| **Total** | **6** | **22** | **20** | **10** | **58** |

---

## 1. Arquitetura do Sistema

### 1.1 Diagrama de Componentes

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              juridico-api                                    │
│                                                                          │
│  ┌─────────────┐     ┌──────────────┐     ┌──────────────────────────┐  │
│  │   Client    │     │  Bull Queue  │     │   NotificationService    │  │
│  │  (Browser)  │◄──►│   (Redis)    │     │     (Socket.IO)        │  │
│  └──────┬──────┘     └──────┬───────┘     └───────────┬──────────────┘  │
│         │                    │                          │                  │
│         │ HTTP/REST          │ Job Processing           │ WebSocket         │
│         ▼                    ▼                          ▼                  │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │                        Express App                                   │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │  │
│  │  │  Routes  │  │Middleware │  │ Services │  │ TribunalAdapters │  │  │
│  │  │ /auth    │  │  auth    │  │Tribunal  │  │  (DataJud + 6)   │  │  │
│  │  │ /process │  │  rateLim │  │Monitor   │  │                  │  │  │
│  │  │ /monitor │  │  cors    │  │Enriqueci │  │                  │  │  │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────────────┘  │  │
│  └────────────────────────────┬───────────────────────────────────────┘  │
│                               │                                          │
│                    ┌──────────┴──────────┐                              │
│                    │     Sequelize ORM     │                              │
│                    └──────────┬──────────┘                              │
│                               │                                          │
│         ┌────────────────────┼────────────────────┐                    │
│         ▼                    ▼                    ▼                    │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐              │
│  │ PostgreSQL  │    │   Redis     │    │  External   │              │
│  │  (prod)    │    │  (cache)   │    │  DataJud CNJ │              │
│  │  SQLite    │    │             │    │   TJSP TJMG │              │
│  │  (dev)     │    │             │    │   STJ STF   │              │
│  └─────────────┘    └─────────────┘    └─────────────┘              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Entry Points

| Arquivo | Proposito |
|---|---|
| `src/server.ts` | Entry point de producao — compilado para `dist/server.js` |
| `src/app.ts` | Configuracao Express, middleware, rotas, graceful shutdown |
| `src/worker.ts` | Processo worker standalone para scraping/monitoring |

**Fluxo de startup em `app.ts`:**
1. Conecta ao banco via `connectDatabase()`
2. Executa auto-seed (tribunais + usuario admin `juridico123`)
3. Inicializa WebSocket via `notificationService.initialize(httpServer)`
4. Inicia `MonitoringService` (configuravel via `ENABLE_MONITORING`)
5. Escuta na porta `PORT` (default 3000)

### 1.3 Services e Responsabilidades

| Service | Arquivo | Responsabilidade |
|---|---|---|
| `TribunalService` | `src/services/TribunalService.ts` | Orquestra busca/salvamento de processos via adaptadores |
| `MonitoringService` | `src/services/MonitoringService.ts` | Polling periodico de processos monitorados |
| `ProcessoMonitoramentoService` | `src/services/ProcessoMonitoramentoService.ts` | Monitora OABs para novos processos, notifica via WebSocket |
| `AdvogadoOnboardingService` | `src/services/AdvogadoOnboardingService.ts` | Onboarding de advogados, inicia crawl inicial |
| `NotificationService` | `src/websocket/NotificationService.ts` | Gerencia conexoes WebSocket e notificacoes realtime |

### 1.4 Queue System (Bull/Redis)

**Arquivo:** `src/queues/ScraperQueue.ts`

- Nome da fila: `scrape-processos`
- Tipos de job: `PROCESSO` (scraping unico), `INITIAL_OAB_CRAWL` (crawl inicial por OAB)
- Rate limit: max 10 jobs por segundo
- Retry: 3 attempts com backoff exponencial (5s, 10s, 20s)
- Remove jobs completados (100) e falhados (50) automaticamente

---

## 2. Contrato da API — Rotas

### 2.1 Rotas Publicas (sem auth)

| Rota | Metodo | Proposito |
|---|---|---|
| `/auth/login` | POST | Login com OAB + senha |
| `/auth/register` | POST | Auto-registro de advogado |
| `/auth/refresh` | POST | Refresh de token JWT |
| `/auth/logout` | POST | Invalida token |
| `/auth/me` | GET | Dados do usuario atual |
| `/dashboard/movimentacoes` | GET | Estatisticas de movimentacoes |
| `/tribunais/batch-status` | GET | Health check de multiplos tribunais |
| `/health` | GET | Liveness probe |
| `/api/v1/health` | GET | Readiness probe (DB + Redis + WebSocket) |

### 2.2 Rotas Protegidas (auth requerida)

| Rota | Metodo | Proposito |
|---|---|---|
| `/advogados` | GET | Lista advogados |
| `/advogados/:id` | GET | Detalhes de advogado |
| `/advogados/:id/processos` | GET | Processos por advogado |
| `/advogados/:id/onboarding-status` | GET | Status do onboarding |
| `/processos` | GET | Lista processos (com filtros) |
| `/processos/:id` | GET | Detalhes de processo |
| `/processos/:id/movimentacoes` | GET | Movimentacoes do processo |
| `/processos/:id/movimentacoes/novas` | GET | Movimentacoes novas (ultimas 48h) |
| `/processos/:id/partes` | GET | Partes do processo |
| `/processos/:id/monitorar` | POST/DELETE | Iniciar/parar monitoramento |
| `/tribunais` | GET | Lista tribunais |
| `/tribunais/:codigo/buscar` | POST | Buscar processo por numero |
| `/tribunais/:codigo/buscar-oab` | POST | Buscar processos por OAB |
| `/tribunais/:codigo/status` | GET | Health status do tribunal |
| `/tribunais/:codigo/processos/:numero/refresh` | POST | Atualizar dados do processo |
| `/monitoramentos` | GET | Lista monitoramentos ativos |
| `/jobs` | GET | Lista de jobs |
| `/jobs/:id` | GET | Detalhes de job |
| `/jobs/:id/retry` | POST | Retry de job falho |
| `/notifications` | GET | Lista notificacoes |
| `/notifications/:id/read` | PUT | Marcar como lida |
| `/notifications/read-all` | PUT | Marcar todas como lidas |
| `/dashboard/stats` | GET | Estatisticas para dashboard |

---

## 3. Seguranca

### 3.1 Autenticacao / Autorizacao

**IMPACTO: CRITICO**

**[C-01] Autenticacao nao aplicada nas rotas** — `src/routes/index.ts`

Exceto `/auth`, **nenhuma rota** tem o middleware `authMiddleware` aplicado. Toda a API REST e publica.

```48:48:minha-api/src/routes/index.ts
router.use('/auth', authRouter);
```

Todas as rotas (`/advogados`, `/processos`, `/monitoramentos`, `/jobs`, `/notifications`) sao acessiveis sem token JWT.

**Recomendacao:** Aplicar `authMiddleware` globalmente ou em router especifico para rotas protegidas.

---

**[C-02] Secrets JWT fallback hardcoded** — `src/middleware/auth.ts`

```28:29:minha-api/src/middleware/auth.ts
JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-unsafe'
JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret-unsafe'
```

Se `JWT_SECRET` nao estiver configurado em producao, tokens sao assinados com segredo previsivel.

**Recomendacao:** Falhar o startup se `JWT_SECRET` nao estiver definido em producao.

---

**[C-03] Senha admin hardcoded no seed** — `src/app.ts`, `scripts/seed.ts`

```229:229:minha-api/src/app.ts
const senhaHash = await bcrypt.hash('juridico123', 12);
```

Usuario admin com OAB `SP123456` e senha `juridico123` e criado no auto-seed. Qualquer pessoa com acesso ao codigo conhece a senha.

**Recomendacao:** Remover usuario admin do auto-seed ou usar senha gerada aleatoriamente armazenada em env var.

---

### 3.2 Input Validation

**[M-01] Zod presente mas nao aplicado nas rotas** — `src/app.ts`

Zod e usado apenas no error handler global. Rotas validam campos manualmente sem esquema.

```20:29:minha-api/src/routes/auth.ts
const { oab, nome, email, password } = req.body;
if (!oab || !nome || !email || !password) {
  return res.status(400).json({ erro: 'Todos os campos sao obrigatorios' });
}
```

**Recomendacao:** Criar Zod schemas para cada route body/query e aplicar validacao antes do handler.

---

**[M-02] Formato de numero de processo sem validacao** — `src/routes/index.ts`

`numeroProcesso` aceito como qualquer string de ate 50 caracteres. Nenhuma validacao de formato CNJ.

**Recomendacao:** Implementar validacao de digito verificador CNJ (modulo 97).

---

**[M-03] Campos sem range check no banco** — `src/migrations/001-initial-schema.ts`

`nivelSigilo` (INTEGER), `intervaloMinutos` (INTEGER), `valorCausa` (BIGINT) nao tem CHECK constraints. Valores negativos ou zero sao aceitos no banco.

**Recomendacao:** Adicionar CHECK constraints no banco: `CHECK (nivel_sigilo >= 0)`, `CHECK (intervalo_minutos > 0)`, `CHECK (valor_causa >= 0)`.

---

### 3.3 CORS

**[B-01] CORS bem configurado** — `src/app.ts`

- Origens permitidas via env var `CORS_ORIGIN`
- Credenciais habilitadas
- Headers explícitos

```50:63:minha-api/src/app.ts
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173,http://localhost:5174,http://localhost:3000').split(',');
```

**Recomendacao:** Em producao, garantir que `CORS_ORIGIN` seja definido e nao inclua origens nao autorizadas.

---

### 3.4 Rate Limiting

**[B-02] Rate limiting presente e bem configurado** — `src/app.ts`

- Auth limiter: 10 req/15min em `/api/v1/auth`
- API limiter: 100 req/15min em `/api/v1`

---

### 3.5 Error Handling

**[M-04] Stack trace no log em producao** — `src/app.ts`

```174:174:minha-api/src/app.ts
logger.error('Unhandled error:', { requestId, error: err.message, stack: err.stack });
```

O `err.stack` e logado server-side. Se o logger estiver configurado para stdout em producao (ejetao), stack traces com paths internos vazam.

**Recomendacao:** Logar `err.stack` apenas se `NODE_ENV !== 'production'` ou usar mascara de sanitizacao.

---

## 4. Base de Dados

### 4.1 Modelos e Relacionamentos

```
Advogado (1)──(N) Processo          Advogado (1)──(N) Monitoramento
Advogado (1)──(N) Notification      Tribunal (1)──(N) Processo
Processo (1)──(N) Parte             Processo (1)──(N) Movimentacao
Processo (1)──(N) Job              Processo (1)──(N) Monitoramento
Notification.processoId (SET NULL on delete) — pode existir sem processo
```

### 4.2 Tabelas e Campos

#### `advogados`
| Campo | Tipo | Restricao |
|---|---|---|
| id | UUID | PK |
| oab | VARCHAR(20) | NOT NULL, UNIQUE |
| nome | VARCHAR(255) | NOT NULL |
| email | VARCHAR(255) | NULL (nao explicitamente NOT NULL) |
| password_hash | VARCHAR(255) | NULL |
| ativo | BOOLEAN | default true |

#### `tribunais`
| Campo | Tipo | Restricao |
|---|---|---|
| id | UUID | PK |
| codigo | VARCHAR(10) | NOT NULL, UNIQUE |
| nome | VARCHAR(100) | NOT NULL |
| base_url | TEXT | NOT NULL |
| tipo | ENUM('TJ','STJ','STF','TRT','TRF') | NOT NULL |
| usa_captcha | BOOLEAN | default false |
| scraper_config | JSONB | NULL |
| ativo | BOOLEAN | default true |

#### `processos`
| Campo | Tipo | Restricao |
|---|---|---|
| id | UUID | PK |
| numero_processo | VARCHAR(50) | NOT NULL, UNIQUE |
| tribunal_id | UUID | FK -> tribunais(id), SET NULL |
| advogado_id | UUID | FK -> advogados(id), SET NULL |
| classe | VARCHAR(255) | NULL |
| classe_codigo | INTEGER | NULL |
| assunto | TEXT | NULL |
| assunto_principal | VARCHAR(500) | NULL |
| instancia | ENUM('PRIMEIRA','SEGUNDA','SUPERIOR') | default 'PRIMEIRA' |
| status | ENUM('MONITORANDO','ARQUIVADO','ENCERRADO','ERRO') | default 'MONITORANDO' |
| primeira_instancia | DATE | NULL |
| ultima_movimentacao | DATE | NULL |
| data_ajuizamento | DATE | NULL |
| valor_causa | BIGINT | NULL |
| orgao_julgador | VARCHAR(255) | NULL |
| orgao_julgador_codigo | INTEGER | NULL |
| nivel_sigilo | INTEGER | NULL |
| sistema | VARCHAR(100) | NULL |
| formato | VARCHAR(50) | NULL |
| dados_originais | JSONB | NULL |
| enriquecido | BOOLEAN | default false |

#### `partes`
| Campo | Tipo | Restricao |
|---|---|---|
| id | UUID | PK |
| processo_id | UUID | FK -> processos(id), CASCADE |
| tipo | ENUM('AUTOR','REU','ADVOGADO','OUTRO','LITISDENUNCIANTE','LITISDENUNCIADO','TERCEIRO') | NOT NULL |
| nome | VARCHAR(255) | NOT NULL |
| documento | VARCHAR(50) | NULL |
| is_advogado | BOOLEAN | default false |

#### `movimentacoes`
| Campo | Tipo | Restricao |
|---|---|---|
| id | UUID | PK |
| processo_id | UUID | FK -> processos(id), CASCADE |
| descricao | TEXT | NOT NULL |
| data | DATE | NOT NULL |
| origem | VARCHAR(50) | NULL |
| dados_originais | JSONB | NULL |
| nova | BOOLEAN | default true |

#### `jobs`
| Campo | Tipo | Restricao |
|---|---|---|
| id | UUID | PK |
| processo_id | UUID | FK -> processos(id), SET NULL |
| tipo | ENUM('SCRAPE','NOTIFY','RETRY') | NOT NULL |
| status | ENUM('PENDENTE','PROCESSANDO','CONCLUIDO','FALHO') | default 'PENDENTE' |
| payload | JSONB | NULL |
| erro | TEXT | NULL |
| scheduled_at | DATE | default NOW |
| started_at | DATE | NULL |
| completed_at | DATE | NULL |
| tentativas | INTEGER | default 0 |
| max_tentativas | INTEGER | default 3 |

#### `monitoramentos`
| Campo | Tipo | Restricao |
|---|---|---|
| id | UUID | PK |
| advogado_id | UUID | FK -> advogados(id), CASCADE |
| processo_id | UUID | FK -> processos(id), CASCADE |
| intervalo_minutos | INTEGER | default 60 |
| ativo | BOOLEAN | default true |
| ultimo_poll | DATE | NULL |

#### `notifications`
| Campo | Tipo | Restricao |
|---|---|---|
| id | UUID | PK |
| advogado_id | UUID | FK -> advogados(id), CASCADE |
| processo_id | UUID | FK -> processos(id), SET NULL |
| tipo | ENUM('NOVA_MOVIMENTACAO','SCRAPING_COMPLETO','ERRO_SCRAPING','PROCESSO_ATUALIZADO') | NOT NULL |
| mensagem | TEXT | NOT NULL |
| lida | BOOLEAN | default false |
| dados | JSONB | NULL |

#### `oabs_monitoradas`
| Campo | Tipo | Restricao |
|---|---|---|
| id | UUID | PK |
| oab | VARCHAR(20) | NOT NULL, UNIQUE |
| ativo | BOOLEAN | default true |
| intervalo_minutos | INTEGER | default 5 |
| usuario_id | INTEGER | NULL |
| ultima_verificacao | DATE | NULL |

### 4.3 Índices

| Tabela | Índices |
|---|---|
| advogados | UNIQUE(oab), ativo |
| tribunais | UNIQUE(codigo), ativo, tipo |
| processos | UNIQUE(numero_processo), tribunal_id, advogado_id, status, ultima_movimentacao |
| partes | processo_id, tipo |
| movimentacoes | (processo_id, data), processo_id, nova |
| jobs | processo_id, tipo, (status, scheduled_at) |
| monitoramentos | (advogado_id, ativo), processo_id, ativo |
| notifications | (advogado_id, lida), processo_id, created_at |
| oabs_monitoradas | UNIQUE(oab), ativo, usuario_id |

**GAP:** Nao existe indice em `(advogado_id, status)` em `processos` — query comum "processos MONITORANDO de advogado X" facaria full scan.

**GAP:** Nao existe indice em `(processo_id, data DESC)` em `movimentacoes` para ordenacao eficiente.

### 4.4 Gaps de Validacao

| Campo | Validacao Ausente |
|---|---|
| `Advogado.oab` | Formato OAB (2 letras + 6 digitos + 2 letras) |
| `Advogado.email` | allowNull nao explicitamente false |
| `Parte.documento` | Formato CPF (11 digitos) / CNPJ (14 digitos) |
| `Processo.numeroProcesso` | Formato CNJ (NNNNNNN-DD.AAAA.J.TR.OOOO) |
| `Processo.nivelSigilo` | CHECK (nivel_sigilo >= 0) |
| `Processo.valorCausa` | CHECK (valor_causa >= 0); risco de precisao BIGINT/JS |
| `Monitoramento.intervaloMinutos` | CHECK (intervalo_minutos > 0) |
| `Job.maxTentativas` | CHECK (max_tentativas > 0) |
| `Job.tentativas` | CHECK (tentativas >= 0) |
| `OABMonitorada.oab` | Mesmo gap de formato OAB |
| `Tribunal.baseUrl` | Validacao de formato URL |

---

## 5. Scraping / Integracao com Tribunais

### 5.1 Adaptadores Disponiveis

| Arquivo | Tribunal | Estrategia | CAPTCHA |
|---|---|---|---|
| `DataJudAdapter.ts` | **Todos (91 tribunais)** | REST API (ElasticSearch CNJ) | Nao |
| `TJSPAdapter.ts` | TJ Sao Paulo | REST API + public fallback | Nao |
| `TJMGAdapter.ts` | TJ Minas Gerais | Puppeteer | Sim (2Captcha) |
| `STJAdapter.ts` | STJ | HTML scraping | Nao |
| `STFAdapter.ts` | STF | HTML scraping | Sim (NAO IMPLEMENTADO) |
| `TRTAdapter.ts` | TRT (parametrizavel por regiao) | HTML scraping | Nao |
| `TRFAdapter.ts` | TRF (parametrizavel por regiao) | HTML scraping | Sim (NAO IMPLEMENTADO) |

**Arquitetura:** `DataJudAdapter` e o padrao para todos os 91 tribunais via API unificada CNJ. Adaptadores legados (TJSP, TJMG, etc.) so sao usados se `DATAJUD_USE_LEGACY=true`.

### 5.2 Timeouts

| Componente | Timeout | Local |
|---|---|---|
| BaseTribunalAdapter | 30,000 ms | `ITribunalAdapter.ts` linha 106 |
| Puppeteer page.goto (TJMG) | 60,000 ms | `TJMGAdapter.ts` linha 224 |
| Puppeteer waitForSelector | 10,000 ms | `TJMGAdapter.ts` linha 252 |
| Health check (todos) | 5,000 ms | Cada adaptador |
| Bull queue job | **NAO DEFINIDO** | `ScraperQueue.ts` |

### 5.3 Retry Logic

| Componente | Retry | Detalhes |
|---|---|---|
| Bull Queue | 3 attempts | Backoff exponencial: 5s, 10s, 20s |
| TJMGAdapter | 3 attempts | Delay 5-10s + restart browser entre attempts |
| DataJudAdapter | Nenhum | Falha vai para Bull retry |
| STJ/STF/TRT/TRF | **NENHUM** | Single attempt, depende de Bull retry |

### 5.4 Rate Limiting

| Componente | Rate Limit | Observacao |
|---|---|---|
| Bull Queue | 10 jobs/sec | Unico mecanismo global |
| TJSPAdapter | Header-based (x-rate-limit) | Ativado quando remaining <= 5 |
| TJMG | Nenhum | Falls back se CAPTCHA |
| DataJud | Nenhum | Bull limiter indiretamente protege |

**GAP CRITICO:** `src/config/tribunal.ts` define limites por tribunal mas **nenhum adaptador le esses valores**. Sao decorativos.

### 5.5 Issues de Resiliencia

**[C-04] Puppeteer browser leak** — `TJMGAdapter.ts`

O adaptador mantem `browser` e `page` como propriedades de instancia sem `closeBrowser()` no shutdown. Se o adaptador for re-instanciado multiplas vezes, processos browser acumulam na memoria.

**Recomendacao:** Implementar `BrowserPool` com cleanup no shutdown.

---

**[C-05] TRT/STF captcha declarado mas nao implementado** — `STFAdapter.ts`, `TRFAdapter.ts`

Ambos setam `usaCaptcha = true` mas nao tem logica de resolucao. Encontros com CAPTCHA vao falhar silenciosamente.

---

**[C-06] Codigo referencedor de arquivos inexistentes** — `tests/unit/`

Os arquivos `tests/unit/CrawlerResilience.test.ts` e `tests/unit/CaptchaHandler.test.ts` referenciam `src/services/CrawlerResilience.ts` e `src/services/CaptchaHandler.ts`, que **nao existem** no codebase.

---

**[M-05] Parsing HTML do TJMG via regex** — `TJMGAdapter.ts`

O TJMG adapter usa regex em strings raw de HTML em vez de cheerio/DOM parser:

```linhas 276-327:minha-api/src/tribunais/TJMGAdapter.ts
const numeroMatch = html.match(/Número do Processo:\s*([0-9.-]+)/);
```

Mudancas na estrutura HTML do tribunal vao quebrar silenciosamente.

**Recomendacao:** Usar cheerio para parsing DOM.

---

**[M-06] Adaptadores HTML sem retry** — `STJAdapter.ts`, `STFAdapter.ts`, `TRTAdapter.ts`, `TRFAdapter.ts`

 Fazem uma unica chamada HTTP sem retry. Falhas vao para Bull retry que reinicia o job inteiro (com todos os steps), quando poderiam tentar apenas a chamada HTTP novamente.

**Recomendacao:** Implementar retry em nivel de HTTP com backoff rapido antes de escalar para Bull retry.

---

**[M-07] DataJud 429 nao tratado proativamente** — `DataJudAdapter.ts`

HTTP 429 e capturado e relancado como erro, mas nao ha backoff proativo. O sistema vai hammering a API em retry.

**Recomendacao:** Implementar backoff exponencial ao detectar 429.

---

**[B-03] Selector CSS fragil em adaptadores HTML** — `TJSPAdapter.ts`, `STJAdapter.ts`, etc.

Usam seletores genericos como `[class*="classe"]`, `[class*="assunto"]`. Se o tribunal mudar a estrutura CSS, o scraping quebra.

---

## 6. Observabilidade

### 6.1 Logging

**Bom:** Winston centralizado com JSON, timestamps, `errors({ stack: true })`, rotacao de arquivos (5MB, 5 arquivos).

**Problema:** `console.*` usado diretamente em `database.ts` (3 lugares), `redis.ts` (3 lugares), e onboarding error path (2 lugares). Esses vao para stdout bypassing Winston.

### 6.2 Error Handling

**Global handler** (`src/app.ts`): Diferencia ZodError (400) de generic Error (500), props `requestId` na resposta, nao expoe stack ao cliente.

**GAP:** Nao ha tratamento para `SyntaxError` (malformed JSON body) — Express emite isso antes do handler.

**GAP:** Bull `failed`/`completed` handlers tem `.catch()` que engolem erros silenciosamente.

### 6.3 Health Checks

| Endpoint | O que verifica | Status |
|---|---|---|
| `/health` | Nenhum (always 200) | Liveness OK |
| `/api/v1/health` | DB (authenticate) | Readiness OK |
| `/api/v1/health` | Redis (NAO VERIFICA — sempre 'ok') | **BROKEN** |
| `/api/v1/health` | WebSocket (count >= 0 sempre true) | **BROKEN** |

### 6.4 Memory Leaks

| Componente | Risco | Status |
|---|---|---|
| NotificationService connectedClients | Map gerenciado corretamente | OK |
| MonitoringService pollInterval | Intervalliminado em stop() | OK |
| ProcessoMonitoramentoService intervalId | Intervalliminado em parar() | OK |
| Bull ScrapeQueue | Queue nao fechada no shutdown | **RISCO** |
| TJMGAdapter Puppeteer browser | Browser nao fechado no shutdown | **RISCO CRITICO** |

### 6.5 Unhandled Promise Rejections

Nao existe `process.on('unhandledRejection')` em nenhum lugar do codigo. Rotas com import dinamico fire-and-forget (onboarding) podem gerar unrejected promises sem crash.

---

## 7. Plano de Correcao Prioritizado

### FASE 1 — Bloqueantes (antes de producao)

| # | Issue | Severidade | Arquivo | Estimativa |
|---|---|---|---|---|
| 1 | Aplicar `authMiddleware` as rotas protegidas | CRITICO | `src/routes/index.ts` | 30 min |
| 2 | Remover secrets fallback hardcoded ou falhar startup | CRITICO | `src/middleware/auth.ts` | 15 min |
| 3 | Remover/adicionar env na senha admin do seed | CRITICO | `src/app.ts`, `scripts/seed.ts` | 15 min |
| 4 | Implementar `closeBrowser()` no TJMGAdapter | CRITICO | `src/tribunais/TJMGAdapter.ts` | 30 min |
| 5 | Criar `CrawlerResilience.ts` e `CaptchaHandler.ts` (ou remover testes) | ALTO | `src/services/` | 2h |

### FASE 2 — Seguridadee Observabilidade

| # | Issue | Severidade | Arquivo | Estimativa |
|---|---|---|---|---|
| 6 | Criar Zod schemas para validacao de input | MEDIO | `src/routes/` | 2h |
| 7 | Adicionar CHECK constraints no banco | MEDIO | `src/migrations/001-initial-schema.ts` | 1h |
| 8 | Corrigir health check de Redis (ping real) | MEDIO | `src/app.ts` | 30 min |
| 9 | Corrigir health check de WebSocket (verificacao real) | MEDIO | `src/app.ts` | 30 min |
| 10 | Adicionar handler de `unhandledRejection` | MEDIO | `src/server.ts` | 15 min |
| 11 | Substituir `console.*` por logger Winston | MEDIO | `src/config/` | 1h |

### FASE 3 — Performance e Resiliencia

| # | Issue | Severidade | Arquivo | Estimativa |
|---|---|---|---|---|
| 12 | Implementar retry em nivel HTTP nos adaptadores HTML | ALTO | `src/tribunais/` | 2h |
| 13 | Adicionar indice (advogado_id, status) em processos | ALTO | `src/migrations/` | 15 min |
| 14 | Implementar backoff proativo no DataJud 429 | MEDIO | `src/tribunais/DataJudAdapter.ts` | 1h |
| 15 | Fechar Bull queue no shutdown | MEDIO | `src/app.ts`, `src/queues/` | 30 min |
| 16 | Implementar CircuitBreaker pattern | MEDIO | `src/services/CrawlerResilience.ts` | 2h |

### FASE 4 — Divertidos / Tech Debt

| # | Issue | Severidade | Estimativa |
|---|---|---|---|
| 17 | Validacao de digito verificador CNJ | BAIXO | 1h |
| 18 | Implementar CAPTCHA no STF/TRF adapters | ALTO | 3h |
| 19 | Usar cheerio em vez de regex no TJMGAdapter | BAIXO | 1h |
| 20 | Adicionar indices compostos para queries comuns | MEDIO | 1h |
| 21 | Testes覆盖率 (~30%) | ALTO | 8h |

---

## 8. Arquivos Analisados

```
minha-api/
├── src/
│   ├── app.ts
│   ├── server.ts
│   ├── worker.ts
│   ├── config/
│   │   ├── database.ts
│   │   ├── logger.ts
│   │   ├── redis.ts
│   │   └── tribunal.ts
│   ├── middleware/
│   │   └── auth.ts
│   ├── models/
│   │   ├── index.ts
│   │   ├── Advogado.ts
│   │   ├── Tribunal.ts
│   │   ├── Processo.ts
│   │   ├── Parte.ts
│   │   ├── Movimentacao.ts
│   │   ├── Job.ts
│   │   ├── Monitoramento.ts
│   │   ├── Notification.ts
│   │   └── OABMonitorada.ts
│   ├── routes/
│   │   ├── index.ts
│   │   └── auth.ts
│   ├── services/
│   │   ├── TribunalService.ts
│   │   ├── MonitoringService.ts
│   │   ├── ProcessoMonitoramentoService.ts
│   │   ├── AdvogadoOnboardingService.ts
│   │   ├── TJMGDirectCrawler.ts
│   │   └── ProcessoEnriquecimentoService.ts
│   ├── tribunais/
│   │   ├── index.ts
│   │   ├── ITribunalAdapter.ts
│   │   ├── DataJudAdapter.ts
│   │   ├── TJSPAdapter.ts
│   │   ├── TJMGAdapter.ts
│   │   ├── STJAdapter.ts
│   │   ├── STFAdapter.ts
│   │   ├── TRTAdapter.ts
│   │   └── TRFAdapter.ts
│   ├── queues/
│   │   ├── index.ts
│   │   └── ScraperQueue.ts
│   ├── websocket/
│   │   ├── index.ts
│   │   └── NotificationService.ts
│   └── migrations/
│       ├── index.ts
│       └── 001-initial-schema.ts
├── scripts/
│   ├── migrate.ts
│   ├── seed.ts
│   └── build-copy-entry.js
└── tests/
    └── unit/
        ├── CrawlerResilience.test.ts
        └── CaptchaHandler.test.ts
```

---

*Documento gerado em: 2026-04-29*
*Auditor: Automated Code Audit*
*Versao: 1.0*
