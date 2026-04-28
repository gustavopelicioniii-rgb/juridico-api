# Relatório de Teste de Estresse — Jurídico API

| Item | Valor |
|---|---|
| Sistema sob teste | Jurídico API + WebSocket (Socket.IO) |
| Versão | `minha-api@1.0.0` (commit auditado em 2026-04-28) |
| Stack | Node.js 20, Express 4, Sequelize 6, Bull (Redis), Socket.IO 4 |
| Ambiente alvo | Local (Windows / Docker) — replicar em staging com infraestrutura igual à produção |
| Autor | Auditoria automatizada |
| Status | **Plano + ferramental pronto para execução**. Execução real bloqueada por bugs de build (ver §10). |

> Companion: `docs/auditoria-relatorio-final.md`.

---

## 1. Objetivos

1. **Validar SLOs** definidos para REST (p95 < 250 ms para rotas simples; < 600 ms para detalhe; < 1% erro).
2. **Identificar capacidade máxima** (RPS sustentável e ponto de saturação).
3. **Avaliar resiliência** a picos súbitos (spike) e degradação graceful.
4. **Detectar leaks** de memória/file-descriptor/connection-pool em soak (1 h).
5. **Validar integridade** dos dados sob concorrência (race conditions em scrapers e em `salvarPartes`/`salvarMovimentacoes`).
6. **Estressar WebSocket** com 200+ sockets simultâneos.
7. **Confirmar** comportamento de **rate limit**, **circuit breaker** e **fallback Redis→memória**.

---

## 2. Escopo

### 2.1 Em escopo
- `GET /health`, `GET /api/v1/health`
- `GET /api/v1/tribunais` (cache-friendly, leitura)
- `GET /api/v1/processos` (paginado, JOINs)
- `GET /api/v1/processos/:id` (com includes)
- `POST /api/v1/auth/login` (em ambiente isolado)
- `POST /api/v1/processos/:id/monitorar`
- WebSocket conectar / `subscribe` / `unsubscribe` / receber `notificacao`
- **Carga sintética**: enfileirar N jobs `agendarScrapingBatch` para validar throughput da fila Bull.

### 2.2 Fora de escopo
- Scraping real contra TJSP/TJMG/STJ/STF/TRT/TRF (atacar tribunais é ilegal).
- E-mails/SMS reais.
- Integração 2Captcha real.

---

## 3. Premissas e Pré-requisitos

1. **Ambiente isolado** (não compartilhe com produção).
2. Backend rodando em `http://localhost:3000` com:
   - **PostgreSQL** (não SQLite — SQLite serializa escrita e enviesa todos os números).
   - **Redis** real (sem fallback in-memory).
   - `NODE_ENV=production`, `JWT_SECRET` configurado.
3. Banco populado com dataset realista:
   - 100 advogados (`scripts/batchSeed.ts`).
   - 10.000 processos.
   - 100.000 movimentações.
   - 50 tribunais.
4. Workers Bull rodando (mesmo processo ou container separado).
5. Coletor de métricas (Prometheus + Grafana) ou pelo menos `pm2 monit` + `node --inspect` para heap.
6. **Cliente de carga** em máquina separada do SUT (System Under Test) ou ao menos em CPU/cores diferentes.

---

## 4. Ferramental

| Ferramenta | Uso | Versão sugerida |
|---|---|---|
| **k6** | Stress HTTP / REST | ≥ 0.50 |
| **Artillery** | WebSocket | ≥ 2.0 |
| **autocannon** | Smoke ultra-rápido | ≥ 7.0 |
| **clinic.js** | Profiling (flamegraph, doctor) | ≥ 13 |
| **Prometheus** + Grafana | Métricas | qualquer |
| **k6-html-reporter** | Saída HTML | qualquer |

Scripts presentes em `minha-api/tests/stress/`:

| Arquivo | Cenário |
|---|---|
| `k6-smoke.js`     | Smoke 60s, 5 VUs |
| `k6-load.js`      | Load 10 min, 50 RPS |
| `k6-stress.js`    | Stress até 1200 VUs |
| `k6-spike.js`     | Spike 10→500 VUs |
| `k6-soak.js`      | Soak 1 h, 30 VUs |
| `artillery-ws.yml`| WebSocket 200 sockets |
| `autocannon-smoke.js` | Smoke `/health` 30s |
| `README.md`       | Como rodar tudo |

---

## 5. Cenários de Teste

### 5.1 Smoke (gate de CI)
- **Carga:** 5 VUs por 60 s.
- **Critério:** `http_req_failed < 1%`, p95 health < 100 ms.
- **Falha → bloqueia merge.**

### 5.2 Load
- **Modelo:** `ramping-arrival-rate` 5→50 RPS, sustenta 8 min, ramp-down 30 s.
- **Critério (SLOs):**
  - `lat /processos` p95 < 400 ms, p99 < 900 ms.
  - `lat /tribunais` p95 < 150 ms.
  - `lat /processos/:id` p95 < 600 ms.
  - Erro < 2%.

### 5.3 Stress
- **Modelo:** rampa linear 10 → 1200 VUs em ~12 min.
- **Critério:** medir o **knee point** (joelho da curva latência×VUs).
- **Saída:** `reports/stress-summary.json` com p50/p95/p99/max + RPS.

### 5.4 Spike
- **Modelo:** 10 VUs por 1 min → **500 VUs em 30 s** → manter 2 min → cair para 10.
- **Critério:** após cair, **recovery em < 60 s** (p95 retorna ao baseline).

### 5.5 Soak
- **Modelo:** 30 VUs constantes por 1 h.
- **Critério:**
  - `rss` do processo node não cresce > 25% após 30 min estabilizado.
  - `event-loop lag` p99 < 50 ms.
  - `fd_count` estável.
  - Sem `EMFILE`, `ECONNRESET`.

### 5.6 WebSocket
- **Modelo:** 200 sockets concorrentes via Artillery, cada um `subscribe`/`unsubscribe` cíclicos.
- **Critério:** sem `disconnect: ping timeout` em mais de 1% das conexões; CPU node < 70%.

### 5.7 Job Queue (Bull)
- **Modelo:** script Node que injeta 1.000 jobs em `scrapeQueue` com payload mock e adapter mockado (não bater em tribunal real).
- **Critério:**
  - **Throughput** consistente com `limiter: { max: 10, duration: 1000 }` — esperado ~ **10 jobs/s** (bottleneck conhecido).
  - Backoff exponencial funcionando para jobs com falha.
  - `getQueueStats()` deve refletir corretamente.

### 5.8 Resiliência ao Redis
- **Modelo:** durante soak, derrubar Redis com `docker stop juridico-redis` por 2 min, restartar.
- **Critério:**
  - Cache cai para fallback in-memory **sem 5xx**.
  - Bull queue retoma após restart.
  - Logs mostram `Redis unavailable, using in-memory fallback`.

### 5.9 Race conditions de scraping
- **Modelo:** rodar 50 vezes em paralelo o mesmo `POST /api/v1/tribunais/TJSP/buscar` para o mesmo `numeroProcesso` (com adapter mock).
- **Critério:**
  - Apenas 1 registro `Processo` criado.
  - `Parte`s não duplicadas.
  - `Movimentacao`s não duplicadas.
  - Sem deadlock.
- **Status atual esperado: FALHA** — `salvarPartes` faz `destroy + bulkCreate` sem transação (achado **H-08**).

---

## 6. Métricas a Coletar

### 6.1 Cliente (k6)
- `http_reqs`, `http_req_duration` (p50/p95/p99/max)
- `http_req_failed{rate}`
- `vus`, `vus_max`
- `iteration_duration`
- Custom: `app_latency`, `app_error_rate`

### 6.2 Servidor
- **Node:** `process.cpu()`, `process.memoryUsage().rss/heapUsed`, `event-loop-lag` (`perf_hooks`).
- **Express:** `request_count`, `request_duration_ms` por rota (via `prom-client`).
- **Sequelize:** pool size, queries em fila, slow queries (> 200 ms).
- **Redis:** `connected_clients`, `used_memory`, `instantaneous_ops_per_sec`.
- **Bull:** `waiting`, `active`, `completed`, `failed`, `delayed`.
- **Socket.IO:** `connectedClients`, `room counts`.

### 6.3 Sistema
- CPU per-core %, load average.
- File descriptors abertos (`lsof | wc -l`).
- Network: TCP connections, retransmissões.

> Recomenda-se exportar tudo para Prometheus via `prom-client` no backend e `k6 + xk6-prometheus-rw` no cliente.

---

## 7. Baseline Esperado (Hipótese, antes da execução)

> Estimativas para o ambiente sugerido (4 vCPU, 8 GB RAM, PostgreSQL local, Redis local).

| Cenário | RPS sustentável | p95 esperado | Limite teórico |
|---|---|---|---|
| `GET /health` | 6.000–10.000 | < 20 ms | CPU bound após ~5k RPS |
| `GET /api/v1/tribunais` | 1.500–3.000 (com cache) | < 80 ms | DB cache miss → 300 RPS |
| `GET /api/v1/processos?limite=50` | 200–400 | 200–400 ms | JOIN + count, knee ~600 RPS |
| `GET /api/v1/processos/:id` (includes) | 100–250 | 300–700 ms | knee ~400 RPS |
| WebSocket sockets | 5.000+ idle | conexão < 200 ms | RAM-bound (~50 KB/socket) |
| Bull jobs (limited) | **10/s exato** | n/a | hard limit de design |

**Hipóteses de gargalo (à priori):**
1. **Bull limiter 10/s** será a barreira para scraping real.
2. **Sequelize `findAndCountAll` com `include`** será o knee REST.
3. **SQLite (se usado)** colapsa em ~100 RPS de escrita.
4. **In-memory rate limit + cluster** quebra em produção multi-worker.

---

## 8. Critérios de Aprovação

| Cenário | Aprovação |
|---|---|
| Smoke | ✅ se 100% requests OK, p95 saudável |
| Load | ✅ se SLOs cumpridos por **8 min sustentados** |
| Stress | ✅ se sistema falha **graceful** (5xx coordenado, sem trava) e capacidade conhecida |
| Spike | ✅ se p95 recupera < 60 s após queda |
| Soak | ✅ se sem leak (RSS estável) e zero erros sustentados |
| WebSocket | ✅ se < 1% disconnect anômalo |
| Queue | ⚠️ aceito limite de 10/s mas **sinalizar**: requer aumentar `limiter.max` |
| Resiliência Redis | ✅ se 0 erros 5xx visíveis durante a queda |
| Race conditions | ⚠️ provavelmente FALHA hoje — bloquear até H-08 corrigido |

---

## 9. Riscos do Próprio Teste

| Risco | Mitigação |
|---|---|
| Cliente de carga sub-dimensionado (CPU saturada gera dados ruins) | Rodar k6 em outra máquina; usar `--out cloud` se possível. |
| Bater em tribunais reais por engano | Mockar adapter no env de teste (`process.env.MOCK_ADAPTERS=1`). |
| Encher disco com logs do Winston | Forçar `LOG_LEVEL=warn` durante stress. |
| Travar IDE/dev local | Rodar SUT em Docker isolado. |
| Misturar dados de stress no banco real | Banco e Redis dedicados ao teste. |

---

## 10. Pré-execução: Bloqueios encontrados na auditoria

A execução **não** é segura no estado atual do repositório por:

1. **Build quebrado** (achado C-04): `tsc` falha → não há `dist/server.js` válido para o container; somente `start-api.cjs` carrega o JS já existente em `dist/` (versão antiga).
2. **Suite de testes não compila** (C-05): impossibilita usar Jest como gate.
3. **Frontend `tsc -b && vite build` falha** (H-11): impossibilita testar dashboard contra a API.
4. **Rotas referenciadas pelo dashboard inexistentes** (C-07): `dashboardService.getStats` chama `/jobs` (404) — qualquer teste que use o dashboard agregaria erro artificial.
5. **WebSocket não entrega eventos** (C-08): teste 5.6 só validará conexão, não fluxo end-to-end.
6. **Autenticação ausente** (C-01): qualquer endpoint testado mediante token é inócuo — todos respondem sem token. SLOs medidos podem ser otimistas (sem custo de `jwt.verify`).
7. **`MonitoringService` desligado** (C-06): teste de polling concomitante a stress não roda.

**Recomendação:** corrigir os 9 itens críticos listados na auditoria (Sprint 0 + Sprint 1), depois rodar a suite completa em staging.

---

## 11. Procedimento de Execução (passo a passo)

### 11.1 Preparar ambiente
```bash
# 1. Backend em Docker com Postgres+Redis reais
cd minha-api
cp .env.example .env
# editar .env: NODE_ENV=production, JWT_SECRET=<32 bytes random>
docker-compose up -d postgres redis
npm ci
npm run build              # após corrigir C-04
npm run migrate            # após substituir por migrations reais
npx ts-node scripts/seed.ts
npx ts-node scripts/batchSeed.ts
node start-api.cjs &       # ou npm start
```

### 11.2 Validar (`AGENTS.md` quality gates)
```bash
npm run lint               # após criar script
npm run typecheck          # após corrigir C-04 / H-11
npm test                   # após corrigir C-05
```

### 11.3 Smoke
```bash
k6 run --env BASE_URL=http://localhost:3000 tests/stress/k6-smoke.js
```

### 11.4 Load
```bash
k6 run --out json=reports/load.json --env BASE_URL=http://localhost:3000 tests/stress/k6-load.js
```

### 11.5 Stress
```bash
k6 run --out json=reports/stress.json --env BASE_URL=http://localhost:3000 tests/stress/k6-stress.js
```

### 11.6 Spike
```bash
k6 run --env BASE_URL=http://localhost:3000 tests/stress/k6-spike.js
```

### 11.7 Soak (1 hora)
```bash
k6 run --out json=reports/soak.json --env BASE_URL=http://localhost:3000 tests/stress/k6-soak.js &
# Em outro terminal, monitorar memória e fd:
while true; do
  ps -o pid,%cpu,%mem,rss,cmd -p $(pgrep -f node) | head -3
  lsof -p $(pgrep -f node) | wc -l
  sleep 30
done
```

### 11.8 WebSocket
```bash
artillery run --output reports/ws.json tests/stress/artillery-ws.yml
artillery report reports/ws.json
```

### 11.9 Coletar métricas e gerar relatório final
```bash
# k6 → HTML
npx k6-html-reporter --json=reports/load.json --output=reports/load.html
# Compare com SLOs e anote o knee point do stress
```

---

## 12. Relatório de Execução (template)

> Preencher após rodar a suite. Os campos abaixo são o template a entregar.

### 12.1 Identificação
- **Data/Hora:**
- **Branch / Commit:**
- **Ambiente:** _ex.: `staging-aws-eu-west-1, t3.large, RDS db.t3.medium, ElastiCache t3.micro`_
- **Versão da SUT:**

### 12.2 Resultados por cenário

| Cenário | RPS médio | p50 | p95 | p99 | max | Erros | Aprovação |
|---|---|---|---|---|---|---|---|
| Smoke | _ | _ | _ | _ | _ | _ | _ |
| Load | _ | _ | _ | _ | _ | _ | _ |
| Stress (knee) | _ | _ | _ | _ | _ | _ | _ |
| Spike | _ | _ | _ | _ | _ | _ | _ |
| Soak | _ | _ | _ | _ | _ | _ | _ |
| WebSocket | _ conn | _ | _ | _ | _ | _ | _ |
| Queue | _ jobs/s | n/a | n/a | n/a | n/a | _ | _ |
| Redis-down | _ | _ | _ | _ | _ | _ | _ |
| Race conditions | _ runs | _ | _ | _ | _ | _ duplicatas | _ |

### 12.3 Métricas de servidor

| Métrica | Baseline | Pico stress | Pico soak |
|---|---|---|---|
| CPU node (%) | _ | _ | _ |
| RSS (MB) | _ | _ | _ |
| Heap used (MB) | _ | _ | _ |
| Event loop lag p99 (ms) | _ | _ | _ |
| Postgres conns | _ | _ | _ |
| Redis ops/s | _ | _ | _ |
| Bull `waiting` | _ | _ | _ |
| Bull `failed` (cum.) | _ | _ | _ |
| File descriptors | _ | _ | _ |

### 12.4 Achados de execução
1. _Knee point_:
2. _Memory leak (sim/não)_:
3. _Recovery após spike (s)_:
4. _Comportamento queda Redis_:
5. _Outros_:

### 12.5 Aprovação geral
- [ ] APROVADO
- [ ] APROVADO COM RESSALVAS
- [ ] **REPROVADO**

### 12.6 Recomendações
_Listar tickets gerados com link para issue tracker._

---

## 13. Roadmap de Performance (após primeiro ciclo)

1. **Habilitar cache Redis** em `/processos`, `/processos/:id`, `/tribunais` (TTLs já desenhados, falta usar).
2. **Aumentar Bull `limiter.max`** ou implementar pool por adapter.
3. **`compression` middleware** + `etag` em respostas.
4. **HTTP keep-alive** em `axios` dos adapters (`new https.Agent({ keepAlive: true })`).
5. **Connection pool Postgres** dimensionado: `max = 2 × core × workers + 5`.
6. **Migrations versionadas** + `READ COMMITTED` explícito.
7. **`prom-client`** + `node-clinic` em pré-prod.
8. **Auto-scaling K8s** com HPA via `event-loop-lag` ou RPS.
9. **CDN** para assets do dashboard.
10. **Dashboard com server-side aggregation** (`/dashboard/stats` único) reduz 4 round-trips → 1.

---

## 14. Conclusão

O **plano e o ferramental** de teste de estresse estão prontos. Scripts em `minha-api/tests/stress/` cobrem **smoke / load / stress / spike / soak / WebSocket / queue / resiliência / race**. SLOs e critérios de aprovação foram definidos.

**A execução real está bloqueada** pelos 9 achados críticos do relatório de auditoria — em particular o **build quebrado** e a **autenticação ausente**, que invalidariam ou tornariam inseguros os números obtidos. Após o **Sprint 0 + Sprint 1** do plano de remediação, a suite pode ser executada em staging dedicado e os resultados preenchidos no template do §12.

---

> Companion: `docs/auditoria-relatorio-final.md`.
> Scripts: `minha-api/tests/stress/`.
