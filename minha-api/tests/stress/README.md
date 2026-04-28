# Testes de Estresse — Jurídico API

Suite de testes de carga / estresse / soak para a API REST e o canal WebSocket.

## Ferramentas

- **[k6](https://k6.io/)** — testes HTTP/REST. Instalar:
  - Windows: `winget install k6 --source winget` ou `choco install k6`.
  - macOS: `brew install k6`.
  - Linux: ver https://grafana.com/docs/k6/latest/set-up/install-k6/.
- **[Artillery](https://www.artillery.io/)** — alternativa scriptada com suporte WebSocket: `npm install -g artillery@latest`.
- **[autocannon](https://github.com/mcollina/autocannon)** — smoke test rápido: `npm install -g autocannon`.

## Cenários

| Arquivo | Tipo | Objetivo |
|---|---|---|
| `k6-smoke.js`     | Smoke (~1 min) | Verificar que API responde sob carga mínima. |
| `k6-load.js`      | Load (~10 min) | Carga sustentada ~50 RPS, validar SLOs. |
| `k6-stress.js`    | Stress (~15 min) | Subir até falha; identificar capacidade. |
| `k6-spike.js`     | Spike (~5 min) | Pico súbito (10→500 VUs). |
| `k6-soak.js`      | Soak (~1 h) | Memória/leak/connection pool. |
| `artillery-ws.yml`| WebSocket | 200 conexões simultâneas + eventos. |

## Pré-requisitos

1. Backend rodando localmente em `http://localhost:3000` (ou `BASE_URL`).
2. Seed com `npm run seed` e (opcional) `npx ts-node scripts/batchSeed.ts` para popular.
3. Redis rodando (ou aceitar fallback in-memory — pior caso, gargalo será maior).

## Como executar

```bash
# Smoke (rápido, faz parte do pipeline CI)
k6 run --env BASE_URL=http://localhost:3000 tests/stress/k6-smoke.js

# Load (tirar SLO p95 < 250ms)
k6 run --env BASE_URL=http://localhost:3000 tests/stress/k6-load.js

# Stress (achar ponto de quebra)
k6 run --env BASE_URL=http://localhost:3000 tests/stress/k6-stress.js

# Spike (validar resiliência)
k6 run --env BASE_URL=http://localhost:3000 tests/stress/k6-spike.js

# Soak (1h, descobre memory leaks)
k6 run --env BASE_URL=http://localhost:3000 tests/stress/k6-soak.js

# WebSocket
artillery run tests/stress/artillery-ws.yml

# Smoke ultra-rápido (autocannon)
autocannon -c 50 -d 30 http://localhost:3000/health
```

## Métricas alvo (SLOs)

| Endpoint | p95 alvo | p99 alvo | Erro alvo |
|---|---|---|---|
| `GET /health` | < 50 ms | < 100 ms | < 0.1% |
| `GET /api/v1/tribunais` | < 150 ms | < 350 ms | < 0.5% |
| `GET /api/v1/processos?pagina=1&limite=50` | < 400 ms | < 900 ms | < 1% |
| `GET /api/v1/processos/:id` (com includes) | < 600 ms | < 1500 ms | < 1% |
| `POST /api/v1/auth/login` | < 250 ms | < 600 ms | < 0.5% |

> Se rodando contra SQLite, espere p95 ~2× pior por causa do lock global de escrita.

## Saída

Os scripts geram CSV/JSON em `./reports/stress/`. Use `k6-html-reporter` ou Grafana Cloud para visualizar.
