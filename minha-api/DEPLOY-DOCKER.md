# Deploy local com Docker

## Pré-requisitos

- Docker e Docker Compose
- Arquivo `.env` na pasta `minha-api/` (copie de `.env.docker.example`)

## Subir a stack

```bash
cd minha-api
cp .env.docker.example .env
# Edite .env: JWT_SECRET, DATAJUD_API_KEY, etc.
docker compose up -d --build
```

Serviços:

| Serviço   | Porta | Descrição        |
|-----------|-------|------------------|
| api       | 3000  | API REST         |
| postgres  | 5432  | Banco PostgreSQL |
| redis     | 6379  | Filas Bull       |
| worker    | —     | Processamento de filas |

## Verificar

```bash
curl http://localhost:3000/api/v1/health
```

## Integração com Jurix (Supabase Edge)

**Desenvolvimento local** — Supabase → Edge Functions → Secrets:

```env
JURIDICO_API_URL=http://host.docker.internal:3000
```

**Produção (VPS Hostinger, etc.)** — use a URL pública com HTTPS:

```env
JURIDICO_API_URL=https://api.seudominio.com.br
```

Guia completo para VPS: [DEPLOY-VPS-HOSTINGER.md](./DEPLOY-VPS-HOSTINGER.md).

## Parar

```bash
docker compose down
```

Para remover volumes: `docker compose down -v`
