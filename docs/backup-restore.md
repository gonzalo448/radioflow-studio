# Backup / restore firmado (A6)

Procedimiento **verificable** (SHA-256 + HMAC opcional) para:

| Entorno | Datos | Script |
|---------|--------|--------|
| **Servidor** (Postgres) | `pg_dump` custom + manifiesto | `npm run drill:backup` / `drill:backup-restore` |
| **Desktop** (SQLite) | `radioflow.db` (+ jwt, media opcional) | `npm run backup:desktop` / `restore:desktop` |

Referencias: [operations.md](./operations.md) · [release-1.0-runbook.md](./release-1.0-runbook.md) · [media-vault.md](./media-vault.md)

---

## Qué significa “firmado”

1. Cada backup escribe `backup.manifest.json` + `SHA256SUMS` con hash de cada archivo.
2. Si definís `BACKUP_HMAC_SECRET` (o `JWT_SECRET`), el manifiesto incluye **HMAC-SHA256** del listado canónico path→hash.
3. Antes de restaurar, el script **verifica** hashes (y firma si `REQUIRE_BACKUP_SIGNATURE=1`).

No sustituye cifrado en reposo ni offsite; es **integridad** para no restaurar un dump corrupto o alterado.

---

## A) Servidor — PostgreSQL

### Requisitos

- `docker-compose.prod.yml` (o `COMPOSE_FILE=…`) con servicio `postgres` arriba.
- API alcanzable en restore (`SMOKE_API_URL`, default `http://127.0.0.1:4000`) para `health/ready`.

### Backup

```bash
# Opcional: firma HMAC
set BACKUP_HMAC_SECRET=un-secreto-largo-de-ops

npm run drill:backup
# → backups/postgres-<stamp>/radioflow.dump
# → backups/postgres-<stamp>/backup.manifest.json
# → backups/radioflow-drill-<stamp>.dump (+ .sha256, compat)
```

### Verificar sin restaurar

```bash
set VERIFY=1
set BACKUP_DIR=backups/postgres-2026-07-15T10-00-00
node scripts/prod-backup-restore-drill.mjs
```

### Restore (staging / drill)

```bash
set RESTORE=1
set BACKUP_DIR=backups/postgres-2026-07-15T10-00-00
npm run drill:backup-restore
```

Criterios de OK:

- [ ] `verify` del manifiesto OK
- [ ] `GET /api/health/ready` → ready
- [ ] Conteo `"User"` igual antes/después del drill
- [ ] Login + cabina operativa (manual)

**RTO objetivo:** restore DB ≤ 30 min (V1-02).

---

## B) Desktop — SQLite (producto instalable)

Datos por defecto: `%APPDATA%\radioflow-studio` (`radioflow.db`, `jwt-secret.txt`, `media/`).

### Backup

```bash
# App puede estar abierta; preferible tener sqlite3 en PATH (copia consistente).
npm run backup:desktop

# Incluir bóveda de audio (pesado):
set INCLUDE_MEDIA=1
npm run backup:desktop

# Otra carpeta de datos:
set DESKTOP_USER_DATA=D:\emisoras\estudio-1
npm run backup:desktop
```

Salida: `backups/desktop-<stamp>/` con DB, jwt (si existe), `media/` opcional, manifiesto.

### Verificar

```bash
set VERIFY=1
set BACKUP_DIR=backups/desktop-2026-07-15T10-00-00
npm run backup:desktop:verify
```

### Restore

1. **Cerrá** RadioFlow Studio por completo.
2. Ejecutá:

```bash
set RESTORE=1
set BACKUP_DIR=backups/desktop-2026-07-15T10-00-00
npm run restore:desktop
```

3. Abrí la app y comprobá login + biblioteca.

Si el backup no incluía `media/`, las pistas en BD pueden apuntar a archivos ausentes: reimportá o restaurá un backup con `INCLUDE_MEDIA=1`.

### Autotest (CI / sin app)

```bash
npm run backup:desktop:selftest
```

Crea un `userData` temporal, backup, restore, detecta corrupción de hash. No toca tu `%APPDATA%`.

---

## Checklist de firma operativa (go-live)

### Postgres

- [ ] Al menos un drill `drill:backup` + `drill:backup-restore` en staging
- [ ] Manifiesto verificado
- [ ] Copia offsite del directorio `backups/postgres-*` (fuera del mismo disco)

### Desktop (cada PC de emisora)

- [ ] Operador sabe `backup:desktop` (y `INCLUDE_MEDIA=1` si hace falta)
- [ ] Probó restore en carpeta de prueba o PC de spare
- [ ] Guarda `BACKUP_HMAC_SECRET` aparte del backup si usan firma

---

## Rotación

- Mantener N backups recientes (p. ej. 7–14 días) según espacio.
- `backups/` está en `.gitignore` — no subas dumps al repo.
