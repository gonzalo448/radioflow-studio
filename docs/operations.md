## Operación: Backups, restore y deploy

> Primera emisión en una PC de emisora (instalar → biblioteca → Icecast): [day-1-runbook.md](./day-1-runbook.md).
>
> **Backup/restore firmado (A6)** — Postgres + desktop SQLite, manifiestos SHA-256/HMAC: [backup-restore.md](./backup-restore.md).
>
> Checklist de salida a producción (staging, smoke, backup/restore y rollback): [release-1.0-runbook.md](./release-1.0-runbook.md)
> (histórico: `release-0.1-runbook.md`).

### Backups de PostgreSQL (dump lógico)

Ver también el procedimiento firmado en [backup-restore.md](./backup-restore.md) (§ A).

- **Backup**

```bash
# Ajusta variables según tu entorno
export PGHOST=127.0.0.1
export PGPORT=5432
export PGUSER=radioflow
export PGPASSWORD=radioflow_dev
export PGDATABASE=radioflow

mkdir -p backups
pg_dump --format=custom --file "backups/radioflow-$(date +%Y%m%d-%H%M%S).dump"
```

- **Restore**

```bash
# 1) (Opcional) recrea DB vacía
dropdb --if-exists radioflow
createdb radioflow

# 2) restaura
pg_restore --dbname radioflow --clean --if-exists "backups/radioflow-YYYYMMDD-HHMMSS.dump"
```

- **Verificación**

```bash
# Comprueba integridad básica
psql -d radioflow -c 'SELECT COUNT(*) AS users FROM "User";'
psql -d radioflow -c 'SELECT COUNT(*) AS refresh_tokens FROM "RefreshToken";'

# La API debería pasar readiness si apunta a esta DB
curl -fsS http://127.0.0.1:4000/api/health/ready
```

### Drill backup/restore (V1-02 / A6)

Manifiesto + restore verificado:

```bash
npm run drill:backup          # backups/postgres-*/ + SHA256SUMS
npm run drill:backup-restore  # verify manifiesto + pg_restore + health/ready
```

Desktop (SQLite):

```bash
npm run backup:desktop
npm run backup:desktop:selftest   # CI / sin tocar %APPDATA%
```

Detalle: [backup-restore.md](./backup-restore.md).

**Última ejecución documentada (Postgres drill):** 2026-06-29 (staging local, `docker-compose.prod.yml`).

### Backups con Docker Compose (volumen de Postgres)

Si usas el volumen `radioflow_pg` del `docker-compose.yml`, lo más robusto es **dump lógico** (arriba). Como alternativa, puedes exportar un dump dentro de un contenedor:

```bash
docker compose exec -T postgres pg_dump -U radioflow -d radioflow --format=custom > backups/radioflow.dump
```

### Deploy “prod” con Docker Compose (una VM)

#### 1) Variables recomendadas

- `JWT_SECRET`: **obligatorio**, mínimo 32+ caracteres.
- `DATABASE_URL`: en Compose ya está cableado hacia el servicio `postgres`.
- `CORS_ORIGIN`: **define el dominio real** del panel (ej. `https://panel.tu-dominio.com`). Para desactivar CORS: `none`.
- `REDIS_URL`: si quieres métricas/rate-limit compartido multi-réplica.
- `MEDIA_ROOT`: dentro del contenedor se monta en `/app/media` (ver volumen).

#### 2) Run

```bash
# En la raíz
cp .env.example .env
# edita .env y define JWT_SECRET fuerte

docker compose -f docker-compose.prod.yml up -d --build
docker compose ps
```

#### 3) Healthchecks y apagado

- La API expone `GET /api/health/ready` para orquestación.
- En Compose ya hay healthcheck para Postgres y para API.
- Para apagado limpio (SIGTERM/SIGINT):

```bash
docker compose -f docker-compose.prod.yml down
```

#### 4) Volúmenes

- `radioflow_pg`: datos de Postgres
- `radioflow_media`: biblioteca subida (archivos)
- `radioflow_redis`: opcional (rate-limit/métricas globales)

### Notas de seguridad mínimas

- No publiques Postgres/Redis a Internet (en Compose están publicados para dev; en prod elimina `ports:` o usa firewall).
- Rota `JWT_SECRET` solo planificando re-login (tokens existentes quedarán inválidos).

### Compose “prod” endurecido

El archivo `docker-compose.prod.yml` está pensado para entornos reales:

- **Postgres y Redis sin `ports:`** (solo red interna).
- La única superficie publicada es la **API** (y `icecast` si activas el profile `broadcast`).
- Requiere `POSTGRES_PASSWORD` y `JWT_SECRET` en `.env`.
