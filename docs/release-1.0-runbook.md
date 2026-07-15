# Release 1.0 — Runbook de producción

Runbook para **RadioFlow Studio v1.0.0**: despliegue repetible, verificación, backup/restore, rollback y criterios de go-live.

Referencias: [README-prod.md](../README-prod.md) · [post-roadmap-v1.md](./post-roadmap-v1.md) · [validation-checklist.md](./validation-checklist.md)

---

## 1) Preflight (antes de desplegar)

### Variables obligatorias

| Variable | Requisito |
|----------|-----------|
| `JWT_SECRET` | ≥ 32 caracteres aleatorios |
| `POSTGRES_PASSWORD` | Fuerte, único por entorno |
| `CORS_ORIGIN` | Dominio real del panel (`https://…`) o `none` |
| `BOOTSTRAP_LOCAL_ADMIN` | **`0` en producción expuesta a Internet** |

### Variables recomendadas v1.0

| Variable | Uso |
|----------|-----|
| `REDIS_URL` | Rate-limit y pub/sub WS multi-réplica |
| `API_BACKGROUND_MODE` | `maintenance` (prod con workers externos) o `full` (todo-en-uno) |
| `AUDIO_FFMPEG_ENABLED=1` | Grabación stream, render playlist, BPM audio |
| `OLLAMA_BASE_URL` | Búsqueda semántica (opcional) |
| `OLLAMA_EMBEDDING_MODEL` | `nomic-embed-text` (768 dims, alinea con pgvector) |

### Imagen Postgres con pgvector (recomendado v1.0+)

Para catálogos grandes y búsqueda semántica indexada, usá imagen con extensión preinstalada:

```yaml
# docker-compose.prod.yml — sustituir servicio postgres
postgres:
  image: pgvector/pgvector:pg16
```

Migración: `20260701120000_pgvector_embedding` (aplica `CREATE EXTENSION vector` + columna `embedding`).

### Volúmenes

- `radioflow_pg` — PostgreSQL
- `radioflow_media` — bóveda (`MEDIA_ROOT`)
- `radioflow_redis` — Redis (opcional pero recomendado)

---

## 2) Deploy en staging (prod-like)

```bash
cp .env.example .env
# Editar: JWT_SECRET, POSTGRES_PASSWORD, CORS_ORIGIN, BOOTSTRAP_LOCAL_ADMIN=0

docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
```

### Verificación mínima

```bash
curl -fsS http://127.0.0.1:4000/api/health
curl -fsS http://127.0.0.1:4000/api/health/ready
```

### Post-migrate (misma DB que la API)

```bash
cd apps/api
npx prisma migrate status
# Debe: Database schema is up to date

# Verificación rápida (PostgreSQL)
psql "$DATABASE_URL" -c 'SELECT COUNT(*) FROM "_prisma_migrations";'
psql "$DATABASE_URL" -c 'SELECT COUNT(*) FROM "User";'
```

En CI: `node scripts/ci-verify-migrate.mjs`

Verificación prod-like local:

```bash
docker compose -f docker-compose.prod.yml up -d --build
npm run verify:prod-staging
```

> **Contraseña Postgres:** si cambiás `POSTGRES_PASSWORD` sobre un volumen ya inicializado, la API fallará con P1000. Opciones: restaurar la contraseña anterior, `ALTER USER` dentro del contenedor, o recrear volúmenes (`docker compose -f docker-compose.prod.yml down -v` — **borra datos**).

### Smoke + E2E

```bash
SMOKE_API_URL=http://127.0.0.1:4000 npm run smoke:api
CI=true npm run test:e2e
```

### Panel manual (solo CI / pruebas internas)

El compose prod expone solo la **API** (`:4000`). Para E2E o humo con UI web explícita:

```bash
docker compose -f docker-compose.prod.yml up -d
npm run dev:web-ci
```

Abrí **http://localhost:5173** con `VITE_ALLOW_WEB_PANEL=true` (el script `dev:web-ci` ya lo define). **No es el flujo para operadores:** los clientes usan el instalador `.exe`.

Asegurate que `.env` tenga `CORS_ORIGIN=http://localhost:5173`.

**Primer acceso:** `BOOTSTRAP_LOCAL_ADMIN=0` → registrá usuario en `/login` y promové a admin (runbook §3).

Ver también [staging-72h-soak.md](./staging-72h-soak.md) (`npm run soak:watch` para evidencia automática).

Flujo profundo (staging controlado):

```bash
SMOKE_API_URL=http://127.0.0.1:4000 SMOKE_PROMOTE_TO_EDITOR=1 npm run smoke:api
```

---

## 3) Primer administrador (sin bootstrap en prod)

**No uses** `BOOTSTRAP_LOCAL_ADMIN=1` en servidores públicos.

1. Registrá el primer usuario vía `POST /api/auth/register` (si está habilitado) o insertá vía SQL/Studio.
2. Promové a admin:

```sql
UPDATE "User" SET role = 'admin' WHERE email = 'ops@tu-emisora.com';
```

3. Gestioná usuarios en **`/usuarios`**; ops en **`/security`**.

---

## 4) Backup / restore verificado

Procedimiento firmado (manifiestos SHA-256 / HMAC): **[backup-restore.md](./backup-restore.md)**.

### Backup Postgres

```bash
mkdir -p backups
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U radioflow -d radioflow --format=custom > backups/radioflow-$(date +%Y%m%d).dump
```

O con manifiesto:

```bash
npm run drill:backup
```

### Restore

```bash
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_restore -U radioflow -d radioflow --clean --if-exists < backups/radioflow-YYYYMMDD.dump
```

### Desktop (SQLite)

```bash
npm run backup:desktop
# RESTORE=1 BACKUP_DIR=backups/desktop-… npm run restore:desktop
```

### Evidencia (obligatoria antes de go-live)

- [ ] Restore probado en entorno limpio ≤ 30 min
- [ ] Manifiesto `backup.manifest.json` verificado
- [ ] `GET /api/health/ready` → 200 tras restore (servidor)
- [ ] Login admin + cabina operativa

Automatizado (staging / CI desktop):

```bash
npm run drill:backup
npm run drill:backup-restore
npm run backup:desktop:selftest
```

---

## 5) Rollback

### Imagen / contenedor

- Volver al tag anterior (`radioflow-api:1.0.0` → `0.2.x`) en compose o registry.
- `docker compose -f docker-compose.prod.yml up -d api`

### Base de datos

Prisma **no** revierte migraciones de forma segura en caliente.

1. Restaurar dump pre-deploy.
2. Desplegar imagen API compatible con ese esquema.

---

## 6) Rotación de secretos

| Secreto | Efecto |
|---------|--------|
| `JWT_SECRET` | Invalida tokens; usuarios re-login |
| `POSTGRES_PASSWORD` | Actualizar `.env` + reiniciar API y Postgres según procedimiento del host |

---

## 7) Checklist go-live v1.0

### Infraestructura
- [ ] `health/ready` OK tras reinicio completo (postgres + redis + api)
- [ ] `BOOTSTRAP_LOCAL_ADMIN=0`
- [ ] `CORS_ORIGIN` = dominio real
- [ ] Postgres/Redis no expuestos públicamente
- [ ] Backup reciente + restore verificado

### Aplicación
- [ ] Smoke API OK
- [ ] E2E verde (auth, navegación, evento admin)
- [ ] Cabina + encoder + Icecast ≥ 72 h en staging (objetivo v1)
- [ ] Migraciones al día (`README-prod.md` §3)

### Producto
- [ ] Demo: login → playlist → cabina → stream → pedido moderado
- [ ] Desktop: instalador firmado o SmartScreen documentado
- [ ] Ollama (si aplica): modelos `llama3.2` + `nomic-embed-text` pulled

### Documentación
- [ ] `CHANGELOG.md` v1.0.0 publicado
- [ ] OpenAPI `/api/docs` accesible detrás de auth si aplica

---

## 8) Post-release (72 h)

- Revisar logs API y encoder
- Métricas `/api/ops` o Prometheus si está cableado
- Verificar cron M3U Liquidsoap solo si legacy está activo (`LIQUIDSOAP_M3U_POLL_MS` &gt; 0 o perfil `liquidsoap-cron`)
- Limpiar refresh tokens revocados (automático si `REFRESH_TOKEN_CLEANUP_INTERVAL_MIN` > 0)

---

## Referencias

- [Día-1 primera emisión](./day-1-runbook.md)
- [Backup/restore firmado](./backup-restore.md)
- [Release 0.1 (histórico)](./release-0.1-runbook.md)
- [Operaciones](./operations.md)
- [Docker edge](./docker-edge-stack.md)
