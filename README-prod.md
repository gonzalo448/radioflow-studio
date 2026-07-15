# RadioFlow Studio — pasos finales de producción

Guía de cierre alineada al **monorepo real** (`apps/web`, `apps/api`, Prisma, `docker-compose.prod.yml`). Ajustá dominios, puertos y secretos a tu entorno.

---

## 1. Construcción del frontend

```bash
npm install
npm run build -w @radioflow/web
```

- Salida: **`apps/web/dist/`** (no existe `build/` en la raíz ni `./frontend/build`).
- **Nginx (Docker)**: montá esa carpeta como en `docker-compose.edge*.yml` (`RADIOFLOW_WEB_DIST` apunta por defecto a `./apps/web/dist`).
- **HTTPS**: plantilla `docker/nginx/templates/radioflow-https.conf`, overlay `docker-compose.edge.tls.yml`, certificados en `docker/nginx/tls/`. Detalle en [docs/docker-edge-stack.md](docs/docker-edge-stack.md).
- El build puede ir **sin** `VITE_API_ORIGIN` si el panel y `/api` comparten el mismo origen detrás de Nginx.

---

## 2. Backend en producción

1. Copiá y completá variables (ver `docker-compose.prod.yml` y [docs/operations.md](docs/operations.md)):

   - `POSTGRES_PASSWORD`, `JWT_SECRET` (mín. 32 caracteres), `CORS_ORIGIN` (origen público del panel, p. ej. `https://studio.tudominio.com`).
   - `DATABASE_URL` la arma Compose a partir del usuario `radioflow` y la contraseña.

2. Levantá servicios (el fichero del repo es **`docker-compose.prod.yml`** con **`.yml`**, no `.yaml`):

   ```bash
   docker compose -f docker-compose.prod.yml up -d
   ```

   Con borde Nginx opcional:

   ```bash
   docker compose -f docker-compose.prod.yml -f docker-compose.edge.prod.yml --profile edge up -d
   ```

3. **Probar API** (rutas reales del prefijo `/api`):

   - Login: `POST /api/auth/login` (cuerpo JSON `email`, `password`), no `/api/login`.
   - Eventos: `GET /api/eventos` (sesión), `POST /api/eventos` (admin).
   - Sesiones (refresh): `GET /api/sesiones` (admin).

   Desde el navegador, con el panel detrás del mismo host, el frontend debe usar rutas relativas `/api/...`.

---

## 3. Base de datos

### 3.1 Migraciones (obligatorio en cada deploy)

El esquema vive en `apps/api/prisma/schema.prisma`. **Cada** despliegue con cambios de código debe aplicar migraciones **antes** de servir tráfico (o confiar en el arranque automático del contenedor).

| Entorno | Comando |
|---------|---------|
| Docker Compose (`api`) | `prisma migrate deploy` al iniciar el contenedor (ver `docker-compose.prod.yml`) |
| Host / CI manual | `cd apps/api && npx prisma migrate deploy` |
| Kubernetes | Job `k8s/prod-managed/migrate-job.yaml` |
| Desktop standalone (SQLite) | Migración automática al arrancar la API embebida (`prisma/standalone/`) |

**Verificar estado** (misma `DATABASE_URL` que usa la API):

```bash
cd apps/api
npx prisma migrate status
```

Debe mostrar *Database schema is up to date*. Si hay migraciones pendientes, ejecutá `npx prisma migrate deploy` y reiniciá la API.

**Checklist pre-producción**

1. Backup de PostgreSQL (`pg_dump`) — ver [docs/operations.md](docs/operations.md).
2. `git pull` / imagen nueva desplegada.
3. `npx prisma migrate deploy` (o esperar arranque del contenedor `api`).
4. `npx prisma migrate status` → sin pendientes.
5. `curl -fsS https://tu-dominio/api/health/ready` → `200`.
6. Smoke: login, biblioteca, programador (`/scheduler`).

**Si la API falla con P2022** (columna o tabla inexistente): la base no tiene las migraciones del commit actual. Ejecutá `migrate deploy` contra la misma `DATABASE_URL` y reiniciá. Detalle en [docs/validation-checklist.md](docs/validation-checklist.md).

### 3.2 Catálogo de migraciones (PostgreSQL)

Todas bajo `apps/api/prisma/migrations/`. Orden cronológico (aplicar en bloque con `migrate deploy`, no a mano):

| Migración | Ámbito |
|-----------|--------|
| `20260207000000_init` … `20260209100000_settings_active_stream` | Esquema base, estación, playlog, branding |
| `20260508165043_auth_refresh_tokens` | Refresh tokens y sesiones |
| `20260508183925_mediaasset_genre` | Género en biblioteca |
| `20260508190208_scheduler_events` | Programador de eventos + `SchedulerRun` |
| `20260508195218_media_asset_cover_path` | Portadas |
| `20260510120000_programacion` | Parrilla programación |
| `20260510180000_library_process_job` | Jobs de procesamiento biblioteca |
| `20260510190000_station_cab_engine` | Motor cabina |
| `20260510210000_role_operador` | Rol operador |
| `20260511140000_refresh_token_client_ip` | IP en refresh |
| `20260513120000_eventos` | Eventos admin |
| `20260514203000_playback_queue_entry` | Cola de reproducción |
| `20260515120000_song_requests` | Pedidos de temas |
| `20260515140000_jingle_slots` | Cart wall jingles |
| `20260515200000_media_asset_id3_tech` | Metadatos ID3 técnicos |
| `20260516225841_playback_queue_unique_sortindex` | Índice único cola |
| `20260626120000_scheduler_generate_playlist` | Scheduler: generar playlist |
| `20260626140000_ad_scheduler` | Publicidad programada |
| `20260626141000_scheduler_ad_break` | Bloque publicitario scheduler |
| `20260626150000_playlist_commands` | Comandos playlist |
| `20260626160000_voicetrack` | Voicetrack |
| `20260626170000_track_list` | Listas de pistas |
| `20260626180000_p3_jingle_dtmf_multi_stream` | DTMF / multi-stream |
| `20260626200000_hour_marker_rds` | Marcador hora RDS |
| `20260626210000_listener_samples` | Muestras oyentes |
| `20260627000000_rotation_dtmf_requests` | Rotación / pedidos |
| `20260627120000_auto_intro_settings` | Carpeta auto-intro (settings) |
| `20260628120000_library_custom_stream_record` | Campos personalizados ×5 + grabación stream |
| `20260629120000_intro_match_key` | Auto-intro por tag ID3 (`introMatchKey`) |
| `20260701120000_pgvector_embedding` | pgvector + columna `embedding` (768) |

Tras añadir migraciones nuevas en desarrollo: `npm run db:migrate -w @radioflow/api` (crea SQL) y commitear la carpeta generada.

### 3.3 Backup e integridad

- **Backup**: procedimiento `pg_dump` en [docs/operations.md](docs/operations.md). Programá cron en el host o en tu orquestador.
- **Integridad**: consultas de verificación sugeridas en la misma guía (`User`, `RefreshToken`, etc.).

---

## 4. Streaming

**Path por defecto:** **encoder** (`apps/encoder`) → **Icecast** (mount típico `/stream`). En desktop, el encoder lo arranca la app; en Docker usá el perfil `broadcast` (`npm run docker:broadcast` / `docker:broadcast:encoder`).

- **Liquidsoap (legacy / opt-in):** solo si necesitás un stack externo con M3U. Perfiles Compose `liquidsoap` + `liquidsoap-cron`. La API **no** regenera M3U en background por defecto (`LIQUIDSOAP_M3U_POLL_MS=0`). Ver [docker/liquidsoap/README.md](docker/liquidsoap/README.md).
- **Icecast**: el mount típico del encoder es **`/stream`** (HTTP directo al puerto Icecast, p. ej. `http://host:8000/stream`). Si publicás el stream bajo **HTTPS** en el mismo dominio que el panel, usá el `location /stream` de la plantilla Nginx (proxy a `icecast:8000`).
- **Prueba**: VLC u otro reproductor con la URL pública del mount.

---

## 5. Seguridad

- **TLS**: Certbot en Nginx del host → [scripts/certbot-letsencrypt-host-nginx.sh](scripts/certbot-letsencrypt-host-nginx.sh); en Docker → `certonly` + PEM en `docker/nginx/tls/` ([docs/docker-edge-stack.md](docs/docker-edge-stack.md)).
- **Redirección HTTP → HTTPS**: incluida en `docker/nginx/templates/radioflow-https.conf`.
- **JWT + refresh**: rotación y revocación vía API; panel admin **Sesiones** para revocar.
- **Roles**: `admin`, `editor`, `dj`, etc.; probá rutas `/admin/*` y restricciones en biblioteca/eventos.

---

## 6. QA final (flujo sugerido)

| # | Acción | Criterio de éxito |
|---|--------|-------------------|
| 1 | Login en el panel | Token y refresh guardados; redirección a inicio o consola admin. |
| 2 | Admin: crear evento | Evento visible en API y en UI. |
| 3 | Encoder + Icecast | Oyente escucha el mount `/stream` (path por defecto). |
| 4 | Revocar sesión (admin) | El cliente pierde acceso tras expirar/rotar refresh o al forzar revocación. |
| 5 | Playlist / Cabina | Lista al aire; cola avanza; encoder refleja `playSegment`. |

---

## 7. Documentación

| Entrega | Estado en el repo |
|---------|-------------------|
| Despliegue producción | Este archivo + [README.md](README.md) + [docs/operations.md](docs/operations.md) + [docs/docker-edge-stack.md](docs/docker-edge-stack.md) |
| OpenAPI / Swagger | **Sí**: interfaz en **`/api/docs`**, JSON en **`/api/docs/json`**. Variables `OPENAPI_ENABLED` (default true) y `OPENAPI_SERVER_URL` (opcional, para “Try it out”). |
| Manual admin / DJ | Pantalla **Ayuda** (`/help`) · primera emisión [docs/day-1-runbook.md](docs/day-1-runbook.md) |
| Búsqueda semántica (Ollama) | `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `OLLAMA_EMBEDDING_MODEL` · `GET /api/semantic/status` · enrich en Biblioteca |
| Desktop auto-update | Al empaquetar: `RADIOFLOW_UPDATE_URL=https://…/releases` · ver `apps/desktop/auto-updater.cjs` |
| Pruebas E2E | **`npm run test:e2e`**: auth, logout, navegación, Swagger, **admin crea evento** (`e2e/admin-evento.spec.ts`; Prisma con `DATABASE_URL` o credenciales `E2E_ADMIN_*`). |

---

## Referencias rápidas

- Primera emisión (día-1): [docs/day-1-runbook.md](docs/day-1-runbook.md)
- Smoke broadcast (A5): `npm run smoke:broadcast` · [docs/streaming-encoder-icecast.md](docs/streaming-encoder-icecast.md)
- Backup/restore firmado (A6): [docs/backup-restore.md](docs/backup-restore.md)
- Soak 72 h (A8): [docs/staging-72h-soak.md](docs/staging-72h-soak.md) · `npm run soak:watch`
- Parrilla + publicidad (B3): [docs/b3-ads-parrilla-checklist.md](docs/b3-ads-parrilla-checklist.md)
- Checklist de validación (casillas): [docs/validation-checklist.md](docs/validation-checklist.md)
- Arquitectura: [docs/architecture.md](docs/architecture.md)
- Encoder → Icecast: [docs/streaming-encoder-icecast.md](docs/streaming-encoder-icecast.md)
- Runbook release 1.0: [docs/release-1.0-runbook.md](docs/release-1.0-runbook.md)
