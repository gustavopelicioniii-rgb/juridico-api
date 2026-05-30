# Jurídico API - Sistema de Monitoramento de Processos

Sistema completo para monitoramento de processos judiciais brasileiros, com API REST protegida por JWT e dashboard administrativo em React.

## 📁 Estrutura do Projeto

```
juridico-api/
├── minha-api/          # Backend API (Node.js + Express + TypeScript)
├── dashboard/          # Frontend React + TypeScript + TailwindCSS
├── docs/               # Auditorias, integrações e relatórios
├── plans/              # Documentação e planos de arquitetura
└── README.md
```

## 🚀 Como Executar

### Pré-requisitos

- Node.js 18+
- npm ou yarn
- SQLite (dev) ou PostgreSQL (prod)

### Backend (API)

```bash
cd minha-api
cp .env.example .env
npm install
npm run dev
```

A API estará disponível em `http://localhost:3000`

### Frontend (Dashboard)

```bash
cd dashboard
npm install
npm run dev
```

O dashboard estará disponível em `http://localhost:5173`

### Docker (Opcional)

```bash
cd minha-api
docker-compose up -d
```

## 🔐 Autenticação

Todas as rotas da API (exceto `/api/v1/auth/*` e health checks) exigem **JWT Bearer token**.

- **Registro**: `POST /api/v1/auth/register` com `{ oab, nome, email, senha }`
- **Login**: `POST /api/v1/auth/login` com `{ oab, senha }`
- **Token**: Access token (1h) + Refresh token (7d)
- **Refresh**: `POST /api/v1/auth/refresh` com `{ refreshToken }`
- **Perfil**: `GET /api/v1/auth/me` (header `Authorization: Bearer <token>`)

### Usuário admin inicial (opcional)

Defina no `.env` do backend:

```env
ADMIN_OAB=SP123456
ADMIN_PASSWORD=sua-senha-segura
ADMIN_NOME=Administrador
ADMIN_EMAIL=admin@exemplo.com
```

Ou execute `npm run seed` após configurar as variáveis.

Em **produção**, `JWT_SECRET` e `JWT_REFRESH_SECRET` são **obrigatórios** — o servidor não inicia sem eles.

## 📊 Tribunais Suportados

Por padrão, o sistema usa a **API pública DataJud (CNJ)** para ~91 tribunais. Com `DATAJUD_USE_LEGACY=true`, ativa scrapers específicos:

| Código | Tribunal |
|--------|---------|
| TJSP | Tribunal de Justiça de São Paulo |
| TJMG | Tribunal de Justiça de Minas Gerais |
| TRT1–TRT24 | Tribunais Regionais do Trabalho |
| TRF1–TRF6 | Tribunais Regionais Federais |
| STJ | Superior Tribunal de Justiça |
| STF | Supremo Tribunal Federal |

### Smoke autenticado DataJud/OAB

Para validar a integracao real com DataJud por uma rota autenticada, rode a API com `DATAJUD_API_KEY` configurada e `DATAJUD_MOCK=false`. O usuario de teste recomendado e a identidade OAB `361329` / `Sidney da Silva`; a senha deve vir de variavel de ambiente ou secret manager, nunca do repositorio.

```bash
cd minha-api
ADMIN_OAB=361329 ADMIN_NOME="Sidney da Silva" ADMIN_PASSWORD="<senha-secreta>" npm run seed
TEST_AUTH_PASSWORD="<senha-secreta>" npm run smoke:datajud:oab
```

Variaveis uteis: `API_BASE_URL`, `TEST_AUTH_OAB`, `TEST_AUTH_NOME`, `TEST_AUTH_TRIBUNAL`, `SMOKE_EXPECT_MIN_PROCESSES` e `SMOKE_REQUIRE_REAL_DATAJUD`.

## 🔌 Endpoints Principais

> Requerem header `Authorization: Bearer <token>` exceto rotas de auth.

### Autenticação (públicas)
- `POST /api/v1/auth/login` - Login com OAB + senha
- `POST /api/v1/auth/register` - Cadastro de advogado
- `POST /api/v1/auth/refresh` - Renovar token
- `GET /api/v1/auth/me` - Dados do usuário atual

### Advogados
- `GET /api/v1/advogados` - Listar advogados
- `POST /api/v1/advogados` - Criar advogado
- `PUT /api/v1/advogados/:id` - Atualizar advogado
- `DELETE /api/v1/advogados/:id` - Desativar advogado
- `GET /api/v1/advogados/:id/processos` - Processos do advogado

### Processos
- `GET /api/v1/processos` - Listar processos
- `GET /api/v1/processos/:id` - Detalhes do processo
- `POST /api/v1/processos` - Criar processo
- `GET /api/v1/processos/:id/movimentacoes` - Movimentações
- `GET /api/v1/processos/:id/partes` - Partes do processo

### Tribunais
- `GET /api/v1/tribunais` - Listar tribunais disponíveis
- `POST /api/v1/tribunais/:codigo/buscar` - Buscar processo por número
- `POST /api/v1/tribunais/:codigo/buscar-oab` - Buscar processos por OAB
- `GET /api/v1/tribunais/:codigo/status` - Status do tribunal

### Monitoramento
- `GET /api/v1/monitoramentos` - Listar monitoramentos
- `POST /api/v1/processos/:id/monitorar` - Ativar monitoramento
- `DELETE /api/v1/processos/:id/monitorar` - Desativar monitoramento

### Jobs e Notificações
- `GET /api/v1/jobs` - Listar jobs em execução
- `GET /api/v1/notifications` - Listar notificações
- `GET /api/v1/dashboard/stats` - Estatísticas gerais

### Health e Métricas (públicas)
- `GET /health` - Liveness
- `GET /api/v1/health` - Readiness (DB, Redis, WebSocket)
- `GET /metrics` - Prometheus

## 🛠️ Tecnologias

### Backend
- Node.js + Express + TypeScript
- Sequelize ORM (SQLite / PostgreSQL)
- Redis (com fallback em memória)
- JWT + bcrypt
- Bull Queue (background jobs)
- Socket.IO (notificações em tempo real)
- DataJud CNJ + adaptadores legados por tribunal

### Frontend
- React 18 + Vite + TailwindCSS
- React Router + TanStack Query
- Axios (com refresh automático de token)
- Socket.io Client

## 🧪 Testes

```bash
cd minha-api
npm test              # Executar testes
npm run test:watch   # Modo watch
npm run test:coverage # Com coverage
npm run validate     # lint + typecheck + test
```

## 🔄 CI/CD

### GitHub Actions

| Job | Descrição | Gatilho |
|-----|-----------|---------|
| `lint-and-typecheck` | ESLint + TypeScript | Push/PR |
| `test` | Jest + Coverage | Push/PR |
| `build` | Build production | Push/PR |
| `security` | npm audit + Trivy | Push/PR |
| `docker` | Build + Push imagens | Push (main) |

### Validação Local

```bash
cd minha-api
npm run validate      # lint + typecheck + test
npm run validate:ci   # lint + typecheck
```

### Hooks (Husky)

1. **commitlint** - Valida formato da mensagem de commit
2. **lint-staged** - ESLint nos arquivos staged

## 🏗️ Estrutura do Backend

```
minha-api/
├── src/
│   ├── config/          # DB, Redis, Logger, tribunais
│   ├── middleware/      # Auth JWT, métricas
│   ├── models/          # Modelos Sequelize
│   ├── routes/          # Rotas da API
│   ├── services/        # Lógica de negócio
│   ├── tribunais/       # Adaptadores (DataJud + legados)
│   ├── queues/          # Filas Bull
│   └── websocket/       # Socket.IO
├── tests/unit/          # Testes unitários
└── scripts/             # migrate, seed, utilitários
```

## 📄 Licença

MIT License

## Tribunais com login, certificado ou captcha

Quando a API responder `status=requires-auth`, `captcha`, `blocked` ou `source_unavailable`, o comportamento esperado é:

- `requires-auth`
  - o portal oficial exige login, certificado digital ou convênio;
  - ação necessária:
    - usar credenciais do advogado/cliente com consentimento explícito;
    - ou integrar uma fonte oficial/parceiro que entregue esse tribunal.

- `captcha`
  - o portal público exige resolução manual ou sessão autorizada;
  - ação necessária:
    - abrir o portal oficial;
    - resolver o captcha manualmente ou por fluxo autorizado;
    - repetir a coleta.

- `blocked` / `source_unavailable`
  - a fonte pública bloqueou automação ou está indisponível;
  - ação necessária:
    - consultar outro portal oficial;
    - usar busca individual por número CNJ quando existir;
    - ou operar via integração formal/parceiro.

### O que precisa existir para puxar processos nesses casos

Você precisa de uma destas estratégias:

1. **credencial do advogado/cliente**
   - login/senha, certificado A1/A3 ou sessão autenticada.

2. **fonte oficial/parceiro**
   - convênio, MNI, integração oficial, DataJud quando cobrir o caso.

3. **fluxo operacional assistido**
   - um operador humano resolve captcha/login e libera a coleta.

### O que não fazer

- não depender de bypass frágil de captcha como estratégia principal;
- não usar credenciais de terceiros sem consentimento;
- não prometer cobertura total para tribunais que hoje retornam `requires-auth` sem operação definida.
