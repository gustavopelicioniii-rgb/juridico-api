# API de Monitoramento de Processos Jurídicos

API REST completa para monitoramento de processos judiciais brasileiros, desenvolvida para uso interno em sistemas de advocacia.

## ✅ Funcionalidades Implementadas

### Fases 1-6 Completas

| Fase | Módulo | Status |
|------|--------|--------|
| 1 | Estrutura base (Models, Routes, Server) | ✅ |
| 2 | Integração TJ-SP (Adapter Pattern) | ✅ |
| 3 | Sistema de Filas (Bull + Redis) | ✅ |
| 4 | Scraper TJ-MG (CAPTCHA + Puppeteer) | ✅ |
| 5 | WebSocket Notifications | ✅ |
| 6 | Polimento e Documentação | ✅ |

## 🏗️ Arquitetura

```
┌─────────────────────────────────────────────────────────────┐
│                      API REST (Express)                      │
├─────────────────────────────────────────────────────────────┤
│  Routes: /advogados, /processos, /tribunais, /monitoramentos │
├─────────────────────────────────────────────────────────────┤
│                    Services Layer                             │
│  ┌─────────────────┐  ┌──────────────────┐                │
│  │ TribunalService │  │ MonitoringService │                │
│  └─────────────────┘  └──────────────────┘                │
├─────────────────────────────────────────────────────────────┤
│                    Tribunal Adapters                          │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐                     │
│  │  TJ-SP  │  │  TJ-MG  │  │  STJ    │  ...                │
│  │(API REST)│  │(CAPTCHA)│  │(Scraper)│                    │
│  └─────────┘  └─────────┘  └─────────┘                     │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌──────────────────┐                │
│  │ Bull Queue      │  │ Socket.IO         │                │
│  │ (Redis)         │  │ (WebSocket)       │                │
│  └─────────────────┘  └──────────────────┘                │
├─────────────────────────────────────────────────────────────┤
│              PostgreSQL / SQLite (Sequelize)                 │
└─────────────────────────────────────────────────────────────┘
```

## 📁 Estrutura do Projeto

```
minha-api/
├── src/
│   ├── config/
│   │   ├── database.ts    # Sequelize (PostgreSQL/SQLite)
│   │   ├── redis.ts       # Redis client
│   │   └── logger.ts      # Winston logger
│   ├── models/            # 8 models Sequelize
│   │   ├── Advogado.ts
│   │   ├── Tribunal.ts
│   │   ├── Processo.ts
│   │   ├── Parte.ts
│   │   ├── Movimentacao.ts
│   │   ├── Job.ts
│   │   └── Monitoramento.ts
│   ├── tribunais/         # Adapter Pattern
│   │   ├── ITribunalAdapter.ts
│   │   ├── TJSPAdapter.ts
│   │   ├── TJMGAdapter.ts
│   │   └── index.ts
│   ├── services/
│   │   ├── TribunalService.ts
│   │   ├── MonitoringService.ts
│   │   └── index.ts
│   ├── queues/
│   │   ├── ScraperQueue.ts   # Bull queue
│   │   └── index.ts
│   ├── websocket/
│   │   ├── NotificationService.ts
│   │   └── index.ts
│   ├── routes/
│   │   └── index.ts         # 20+ endpoints
│   ├── app.ts
│   └── server.ts
├── scripts/
│   ├── migrate.ts
│   └── seed.ts
├── dist/                   # Build output
└── package.json
```

## 🚀 Como Executar

### Pré-requisitos
- Node.js 18+
- Redis (para filas)
- PostgreSQL (produção) ou SQLite (desenvolvimento)

### Instalação

```bash
cd minha-api
npm install
```

### Configuração

Crie o arquivo `.env`:

```env
# Database
DATABASE_URL=postgres://user:pass@localhost:5432/juridico
# ou para desenvolvimento:
USE_SQLITE=true

# Redis
REDIS_URL=redis://localhost:6379

# DataJud real (CNJ)
DATAJUD_API_KEY=sua_chave_datajud
DATAJUD_MOCK=false

# TJ-SP API (opcional)
TJSP_API_KEY=sua_chave_api

# 2Captcha (para TJ-MG)
TWOCAPTCHA_API_KEY=sua_chave_2captcha

# CORS
CORS_ORIGIN=http://localhost:3000
```

### Docker (recomendado)

```bash
cd minha-api
cp .env.docker.example .env
docker compose up -d --build
```

Detalhes em [DEPLOY-DOCKER.md](./DEPLOY-DOCKER.md). Para VPS online (Hostinger): [DEPLOY-VPS-HOSTINGER.md](./DEPLOY-VPS-HOSTINGER.md).

### Smoke autenticado DataJud/OAB

Com a API em execucao e `DATAJUD_API_KEY` configurada, valide a busca real por OAB usando a identidade de teste `361329` / `Sidney da Silva` sem versionar senha:

```bash
ADMIN_OAB=361329 ADMIN_NOME="Sidney da Silva" ADMIN_PASSWORD="<senha-secreta>" npm run seed
TEST_AUTH_PASSWORD="<senha-secreta>" npm run smoke:datajud:oab
```

Use `API_BASE_URL`, `TEST_AUTH_TRIBUNAL`, `SMOKE_EXPECT_MIN_PROCESSES=0` ou `SMOKE_REQUIRE_REAL_DATAJUD=false` para ajustar o escopo em ambientes controlados.

### Scripts

```bash
# Desenvolvimento
npm run dev

# Build
npm run build

# Migração do banco
npm run migrate

# Seed (tribunais iniciais)
npm run seed

# Produção
npm start
```

## 📡 Endpoints da API

### Advogados
| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET | `/api/v1/advogados` | Lista advogados |
| POST | `/api/v1/advogados` | Cria advogado |
| GET | `/api/v1/advogados/:id` | Busca advogado |
| PUT | `/api/v1/advogados/:id` | Atualiza advogado |
| DELETE | `/api/v1/advogados/:id` | Desativa advogado |

### Processos
| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET | `/api/v1/processos` | Lista processos |
| POST | `/api/v1/processos` | Cria processo |
| GET | `/api/v1/processos/:id` | Detalhes processo |
| PUT | `/api/v1/processos/:id` | Atualiza processo |
| GET | `/api/v1/processos/:id/movimentacoes` | Movimentações |
| POST | `/api/v1/processos/:id/monitorar` | Ativa monitoramento |
| DELETE | `/api/v1/processos/:id/monitorar` | Desativa monitoramento |

### Tribunais (Integração)
| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET | `/api/v1/tribunais` | Lista tribunais |
| POST | `/api/v1/tribunais/:codigo/buscar` | Busca processo |
| POST | `/api/v1/tribunais/:codigo/buscar-oab` | Busca por OAB |
| POST | `/api/v1/tribunais/:codigo/processos/:num/refresh` | Atualiza processo |
| GET | `/api/v1/tribunais/:codigo/status` | Status do adaptador |

## 🔌 WebSocket (Socket.IO)

Conecte-se ao servidor:
```javascript
const socket = io('http://localhost:3000', {
  query: { advogadoId: 'uuid-do-advogado' }
});

socket.on('notificacao', (data) => {
  console.log('Nova notificação:', data);
  
  if (data.tipo === 'NOVA_MOVIMENTACAO') {
    console.log(`${data.numeroProcesso}: ${data.dados.novaMovimentacoes} nova(s) movimentação(ões)`);
  }
});

// Inscrever em processo específico
socket.emit('subscribe', 'id-do-processo');
```

## 📊 Tipos de Notificação

```typescript
{
  tipo: 'NOVA_MOVIMENTACAO' | 'PROCESSO_ATUALIZADO' | 'SCRAPING_COMPLETO' | 'ERRO_SCRAPING',
  processoId: string,
  numeroProcesso: string,
  advogadoId: string,
  dados: {
    novaMovimentacoes?: number,
    mensagem?: string,
    erro?: string
  },
  timestamp: Date
}
```

## 🗄️ Banco de Dados

### Models Principais

- **Advogado**: OAB, nome, email
- **Tribunal**: código, nome, tipo, configuração de scraping
- **Processo**: número, classe, assunto, status
- **Parte**: nome, tipo (AUTOR/REU/ADVOGADO)
- **Movimentacao**: data, descrição, flag de "nova"
- **Monitoramento**: intervalo, último poll
- **Job**: fila de scraping, status, tentativas

## 🔒 Segurança

- Rate limiting (100 req/15min por IP)
- Helmet.js (headers de segurança)
- CORS configurável
- Validação de inputs
- Logs de auditoria

## 📈 Escalabilidade

- **Bull Queue**: Processamento assíncrono de scrapings
- **Redis**: Cache e filas
- **Pool de conexões**: Banco de dados
- **WebSocket**: Notificações em tempo real

## 🛠️ Próximos Passos

1. Adicionar mais tribunais (STJ, STF, TRT, TRF)
2. Implementar autenticação JWT
3. Dashboard administrativo
4. Métricas e monitoring (Prometheus/Grafana)
5. Deploy com Docker/Kubernetes

## 📝 Licença

ISC

## Tribunais com restrição de acesso

Quando uma busca por OAB responder com um destes status:

- `requires-auth`
- `captcha`
- `blocked`
- `source_unavailable`

isso significa que a fonte pública daquele tribunal não está liberada para coleta direta nesse fluxo.

### Ação por status

- `requires-auth`
  - usar login/certificado do advogado com consentimento;
  - ou integrar parceiro/fonte oficial.

- `captcha`
  - resolver o captcha manualmente ou em fluxo autorizado;
  - repetir a coleta com a sessão liberada.

- `blocked` / `source_unavailable`
  - tentar outro canal oficial;
  - usar consulta por número do processo;
  - ou tratar como cobertura parcial do tribunal.

### Exemplo prático

Se `TJMG` responder `requires-auth`, isso não significa erro da API.
Significa que a API detectou corretamente que a consulta pública daquele caminho exige autenticação adicional.
