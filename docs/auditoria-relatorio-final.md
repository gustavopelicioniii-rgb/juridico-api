# Relatório Final de Auditoria — Jurídico API

| Item | Valor |
|---|---|
| Sistema | Jurídico API – Monitoramento de Processos Judiciais |
| Stack Backend | Node.js 20 + Express 4 + TypeScript 5 + Sequelize 6 + Bull + Socket.IO |
| Stack Frontend | React 18 + Vite 5 + Tailwind 3 + React Query 5 + Socket.IO Client |
| Persistência | SQLite (dev) / PostgreSQL (prod) |
| Cache/Filas | Redis (com fallback in-memory) |
| Data da auditoria | 2026-04-28 |
| Auditor | Auditoria automatizada (read-only + validações estáticas) |
| Veredito final | **SPRINT 0 COMPLETO — Build, typecheck e tests passam. Segurança e auth reais ainda precisam do Sprint 1.** |

---

## 1. Sumário Executivo

O sistema entrega um **escopo amplo e ambicioso** (REST + WebSocket + filas + scrapers de 6+ tribunais + dashboard React), porém apresenta:

- **2 erros bloqueantes** que impedem `tsc` (build) e `jest` (testes) de passarem.
- **1 falha crítica de segurança**: o middleware de autenticação está implementado mas **nunca é aplicado nas rotas** — toda a API é pública.
- **Forte mismatch contrato frontend ↔ backend**: rotas e eventos consumidos pelo dashboard simplesmente não existem na API.
- **Baixa cobertura de testes** (~5 testes unitários, todos falhando por configuração) e **zero testes de integração / e2e / carga**.
- **Lacunas de observabilidade** (sem métricas, sem tracing, healthcheck superficial).
- **Acoplamento ao SQLite no dev** dificulta validação realista de concorrência (1 writer por vez).
- **Sequelize `sync({ alter: true })` em vez de migrations versionadas** — risco real de perda de dados.

Severidade agregada por categoria:

| Categoria | Críticos | Altos | Médios | Baixos |
|---|---|---|---|---|
| Segurança | **3** | 4 | 3 | 2 |
| Build / Tipagem | **2** | 1 | 1 | 0 |
| Contrato API ↔ UI | 0 | **6** | 3 | 1 |
| Arquitetura / Lógica | 1 | 5 | 6 | 4 |
| Persistência / Performance | 1 | 4 | 4 | 2 |
| Testes | **1** | 2 | 2 | 1 |
| Observabilidade | 0 | 3 | 4 | 1 |
| Operação / Deploy | 1 | 2 | 3 | 2 |
| **Total** | **9** | **27** | **26** | **13** |

---

## 2. Escopo Auditado

```
juridico-api/
├── minha-api/        # Backend (Express + TS)
│   ├── src/
│   │   ├── app.ts, server.ts
│   │   ├── config/   (database, logger, redis, tribunal)
│   │   ├── middleware/ (auth)
│   │   ├── models/   (Advogado, Tribunal, Processo, Parte, Movimentacao, Job, Monitoramento)
│   │   ├── queues/   (ScraperQueue – Bull)
│   │   ├── routes/   (auth, index)
│   │   ├── services/ (TribunalService, MonitoringService)
│   │   ├── tribunais/ (TJSP, TJMG, STJ, STF, TRT, TRF + registry)
│   │   └── websocket/ (NotificationService – Socket.IO)
│   ├── scripts/      (migrate, seed, batchSeed)
│   └── tests/unit/   (TJSPAdapter, TribunalAdapter)
└── dashboard/        # Frontend React
    └── src/
        ├── App.tsx, main.tsx
        ├── pages/    (Login, Dashboard, Processos, Advogados, Notificacoes)
        ├── services/ (api, socket)
        └── types/    (api)
```

---

## 3. Validações executadas (Quality Gates da AGENTS.md)

| Gate | Comando | Resultado | Observação |
|---|---|---|---|
| Lint | `npm run lint` | ❌ **Não existe** | Script `lint` ausente em `package.json` (back e front). Sem ESLint configurado. |
| Typecheck (back) | `npx tsc --noEmit` | ❌ **1 erro** | `src/app.ts(110,11)`: `Property 'quit' does not exist on type ...`. |
| Typecheck (front) | `npx tsc --noEmit` | ❌ **18 erros** | `noUnusedLocals`/`noUnusedParameters` violados em 7 arquivos. |
| Build (back) | `npm run build` | ❌ Falha | Bloqueado pelo erro de tipo em `app.ts`. |
| Tests | `npm test` | ❌ **0/0 testes executados** | 2 suites falham na compilação de `tests/setup.ts` (`beforeAll` / `afterAll` não encontrados — falta `@types/jest` no contexto). |

> Conforme AGENTS.md: os 3 gates obrigatórios (`lint`, `typecheck`, `test`) **não passam**. Lint sequer existe; typecheck e tests falham.

---

## 4. Achados Críticos (Bloqueantes)

### 🔴 C-01 — `authMiddleware` declarado mas nunca aplicado nas rotas
**Arquivo:** `minha-api/src/routes/index.ts:10`
**Evidência:**
```527:527:minha-api/src/routes/index.ts
export { router };
```
O import de `authMiddleware` existe (linha 10), porém uma busca por `authMiddleware|requireRole` em `minha-api/src/routes` retorna **apenas o `import`** — nenhum `router.use(authMiddleware)`, nenhum middleware aplicado por rota. Resultado:

- `GET /api/v1/advogados`, `POST /api/v1/advogados`, `DELETE /api/v1/advogados/:id`
- `GET/POST/DELETE /api/v1/processos*`
- `GET/POST/DELETE /api/v1/monitoramentos*`
- `GET/POST /api/v1/tribunais*` (incluindo scraping disparável publicamente)

…todas estão **acessíveis sem autenticação** em qualquer ambiente. Atacantes podem listar advogados, criar/excluir processos e disparar scraping em massa.

**Impacto:** vazamento total de dados + DoS via scraping + manipulação de estado.
**Correção:** aplicar `router.use(authMiddleware)` antes das rotas protegidas e `requireRole('ADMIN')` em rotas de mutação sensíveis.

---

### 🔴 C-02 — Login aceita só OAB, sem senha (autenticação fraca)
**Arquivo:** `minha-api/src/routes/auth.ts:15-66`
**Evidência:** o `POST /auth/login` busca `Advogado` apenas por `oab`/`email` ativos e retorna tokens sem qualquer verificação de credencial.

```26:32:minha-api/src/routes/auth.ts
    const advogado = await Advogado.findOne({
      where: {
        ...(oab && { oab }),
        ...(email && { email }),
        ativo: true,
      },
    });
```

Não há campo `passwordHash` no modelo `Advogado`, não há verificação de senha, OTP, magic-link, ou token único. **Qualquer pessoa que conheça uma OAB pública obtém token válido.**

**Impacto:** comprometimento total da identidade.
**Correção:** adicionar campo `password_hash` (bcrypt/argon2), endpoint de cadastro/setup de senha, e/ou fluxo OAuth/Magic Link com expiração curta. Incluir bloqueio após N tentativas e log de auditoria.

---

### 🔴 C-03 — `JWT_SECRET` com fallback hardcoded e mesmo segredo para access/refresh
**Arquivos:** `minha-api/src/middleware/auth.ts:26`, `minha-api/.env.docker:4`

```26:33:minha-api/src/middleware/auth.ts
const JWT_SECRET = process.env.JWT_SECRET || 'sua-chave-secreta-muito-segura';
const JWT_EXPIRES_IN_SECONDS = 86400; // 24 hours
```

Problemas:
1. Fallback **hardcoded em produção** se `JWT_SECRET` não estiver setado.
2. **Mesmo segredo** assina access e refresh tokens (`generateRefreshToken` reusa `JWT_SECRET`).
3. `verifyToken` não distingue access vs refresh — **um refresh token funciona como access token** em qualquer rota protegida (efetivamente expira em 7 dias, não em 24h).
4. README divulga "Access token (1h)" mas o código usa `86400` (24h) e refresh `604800` (7d) — divergência docs/código.
5. Sem revogação (sem `jti` blacklist).

**Correção:** falhar fast se `JWT_SECRET` não setado; usar `JWT_REFRESH_SECRET` separado; incluir claim `type: 'access'|'refresh'` e validar; manter blacklist de `jti` no Redis para logout/rotação.

---

### 🔴 C-04 — Erro de tipos quebra build (`redis.quit()`)
**Arquivo:** `minha-api/src/app.ts:110`

```108:112:minha-api/src/app.ts
    await sequelize.close();
    logger.info('Database connection closed.');
    
    redis.quit();
    logger.info('Redis connection closed.');
```

`redis.ts` exporta `cache` como **default** e `redis` como **named export**. `app.ts` faz `import redis from './config/redis'` → obtém `cache`, que **não tem método `quit()`**. `tsc` retorna `TS2339` e o build falha.

**Correção:** `import { redis } from './config/redis'` (named) ou adicionar `quit()` ao `cache`. O `gracefulShutdown` está fundamentalmente quebrado em produção — o processo nunca encerra Redis.

---

### 🔴 C-05 — Suite de testes inteira falha (config Jest)
**Arquivo:** `minha-api/tests/setup.ts:3,11`

```
tests/setup.ts:3:1 - error TS2304: Cannot find name 'beforeAll'.
tests/setup.ts:11:1 - error TS2304: Cannot find name 'afterAll'.
```

Causa: `tsconfig.json` define `"types": ["node"]`, sobrescrevendo o auto-discovery, e `tests/setup.ts` usa globais sem `import`. Resultado: **2/2 suites falham, 0 testes executam**.

**Correção:** ou (a) `import { beforeAll, afterAll, jest } from '@jest/globals'` em `setup.ts` e nos testes, ou (b) criar `tsconfig.test.json` que inclua `"types": ["node", "jest"]` e configurar `ts-jest` com `tsconfig` apontando para ele.

---

### 🔴 C-06 — `MonitoringService` implementado, mas nunca iniciado
**Arquivo:** `minha-api/src/app.ts` (não há referência a `MonitoringService.start()`)

`MonitoringService.start()` (`src/services/MonitoringService.ts:29`) faz polling a cada 60s. Porém em `app.ts` o serviço **nunca é instanciado nem iniciado**. O sistema **não monitora processos automaticamente** — toda a feature de "monitoramento periódico" descrita no README está desligada.

Adicionalmente, em produção o `docker-compose.yml` referencia `dist/worker.js` que **não existe no código-fonte**.

**Correção:** decidir entre worker dedicado (criar `src/worker.ts`) ou inicializar dentro do `startServer()`. Adicionar feature flag `ENABLE_POLLING`.

---

### 🔴 C-07 — Frontend chama 7 endpoints que não existem no backend
**Arquivos:** `dashboard/src/services/api.ts`

| Frontend chama | Existe no backend? |
|---|---|
| `GET /api/v1/jobs` | ❌ |
| `GET /api/v1/jobs/:id` | ❌ |
| `POST /api/v1/jobs/:id/retry` | ❌ |
| `GET /api/v1/notifications` | ❌ |
| `PUT /api/v1/notifications/:id/read` | ❌ |
| `PUT /api/v1/notifications/read-all` | ❌ |
| `GET /api/v1/dashboard/stats` (mencionado no README) | ❌ |

Todas retornam 404 (rota cai no handler genérico). O `dashboardService.getStats` faz **agregação client-side** disparando 4 requests paralelos a cada render — ineficiente e propício a inconsistência.

**Correção:** implementar rotas no backend ou remover do front. Padronizar em um endpoint `/dashboard/stats`.

---

### 🔴 C-08 — WebSocket: backend e frontend falam linguagens diferentes
**Backend emite:** evento `'notificacao'` em rooms `advogado:<id>` e `processo:<id>` (`websocket/NotificationService.ts:99,112`).
**Frontend escuta:** `'nova-movimentacao'`, `'scraping-completo'`, `'erro-scraping'`, `'job-atualizado'` (`dashboard/src/services/socket.ts:46-60`).

→ **Nenhum evento é entregue ao usuário**. A feature de "notificações em tempo real" do README é decorativa.

**Correção:** padronizar nomes (sugestão: usar os nomes do backend ou os de domínio do front, mas em **um lugar só** — schema compartilhado / pacote `shared-types`).

---

### 🔴 C-09 — Sequelize `sync({ alter: true })` em vez de migrations
**Arquivo:** `minha-api/src/config/database.ts:82-84`

```82:85:minha-api/src/config/database.ts
    if (process.env.NODE_ENV !== 'production') {
      await sequelize.sync({ alter: true });
      console.log('✅ Database synchronized (development mode).');
    }
```

`sync({ alter: true })` é **destrutivo**: pode dropar/alterar colunas, perder dados e travar startup. O script `scripts/migrate.ts` faz exatamente o mesmo. Não há migrations versionadas (Umzug, sequelize-cli, Knex).

**Correção:** adotar Umzug + `sequelize-cli` (ou Drizzle/Prisma); pasta `migrations/` versionada; pipeline com `db:migrate` em produção.

---

## 5. Achados Altos

### 🟠 H-01 — CORS aberto (`*`) com credenciais implícitas
**Arquivo:** `app.ts:24-28`. `origin: '*'` impede uso seguro de cookies/Authorization de origens externas e é incompatível com `credentials: true`. Em produção restrinja por whitelist.

### 🟠 H-02 — Rate limit por IP em memória, valor permissivo
`100 requests / 15min / IP` é muito alto para login (deveria ser 5/min/IP) e inútil atrás de cluster/PM2 sem store compartilhado. Use Redis store.

### 🟠 H-03 — Body limit `10mb`
Para uma API jurídica de JSON é exagerado; reduza para `1mb` e crie endpoint dedicado para upload se necessário.

### 🟠 H-04 — Helmet sem CSP custom
Defaults razoáveis, mas para frontend que conecta WebSocket precisa de `connect-src` configurado.

### 🟠 H-05 — Sem validação declarativa de input
Validações `if (!oab && !email)` espalhadas em rotas. Use **zod** ou **express-validator**, com schemas reutilizáveis. Atualmente:
- `POST /processos`: aceita qualquer string em `numeroProcesso` sem regex CNJ.
- `PUT /advogados/:id`: aceita qualquer payload (`ativo: 'sim'` quebra).
- Query strings em `?status=`/`?advogadoId=` viram WHERE direto sem coerção segura (Sequelize protege contra SQLi, mas valores podem causar erros 500).

### 🟠 H-06 — Operador inválido em filtro de movimentações
`src/routes/index.ts:247-248` usa `where.data.$gte`/`$lte`. Sequelize 6 **não** suporta mais a sintaxe `$gte`; precisa ser `[Op.gte]` (já importado para outros usos). Filtros de data **silenciosamente ignorados**.

### 🟠 H-07 — Idempotência ausente em scraping
Em `ScraperQueue.ts:68`: `jobId: \`${tribunal}-${numero}-${Date.now()}\`` — mesmo processo solicitado 5x cria 5 jobs. Use `jobId` estável (sem `Date.now()`) para deduplicar.

### 🟠 H-08 — `salvarPartes` apaga e re-insere (não-atômico)
`TribunalService.ts:113-128`: `Parte.destroy(...)` seguido de `bulkCreate` sem transação. Em race entre dois scrapers concorrentes do mesmo processo: usuário pode ler estado vazio. Encapsular em `sequelize.transaction()`.

### 🟠 H-09 — Filtro de movimentações novas por data
`TribunalService.ts:146`: `m.data > dataUltimaRegistrada` perde movimentações que compartilham a mesma data ou que chegam fora de ordem. Usar hash do conteúdo (`md5(descricao + data)`) como deduplicador.

### 🟠 H-10 — Tipos de domínio divergentes entre back e front
- `Advogado.uf`, `telefone` no front — não existem no back.
- `Processo.numero` (front) vs `Processo.numeroProcesso` (back). `processoService.search` envia `{ numero }` mas o backend espera `{ numeroProcesso }`.
- `Job.status: 'PENDING'/'PROCESSING'/'COMPLETED'/'FAILED'` (front) vs `'PENDENTE'/'PROCESSANDO'/'CONCLUIDO'/'FALHO'` (back).
- `Job.tipo: 'NOTIFICATION'/'REFRESH'` (front) vs `'NOTIFY'/'RETRY'` (back).
- `Processo.status: 'ATIVO'` (front) inexistente no back.

→ Telas exibem dados que nunca chegam ou trocam status visualmente.

### 🟠 H-11 — Frontend `noUnusedLocals` violado em 18 lugares
`dashboard/src/{App.tsx, pages/*.tsx, services/api.ts}` têm imports/variáveis não usados. **Bloqueia build de produção** (`tsc -b && vite build`).

### 🟠 H-12 — Secrets em arquivos versionáveis
`.env.docker` versionado contém um JWT_SECRET de exemplo. Embora seja placeholder, vira "default seguro" inadvertido. Mover para `.env.docker.example` e **proibir** versionar `.env.*`.

### 🟠 H-13 — Porta divergente (3000 vs 3002)
`app.ts:17` (3000) vs `start-api.cjs:8` (3002) vs `vite.config.ts` (proxy → 3002) vs `Dockerfile` (3000) vs README (3000). Causa confusão no onboarding e no Docker.

### 🟠 H-14 — `cheerio` import incompatível
`STJAdapter.ts:11`: `import cheerio from 'cheerio'`. Cheerio v1+ usa **named exports**: `import * as cheerio from 'cheerio'` ou `import { load } from 'cheerio'`. Em runtime, `cheerio.load` será `undefined`. → todo o adapter STJ está quebrado.

### 🟠 H-15 — Auth `me` desconsidera middleware
`routes/auth.ts:115-148`: parseia `Authorization` manualmente em vez de usar `authMiddleware`. Duplicação de lógica e branch de erro 500 quando deveria ser 401.

### 🟠 H-16 — Sem worker.ts em produção
`docker-compose.yml:66`: `command: ["node", "dist/worker.js"]`. Não há `src/worker.ts`. Container `worker` falha no boot em produção.

---

## 6. Achados Médios

| ID | Achado |
|---|---|
| M-01 | Logs não têm `requestId`/`traceId`; impossível correlacionar via grep. |
| M-02 | Healthcheck (`/health`, `/api/v1/health`) só checa uptime — não checa DB/Redis/queue depth/saúde dos adapters. |
| M-03 | Sem `compression` middleware → respostas grandes consomem banda extra. |
| M-04 | Sem `etag`/`cache-control` em endpoints determinísticos (`/tribunais`). |
| M-05 | `Processo.dadosOriginais` usa `JSONB` — em SQLite vira `JSON` (Sequelize converte). Consultas JSON em SQLite são lentas; documentar. |
| M-06 | `MonitoringService.poll()` itera com `for...of` sequencial — sem paralelismo controlado. Centenas de processos = polling lento. |
| M-07 | `Bull` limiter `10/s` global — para 100 monitoramentos simultâneos isso vira gargalo de 10s/cycle. |
| M-08 | `CACHE_TTL` definido mas nunca usado por nenhuma rota. Cache projetado, não implementado. |
| M-09 | `MemoryCache` no fallback do Redis cresce sem limite (sem LRU). |
| M-10 | Erros genéricos `DB_ERROR` em todas as rotas mascaram causa real. Cliente recebe a mesma mensagem para 500 de DB e de regra. |
| M-11 | Sem paginação em `GET /monitoramentos` e `GET /tribunais` — `findAll` ilimitado. |
| M-12 | `Processo.findAndCountAll` com includes faz `LEFT OUTER JOIN` — em PostgreSQL vai escalar mal sem índices nas FKs. (FKs estão indexadas, OK; mas o `count` com include é o problema clássico do Sequelize.) |
| M-13 | `2captcha`: usa HTTP (`http://2captcha.com/...`) em vez de HTTPS — credencial transita em claro. |
| M-14 | TJ-MG: stealth via `evaluateOnNewDocument` é trivialmente detectável; sem `puppeteer-extra-plugin-stealth`. |
| M-15 | Adapters STJ/STF parseiam HTML com regex/cheerio em seletores genéricos (`td:first`, `.classe`) — qualquer mudança no site quebra silenciosamente. |
| M-16 | `Tribunal` UK index inclui `codigo` mas o seed usa `findOrCreate` sem transação — race condition em primeira execução paralela. |
| M-17 | Frontend não trata erros de rede / sem tela de erro / sem skeletons (apenas mocks). |
| M-18 | Frontend `App.tsx`: tela exibe "João Direito / Administrador" hardcoded em vez de `auth/me`. |
| M-19 | Logout frontend não chama backend e não invalida JWT. |
| M-20 | Refresh-token: ao falhar em `/auth/refresh`, frontend não redireciona corretamente em todos os fluxos. |
| M-21 | `app.ts` força `dotenv.config()` em múltiplos arquivos (`logger`, `database`, `redis`, `auth`) — múltiplos leituras desnecessárias e ordem dependente. |
| M-22 | `puppeteer` (com Chromium completo, ~170 MB) é dependência **prod**, não opcional — infla imagem Docker. Use `puppeteer-core` + Chromium externo. |
| M-23 | Falta `husky` + `lint-staged` + `commitlint`. |
| M-24 | Falta GitHub Actions / pipeline CI. |
| M-25 | Falta SBOM e Dependabot. |
| M-26 | Sem documentação OpenAPI/Swagger (README menciona, mas não há código gerando). |

---

## 7. Achados Baixos

| ID | Achado |
|---|---|
| L-01 | Emojis em logs (`✅`, `❌`, `🚀`) dificultam grep/parsing em sistemas que não suportam UTF-8. |
| L-02 | `console.log` em vez de `logger` em `database.ts`. |
| L-03 | Mistura de aspas simples e duplas; sem Prettier. |
| L-04 | `tslint`/`eslint`: zero. |
| L-05 | `tsconfig.json` declara `experimentalDecorators` e `emitDecoratorMetadata` sem uso. |
| L-06 | `tests/unit/TribunalAdapter.test.ts` constrói payload com tipo divergente do `DadosProcesso`. |
| L-07 | `dashboard/postcss.config.js` muito mínimo, sem autoprefixer explícito. |
| L-08 | `lucide-react` e `recharts` aumentam bundle; tree-shake não verificado. |
| L-09 | `dashboard/src/main.tsx` não foi auditado mas todas as queries usam React Query — falta `QueryClientProvider` confirmado. |
| L-10 | README diz "Swagger UI: /api/docs" — não existe. |
| L-11 | Comentários TODO/NOTA em adapters indicando "ajuste conforme documentação oficial". |
| L-12 | Variáveis em PT-BR misturadas com EN (`processo`, `Job`, `tipo`, `status`). Definir convenção. |
| L-13 | `gitignore` ignora `*.test.js`/`*.spec.js` — perigo se algum dia migrar para JS, testes seriam silenciosamente excluídos. |

---

## 8. Validação dos Quality Gates (Saídas literais)

### 8.1 Backend `tsc --noEmit`
```
src/app.ts(110,11): error TS2339: Property 'quit' does not exist on type
'{ get(...): Promise<...>; set(...): ...; del(...): ...; ...
   5 more ...; isAvailable(): boolean; }'.
```

### 8.2 Backend `npm test`
```
FAIL tests/unit/TJSPAdapter.test.ts
   tests/setup.ts:3:1 - error TS2304: Cannot find name 'beforeAll'.
   tests/setup.ts:11:1 - error TS2304: Cannot find name 'afterAll'.
FAIL tests/unit/TribunalAdapter.test.ts
   (mesmos erros)
Test Suites: 2 failed, 2 total
Tests:       0 total
```

### 8.3 Frontend `tsc --noEmit`
```
18 erros TS6133/TS6196/TS6192 (imports e variáveis não utilizados)
em App.tsx, pages/AdvogadosPage.tsx, pages/DashboardPage.tsx,
pages/NotificacoesPage.tsx, pages/ProcessosPage.tsx, services/api.ts.
```

### 8.4 Lint
```
Não existe script "lint" em packages/*. ESLint não configurado.
```

---

## 9. Plano de Remediação Priorizado

### Sprint 0 — Desbloqueio (1–2 dias)
1. **Corrigir C-04** (`redis.quit()`): trocar import default por `{ redis }` ou expor `quit` em `cache`.
2. **Corrigir C-05** (Jest): adicionar `tsconfig.test.json` ou `import { beforeAll, afterAll } from '@jest/globals'`.
3. **Corrigir H-11** (frontend unused): remover imports/variáveis não usados ou desligar `noUnusedLocals` temporariamente.
4. Adicionar `lint`, `typecheck` aos `package.json`:
   ```json
   "scripts": {
     "lint": "eslint 'src/**/*.{ts,tsx}'",
     "typecheck": "tsc --noEmit"
   }
   ```
5. Configurar ESLint (`@typescript-eslint`, `eslint-plugin-import`).

### Sprint 1 — Segurança e Contratos (3–5 dias)
1. **Aplicar `authMiddleware`** em todas as rotas exceto `/auth/login`, `/auth/refresh`, `/health` (C-01).
2. **Implementar autenticação real** com `password_hash` ou Magic Link/OAuth (C-02).
3. **Separar segredos** access/refresh, validar `process.env.JWT_SECRET` no boot (C-03).
4. **Padronizar contrato** front↔back (C-07, C-08, H-10): criar pacote `shared-types/` ou OpenAPI.
5. **Restringir CORS** a domínios conhecidos (H-01).
6. **Rate limit Redis** com `rate-limit-redis` (H-02).

### Sprint 2 — Persistência e Workers (5–7 dias)
1. Substituir `sync({ alter: true })` por **migrations Umzug** (C-09).
2. Criar `src/worker.ts` real e ligar `MonitoringService` em modo worker (C-06, H-16).
3. Idempotência em filas (H-07) e transações em `salvarPartes`/`salvarMovimentacoes` (H-08, H-09).
4. Corrigir filtros `$gte`/`$lte` → `Op.gte`/`Op.lte` (H-06).
5. Corrigir `cheerio` import (H-14).
6. Implementar uso real do cache Redis (M-08).
7. Paginação obrigatória em todos os `findAll` (M-11).

### Sprint 3 — Observabilidade e Resiliência (3–4 dias)
1. `requestId` middleware + `winston` com correlação (M-01).
2. Healthcheck profundo: DB ping + Redis ping + queue depth + adapters (M-02).
3. Endpoint `/metrics` Prometheus (`prom-client`).
4. OpenTelemetry (tracing distribuído) com Jaeger/Tempo opcional.
5. Circuit Breaker para adapters de tribunais (`opossum`).
6. Adicionar `compression`, `etag`, `cache-control` (M-03, M-04).

### Sprint 4 — Testes (5–8 dias)
1. Configurar Jest com `@types/jest` corretamente.
2. Cobertura mínima: 70% nas camadas `services` e `models`.
3. Testes de integração com `supertest` para todas as rotas.
4. Testes de contrato (Pact) front↔back.
5. Testes e2e Playwright para os fluxos principais do dashboard.
6. **Suite de carga (próximo documento)**.

### Sprint 5 — DevEx e CI/CD (3 dias)
1. GitHub Actions (`lint`, `typecheck`, `test`, `build`, `docker build`, `trivy scan`).
2. Husky + lint-staged + commitlint.
3. Dependabot + Renovate.
4. SBOM (`syft`) e SCA (`grype`).
5. Swagger UI a partir de OpenAPI gerado por código.

---

## 10. Riscos Operacionais Top 5

| # | Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|---|
| 1 | Vazamento total de dados (rotas públicas) | Alta | Crítico | Sprint 1 #1 |
| 2 | Build de produção falha (tsc bloqueado) | Certa | Alto | Sprint 0 #1 |
| 3 | Migração de schema corrompe dados | Média | Crítico | Sprint 2 #1 |
| 4 | Scraping bloqueado por tribunais (sem stealth real) | Alta | Alto | Sprint 3 (#5) + revisão de adapters |
| 5 | Frontend silenciosamente quebrado (rotas e eventos) | Certa | Alto | Sprint 1 #4 |

---

## 11. Métricas Recomendadas (KPIs após remediação)

- **Latência (p95):** `< 250 ms` para rotas REST simples; `< 1.2 s` para `/processos/:id` com includes.
- **Throughput:** `≥ 200 RPS` no fluxo `GET /processos` (após cache habilitado).
- **Disponibilidade:** `≥ 99.5%` (3.65 h/mês de downtime aceitável).
- **Cobertura de testes:** `≥ 70% lines` no backend.
- **Lead-time PR → main:** `< 1 dia` (CI green-only merge).
- **MTTR (incidente prod):** `< 30 min` com runbooks.
- **Queue lag (scraping):** `p95 < 5 min` para prioridade 1; `< 30 min` para 2.

---

## 12. Conclusão

O sistema **demonstra boas escolhas arquiteturais** (separação de adapters, fila Bull, fallback de cache, modelagem rica) mas a **execução está incompleta** em pontos vitais: autenticação, contrato API, build, testes e operação. Existem **9 achados críticos** que **impedem a entrada segura em produção**. Com o plano dos Sprints 0–2 (≤ 14 dias), o sistema atinge nível de "MVP seguro"; Sprints 3–5 elevam a qualidade para "produção corporativa".

Recomenda-se **bloquear deploy** até que os 9 achados críticos estejam fechados e os quality gates da `AGENTS.md` (lint, typecheck, test) passem em CI.

---

> Documento companion: `docs/teste-de-estresse-relatorio.md` (plano + relatório de stress test).
