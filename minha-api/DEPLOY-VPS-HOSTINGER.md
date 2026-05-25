# Deploy na VPS Hostinger (produção online)

A **juridico-api** roda na VPS com Docker (API + PostgreSQL + Redis + worker). O **Jurix** (frontend) continua no Supabase/Vercel; só a API de scraping fica na VPS.

## Arquitetura

```
Jurix (Vercel/Supabase)  ──HTTPS──►  api.seudominio.com.br (VPS + Nginx)
                                         └── Docker: api, worker, postgres, redis
```

## 1. Preparar a VPS

No painel Hostinger ou via SSH:

```bash
# Ubuntu 22/24 — instalar Docker
sudo apt update && sudo apt install -y git curl
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
# sair e entrar de novo no SSH para o grupo docker valer
```

Abra no firewall da Hostinger (e `ufw`, se usar):

| Porta | Uso        |
|-------|------------|
| 22    | SSH        |
| 80    | HTTP       |
| 443   | HTTPS      |

**Não** abra 3000, 5432 nem 6379 na internet — a API fica atrás do Nginx em localhost.

## 2. Clonar e configurar

```bash
cd ~
git clone https://github.com/gustavopelicioniii-rgb/juridico-api.git
cd juridico-api/minha-api
cp .env.docker.example .env
nano .env
```

Exemplo de `.env` na VPS:

```env
NODE_ENV=production
PORT=3000

POSTGRES_PASSWORD=senha-forte-aqui

JWT_SECRET=gere-com-openssl-rand-hex-32
JWT_REFRESH_SECRET=outra-chave-diferente

# URL do app Jurix (Vercel ou domínio próprio), separadas por vírgula
CORS_ORIGIN=https://seu-jurix.vercel.app,https://jurix.com.br

DATAJUD_API_KEY=sua-chave-cnj
DATAJUD_MOCK=false

# Opcional
ENABLE_MONITORING=true
ENABLE_OAB_MONITORING=true
```

Gerar secrets:

```bash
openssl rand -hex 32
```

## 3. Subir os containers

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
curl -s http://127.0.0.1:3000/api/v1/health
```

Atualizar depois:

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

## 4. Nginx + HTTPS (domínio apontando para o IP da VPS)

Instale Nginx e Certbot:

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

Crie `/etc/nginx/sites-available/juridico-api`:

```nginx
server {
    listen 80;
    server_name api.seudominio.com.br;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}
```

Ative e obtenha SSL:

```bash
sudo ln -s /etc/nginx/sites-available/juridico-api /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d api.seudominio.com.br
```

Teste público:

```bash
curl https://api.seudominio.com.br/api/v1/health
```

## 5. Conectar o Jurix (Supabase)

No **Supabase Dashboard** → Project Settings → Edge Functions → Secrets:

| Secret | Valor |
|--------|--------|
| `JURIDICO_API_URL` | `https://api.seudominio.com.br` |
| `JURIDICO_BRIDGE_SECRET` | string longa e única (mesma lógica do bridge na API) |
| `DATAJUD_API_KEY` | (opcional no edge; a API na VPS já pode ter a chave) |

Redeploy da função (no PC ou na VPS com Supabase CLI):

```bash
npx supabase functions deploy crawl-processos-oab --project-ref SEU_PROJECT_REF
```

No frontend Jurix (Vercel), se usar dashboard próprio:

```env
VITE_API_BASE_URL=https://api.seudominio.com.br
```

## 6. Checklist rápido

- [ ] DNS `api.seudominio.com.br` → IP da VPS
- [ ] `docker compose -f docker-compose.prod.yml` rodando
- [ ] `curl https://api.../api/v1/health` retorna OK
- [ ] `JURIDICO_API_URL` no Supabase aponta para a VPS
- [ ] `CORS_ORIGIN` no `.env` inclui a URL do Jurix
- [ ] Importação por OAB no app retorna processos

## Recursos na VPS

Recomendado para esta stack: **mínimo 2 GB RAM** (ideal 4 GB). Monitoramento:

```bash
docker stats
df -h
```

## Só API na VPS, banco no Supabase?

É possível usar Postgres do Supabase com `DATABASE_URL` + `DATABASE_SSL=true`, mas hoje o projeto está otimizado para Postgres no mesmo `docker compose`. Para simplificar, use o compose completo na VPS.
