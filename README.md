# Jurídico API - Sistema de Monitoramento de Processos

Sistema completo para monitoramento de processos judiciais brasileiros, com API REST e dashboard administrativo em React.

## 📁 Estrutura do Projeto

```
juridico-api/
├── minha-api/          # Backend API (Node.js + Express + TypeScript)
├── dashboard/         # Frontend React + TypeScript + TailwindCSS
├── plans/             # Documentação e planos de arquitetura
└── README.md
```

## 🚀 Como Executar

### Pré-requisitos

- Node.js 18+
- npm ou yarn
- SQLite (já incluso, arquivo local)

### Backend (API)

```bash
cd minha-api
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

O sistema utiliza autenticação JWT com OAB (Ordem dos Advogados do Brasil).

- **Login**: `POST /api/v1/auth/login` com `{ oab: "123456" }`
- **Token**: Access token (1h) + Refresh token (7d)

## 📊 Tribunais Suportados

| Código | Tribunal |
|--------|---------|
| tjsp | Tribunal de Justiça de São Paulo |
| tjmg | Tribunal de Justiça de Minas Gerais |
| trt1 | Tribunal Regional do Trabalho - 1ª Região |
| trt2 | Tribunal Regional do Trabalho - 2ª Região |
| trf1 | Tribunal Regional Federal - 1ª Região |
| trf3 | Tribunal Regional Federal - 3ª Região |
| stj | Superior Tribunal de Justiça |
| stf | Supremo Tribunal Federal |

## 🔌 Endpoints Principais

### Autenticação
- `POST /api/v1/auth/login` - Login com OAB
- `POST /api/v1/auth/refresh` - Renovar token
- `GET /api/v1/auth/me` - Dados do usuário atual

### Advogados
- `GET /api/v1/advogados` - Listar advogados
- `POST /api/v1/advogados` - Criar advogado
- `PUT /api/v1/advogados/:id` - Atualizar advogado
- `DELETE /api/v1/advogados/:id` - Deletar advogado
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

### Jobs
- `GET /api/v1/jobs` - Listar jobs em execução
- `GET /api/v1/jobs/:id` - Detalhes do job
- `POST /api/v1/jobs/:id/retry` - Repetir job falho

### Dashboard
- `GET /api/v1/dashboard/stats` - Estatísticas gerais

## 🛠️ Tecnologias

### Backend
- Node.js + Express
- TypeScript
- Sequelize ORM
- SQLite
- Redis (com fallback em memória)
- JWT (jsonwebtoken)
- Bull Queue (background jobs)
- WebSocket (notificações em tempo real)

### Frontend
- React 18
- TypeScript
- Vite
- TailwindCSS
- React Router
- Axios
- Socket.io Client

## 📝 API Documentation

Após iniciar a API, acesse:
- Swagger UI: `http://localhost:3000/api/docs`

## 🧪 Testes

```bash
cd minha-api
npm test
```

## 📄 Licença

MIT License
