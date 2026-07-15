## Release 0.1 — Runbook de producción (Docker Compose “prod”)

### Objetivo

Dejar la versión 0.1 desplegada de forma repetible, con verificación de health, backups/restore probados y un plan de rollback.

---

## 1) Preflight (antes de desplegar)

- **Variables obligatorias**
  - `JWT_SECRET` (mín. 32 caracteres, aleatorio)
  - `POSTGRES_PASSWORD` (fuerte)
- **CORS**
  - Define `CORS_ORIGIN` al dominio real del panel (ej. `https://panel.tu-dominio.com`)
  - Si no vas a exponer el panel aún: usa `CORS_ORIGIN=none`
- **Volúmenes**
  - `radioflow_pg`: persistencia Postgres
  - `radioflow_media`: persistencia de uploads

---

## 2) Deploy en staging (prod-like)

En la VM/host:

```bash
cp .env.example .env
# editar .env: JWT_SECRET, POSTGRES_PASSWORD, CORS_ORIGIN (y opcionales)

docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
```

### Verificación mínima

```bash
curl -fsS http://127.0.0.1:4000/api/health
curl -fsS http://127.0.0.1:4000/api/health/ready
```

### Smoke tests contra staging

Desde una máquina con Node (o dentro del repo):

```bash
SMOKE_API_URL=http://<host>:4000 npm run smoke:api
```

Para el humo profundo (solo entornos controlados):

```bash
SMOKE_API_URL=http://<host>:4000 SMOKE_PROMOTE_TO_EDITOR=1 DATABASE_URL=<la misma de staging> npm run smoke:api
```

---

## 3) Backup/restore verificado (staging)

### Backup (desde el contenedor Postgres)

```bash
mkdir -p backups
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U radioflow -d radioflow --format=custom > backups/radioflow-staging.dump
```

### Restore (en un entorno limpio)

1) Levanta una DB “vacía” (otro host o un segundo compose).
2) Restaura:

```bash
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_restore -U radioflow -d radioflow --clean --if-exists < backups/radioflow-staging.dump
```

### Evidencia / verificación

```bash
curl -fsS http://127.0.0.1:4000/api/health/ready
docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U radioflow -d radioflow -c 'SELECT COUNT(*) AS users FROM "User";'
```

---

## 4) Primer admin (bootstrap)

Tras registrar el primer usuario, promuévelo:

- Opción A (Prisma Studio): `npm run db:studio -w @radioflow/api`
- Opción B (SQL):

```sql
UPDATE "User" SET role = 'admin' WHERE email = 'tu@correo';
```

---

## 5) Rollback (simple)

### Rollback de imagen

- Si publicas imágenes con tags (recomendado): vuelve al tag anterior en `docker-compose.prod.yml` (o en el registry) y reinicia.
- Si build local: conserva el `image` tag anterior (por ejemplo, `radioflow-api:0.1.0`) y vuelve a ese.

### Rollback de base de datos

Prisma migrations no se “desaplican” de forma automática con seguridad. Estrategia recomendada:

- Restaurar el **dump** de Postgres de antes del deploy.
- Volver a la imagen anterior de API.

---

## 6) Rotación de secretos

### `JWT_SECRET`

- Cambiarlo invalida tokens existentes (los usuarios deben re-login).
- Plan: anunciar ventana, rotar secreto, reiniciar API.

### `POSTGRES_PASSWORD`

- Depende de tu estrategia (más delicada); si lo rotas, actualiza `.env` y reinicia servicios.

---

## 7) Checklist final para “go live”

- [ ] `health/ready` OK tras reinicio de API
- [ ] Smoke OK contra staging
- [ ] Backup ejecutado y restore verificado
- [ ] Primer admin creado (y acceso a `/security`)
- [ ] `CORS_ORIGIN` definido al dominio real (o `none` si no hay panel público)
- [ ] Postgres/Redis sin exposición pública (compose prod)

