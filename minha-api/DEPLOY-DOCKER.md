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

No Supabase → Edge Functions → Secrets:

```env
JURIDICO_API_URL=http://host.docker.internal:3000
```

No Windows/Mac com Docker Desktop, `host.docker.internal` expõe a API do host para as Edge Functions locais. Em produção no Supabase cloud, use um túnel (ngrok, Cloudflare Tunnel) ou a URL pública do seu servidor.

## Parar

```bash
docker compose down
```

Para remover volumes: `docker compose down -v`
