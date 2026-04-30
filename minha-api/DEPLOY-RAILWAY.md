# Deploy no Railway

## 1. Criar Projeto no Railway

1. Acesse https://railway.app
2. Faça login com GitHub
3. Clique em **"New Project"**
4. Selecione **"Deploy from GitHub repo"**
5. Escolha o repositório `juridico-api`

## 2. Configurar Root Directory

1. No projeto, clique em **Settings**
2. Em **Root Directory**, digite: `minha-api`
3. Clique em **Save**

## 3. Configurar Variables de Ambiente

No Railway, vá em **Variables** e adicione:

```env
NODE_ENV=production
PORT=3000

# Database (PostgreSQL)
# Use o PostgreSQL do Railway ou externo (Neon, Supabase, etc)
DATABASE_URL=postgresql://user:password@host:5432/database

# DataJud API Key (do CNJ)
DATAJUD_API_KEY=sua_chave_aqui

# Monitoring (ATIVADO para Railway!)
ENABLE_MONITORING=true
ENABLE_OAB_MONITORING=true
MONITORING_INTERVAL_MS=300000

# Ngrok (DESATIVADO em produção)
NGROK_ENABLED=false

# CORS (configure para seu domínio)
CORS_ORIGIN=https://seu-frontend.com
```

## 4. Adicionar PostgreSQL

1. No Railway, clique em **"+ New"**
2. Selecione **"Database"** → **"PostgreSQL"**
3. O Railway criará automaticamente `DATABASE_URL`

**Ou use PostgreSQL externo:**
- Neon: https://neon.tech
- Supabase: https://supabase.com
- Amazon RDS

## 5. Deploy

1. Railway detectará `package.json` automaticamente
2. Build command: `npm install && npm run build`
3. Start command: `npm run start`

Se precisar configurar manualmente:
- **Build Command:** `npm run build`
- **Start Command:** `npm run start`
- **Watch Command:** `npm run dev`

## 6. Verificar Deploy

1. Após deploy, clique em **"Deployments"**
2. Veja os logs em tempo real
3. Clique na URL gerada (ex: `juridico-api.railway.app`)

## 7. Testar a API

```bash
# Health check
curl https://juridico-api.railway.app/health

# Testar OAB
curl -X POST https://juridico-api.railway.app/api/v1/tribunais/TJSP/buscar-oab \
  -H "Content-Type: application/json" \
  -d '{"oab":"361329 SP"}'
```

## Troubleshooting

### Erro "Module not found"
- Verifique se o Root Directory está como `minha-api`

### Erro de conexão banco
- Verifique se `DATABASE_URL` está correto
- PostgreSQL local não funciona ( Railway é cloud)

### Timeout em queries
- Aumente `maxDuration` nas configurações

### Monitoramento não funciona
- Verifique se `ENABLE_OAB_MONITORING=true`
- Logs devem mostrar: `ProcessoMonitoramentoService iniciado`

## URLs dos Serviços

Após deploy, anote:
- **API URL:** `https://juridico-api.railway.app`
- **Banco PostgreSQL:** (via variável `DATABASE_URL`)
- **Logs:** Available em Railway Dashboard
