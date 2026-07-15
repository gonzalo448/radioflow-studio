# RadioFlow Studio

Plataforma integral de automatización y gestión radial para **estaciones en PC**: programación, librería multimedia, cabina, streaming (Icecast/Shoutcast/AzuraCast) y curaduría semántica (Ollama).

**Producto para clientes:** aplicación **Windows instalable (`.exe`)**, autocontenida (motor local + base SQLite en el equipo). No requiere navegador ni servidor en la nube. El panel web del monorepo queda solo para **desarrollo interno**.

## Codificación del repositorio

Todo el código y la documentación deben guardarse en **UTF-8** (sin BOM). El archivo [`.editorconfig`](.editorconfig) fija `charset = utf-8` para los editores compatibles. Si ves caracteres rotos (`Ã©`, `â€"`), reabre el archivo como UTF-8 y vuelve a guardar.

## Requisitos

- Node.js 20+
- Docker Desktop (para PostgreSQL y Redis opcional de desarrollo)
- npm (workspaces en la raíz)

## Arranque rápido (producto instalable)

1. **Instalar dependencias**

   ```bash
   npm install
   npm run build -w @radioflow/shared
   ```

2. **Desarrollo en tu PC (recomendado)**

   ```bash
   npm run dev
   ```

   Abre **solo la ventana de RadioFlow Studio (Electron)** — no uses el navegador.

   - Motor local: API SQLite embebida (misma arquitectura que el instalador `.exe`)
   - Datos en la carpeta de usuario de la app (`%APPDATA%\\radioflow-studio` en Windows)
   - Workers de biblioteca activos por defecto (B2: process-jobs + cues + FFmpeg)
   - Primer arranque: **Bienvenida → Crear tu usuario → Explorador**

   Para repetir la bienvenida, borrá los datos de la app en `%APPDATA%\\radioflow-studio` (o menú de la app cuando esté disponible).

3. **Generar instalador para clientes (Windows)**

   ```bash
   npm run build:installer
   ```

   Salida: `apps/desktop/dist-pack/run-<fecha>/RadioFlow-Studio-Setup-<versión>.exe`

---

## Infra Docker (servidor / staging — no es el cliente)

1. **Stack local (Postgres, Redis y API en contenedor)**

   ```bash
   docker compose up -d
   ```

   Levanta PostgreSQL, Redis y la **API** en el puerto **4000** (con `prisma migrate deploy` al arrancar). Los archivos subidos se guardan en el volumen `radioflow_media` montado en `/app/media` dentro del contenedor.

   Perfil opcional **workers** (parrilla automática, requiere `RADIOFLOW_TOKEN`). **C3:** en la API poné
   `API_BACKGROUND_MODE=maintenance`, `SCHEDULE_APPLY_MODE=worker`, `SCHEDULE_WORKER_EXPECTED=1`, `INTERNAL_SCHEDULE_POLL_MS=0`
   (ver [docs/c3-scheduler-consolidated.md](docs/c3-scheduler-consolidated.md)):

   ```bash
   docker compose --profile workers up -d
   ```

2. **Variables de entorno**

   Copia `.env.example` de la **raíz** o `apps/api/.env.example` a `apps/api/.env` para desarrollo **local** (API con `npm run dev`). Con solo Docker, define al menos `JWT_SECRET` en el entorno o en un `.env` en la raíz para el servicio `api` (ver `docker-compose.yml`).

3. **Dependencias y base de datos (desarrollo sin contenedor API)**

   ```bash
   npm install
   cd apps/api
   npx prisma migrate deploy
   cd ../..
   npm run build -w @radioflow/shared
   ```

4. **Desarrollo (app instalable en tu PC)**

   ```bash
   npm run dev
   ```

   Equivale a `dev:desktop:embedded`: API SQLite local + panel en Electron con explorador nativo de discos.

   - **No uses el navegador** para operar la emisora (`localhost:5173` muestra «Instalá la app»).
   - CI/E2E interno: `npm run dev:web-ci` (solo con `VITE_ALLOW_WEB_PANEL=true`).

   **Pruebas de humo** (API levantada y `DATABASE_URL` + `JWT_SECRET` definidos):

   ```bash
   npm run smoke:api
   ```

   Por defecto solo comprueba health, BD, estación, settings y registro. Para **incluir** subida a biblioteca, **cola de process-jobs** (BPM), playlist y `queue-from-playlist`, define `SMOKE_PROMOTE_TO_EDITOR=1` (sube el usuario a rol *editor* en la BD; **solo en entornos de prueba**):

   ```bash
   # Linux / macOS
   SMOKE_PROMOTE_TO_EDITOR=1 DATABASE_URL=postgresql://... npm run smoke:api

   # Windows PowerShell
   $env:SMOKE_PROMOTE_TO_EDITOR="1"; $env:DATABASE_URL="postgresql://..."; npm run smoke:api
   ```

   La CI ejecuta el humo **profundo** automáticamente.

   **E2E (Playwright)**: la CI levanta API + Vite con panel web permitido. En local:

   ```bash
   npm run dev:web-ci
   # otra terminal, con API en :4000
   npx playwright install chromium
   npm run test:e2e
   ```

   Flujos cubiertos: **login → `/inicio`**, **cerrar sesión → Entrar**, **barra Módulos → Eventos**, **proxy `/api/docs` (Swagger)**, **admin: nuevo evento + toast** (`DATABASE_URL` vía `.env` o `E2E_ADMIN_EMAIL` + `E2E_ADMIN_PASSWORD`). En CI corre tras el humo HTTP (ver `.github/workflows/ci.yml`).

   Opcional: `npm run dev:auto` — API + PWA + encoder (WS) + **schedule-worker** (parrilla automática).

   - Panel operador: aplicación **RadioFlow Studio** (Electron), no el navegador
   - API embebida: [http://127.0.0.1:4000/api/health](http://127.0.0.1:4000/api/health)

Tras el primer registro, puedes promover un usuario a administrador con Prisma Studio (`npm run db:studio -w @radioflow/api`) o con SQL: `UPDATE "User" SET role = 'admin' WHERE email = 'tu@correo'`.

## Distribución a clientes (instalador Windows)

En la raíz del repo (Windows, Node 20+):

```bash
npm install
npm run build:installer
```

Salida: carpeta `apps/desktop/dist-pack/run-<fecha>/` con **`RadioFlow-Studio-Setup-<versión>.exe`**. Ese archivo es el que entregás al cliente; el asistente instala la app en Programas y características.

- **Datos del cliente:** base SQLite y medios bajo la carpeta de datos de la app (Electron `userData`), no en el repo.
- **Primer arranque:** pantalla de bienvenida y creación de tu usuario (acceso completo a la emisora en este PC).
- **Sin Postgres ni Docker** en la PC del cliente.

Desarrollo de la UI empaquetada: `npm run dev:desktop:embedded` (API + Vite + Electron).  
Otros sistemas (macOS/Linux): `npm run build:desktop:all` (DMG / AppImage).

El panel **web/PWA** (`npm run dev` en `:5173`) es solo para quien desarrolla o opera un servidor centralizado; no es el canal de distribución a emisoras.

### Icono, firma Authenticode y actualizaciones automáticas

| Paso | Comando / variable |
|------|-------------------|
| Iconos (desde `favicon.svg`) | `npm run icons:desktop` (incluido en `build:installer`) |
| Instalador sin firmar (pruebas) | `set RADIOFLOW_SKIP_SIGNING=1` y `npm run build:installer` |
| Firma Windows (.pfx) | `set CSC_LINK=ruta\certificado.pfx` · `set CSC_KEY_PASSWORD=...` · `npm run build:installer` |
| Canal de updates | Servidor HTTPS estático con `latest.yml` + `.exe` (salida del build). Al empaquetar: `set RADIOFLOW_UPDATE_URL=https://tu-cdn/radioflow/win` |
| Desactivar auto-update en cliente | `set RADIOFLOW_AUTO_UPDATE=0` antes de abrir la app (soporte) |

Tras un build con `RADIOFLOW_UPDATE_URL`, subí a tu CDN **todos** los archivos de la carpeta de salida (`RadioFlow-Studio-Setup-*.exe`, `latest.yml`, `.blockmap` si existe). La app instalada consulta ese URL al inicio (silencioso) y desde **Ayuda → Buscar actualizaciones…**.

## Arquitectura

Diagrama y notas alineadas al código (Fastify, Redis, encoder, Liquidsoap como integración): **[docs/architecture.md](docs/architecture.md)**.

Principio de producto — **toda la música en bóveda local** (`MEDIA_ROOT`) para cabina y apps conectadas: **[docs/media-vault.md](docs/media-vault.md)**.

Nginx frente a la API + estáticos de la PWA, y equivalencias con un `docker-compose` tipo CRA/backend: **[docs/docker-edge-stack.md](docs/docker-edge-stack.md)** (incluye **HTTPS** con plantilla `docker/nginx/templates/radioflow-https.conf` y `docker-compose.edge.tls.yml`).

Checklist de cierre y QA en producción: **[README-prod.md](README-prod.md)** · validación detallada (casillas): **[docs/validation-checklist.md](docs/validation-checklist.md)** · paridad RadioBOSS y backlog de producto: **[docs/radioboss-parity.md](docs/radioboss-parity.md)**.

## Primera emisión (día-1)

Operador no-dev: instalar → biblioteca → Cabina → Icecast → Emitir — **[docs/day-1-runbook.md](docs/day-1-runbook.md)**.  
Skip / AutoDJ / fin de archivo — **[docs/b4-skip-autodj-eof.md](docs/b4-skip-autodj-eof.md)**.  
Aire único (Cabina = mount público) — **[docs/c1-unified-air.md](docs/c1-unified-air.md)**.  
Voicetrack en el stream — **[docs/c2-voicetrack-air.md](docs/c2-voicetrack-air.md)**.  
Parrilla consolidada (C3) — **[docs/c3-scheduler-consolidated.md](docs/c3-scheduler-consolidated.md)**.

Smoke técnico del path al aire: `npm run smoke:broadcast` (Icecast) o `npm run smoke:broadcast:mock`.

Backup/restore firmado: [docs/backup-restore.md](docs/backup-restore.md) (`backup:desktop`, `drill:backup`).

Soak staging 72 h (A8): [docs/staging-72h-soak.md](docs/staging-72h-soak.md) — `npm run soak:sample` / `soak:watch`.

## Operación (backups/restore/deploy)

Ver guía en `docs/operations.md`, [docs/backup-restore.md](docs/backup-restore.md) y runbook `docs/release-1.0-runbook.md` (histórico: `docs/release-0.1-runbook.md`).

## Estructura del monorepo

| Ruta | Rol |
|------|-----|
| `apps/api` | Backend Fastify: REST, JWT, usuarios, librería inicial (Prisma + PostgreSQL) |
| `apps/web` | Frontend React + Vite + PWA (navegador); comparte UI con el shell Electron |
| `apps/desktop` | Shell **Electron** (cliente instalable): exploración nativa de discos e import local |
| `apps/schedule-worker` | Automatización de parrilla: bloque activo → `queue-from-playlist` |
| `packages/shared` | Tipos y contratos compartidos |
| `docker-compose.yml` | PostgreSQL 16, Redis 7, **API** (imagen Docker), Icecast opcional (`profile broadcast`) y perfil `workers` |

## API útil (v0.1)

- `GET /api/health` — estado del proceso (rápido, sin consultar BD)
- `GET /api/public/now-playing` — Now Playing público (título, artista, carátula, logo estación; sin token)
- `GET /api/public/nowplaying.json` — sidecar JSON (widgets / FTP-style)
- `GET /api/public/current-cover.jpg` — carátula exportada de la pista al aire
- `GET /api/health/ready` — listo para tráfico; **503** si la base de datos no responde (orquestación / balanceadores)
- **`GET /api/docs`** — **Swagger UI** (OpenAPI 3; rutas con esquema documentado). **`GET /api/docs/json`** — especificación JSON. Desactivar: `OPENAPI_ENABLED=0`.
- `POST /api/auth/register` — registro (`email`, `password`, `displayName` opcional)
- `POST /api/auth/login` — inicio de sesión
- `GET /api/users/me` — perfil (header `Authorization: Bearer <token>`)
- `GET /api/users` — listado (solo `admin`)
- `GET|POST /api/library/assets` — catálogo; `?q=` filtro por título/artista/album
- `GET|POST /api/library/process-jobs` — cola asíncrona (loudness, BPM desde tags, trim silencio, transcode MP3); consumir con `npm run library-process-worker -w @radioflow/api` (misma `DATABASE_URL` / `MEDIA_ROOT`)
- `GET /api/library/assets/:id/stream` — stream del archivo bajo `MEDIA_ROOT` (seguridad por prefijo)
- `POST /api/library/upload` — subida multipart (campo `file`; roles `dj`+)
- `GET /api/settings` — marca pública · `PATCH /api/settings` (editor+, incluye `activeStreamingTargetId` para salida del encoder vía API)
- `GET /api/semantic/search?q=` — búsqueda incl. nota semántica · `POST /api/semantic/enrich/:assetId` (Ollama)
- `GET /api/reports/play-log` — bitácora de operaciones (editor+)
- `POST /api/station/queue-from-playlist` — volcar playlist a la cola (`replace` opcional)
- `GET /api/playlists/:id` — detalle con ítems · `PATCH|DELETE /api/playlists/:id`
- `POST /api/playlists/:id/items` — añadir pista · `DELETE .../items/:itemId` · `PUT .../items/reorder` (`orderedItemIds`)
- `WS /api/ws/station` — flujo JSON `{ type: "station", payload }` con el mismo cuerpo que `GET /api/station`; emisión al conectar y tras cada cambio en cola/modo
- `POST /api/station/queue` — encolar pista (`dj`, `editor`, `admin`)
- `DELETE /api/station/queue/:itemId` — quitar y reordenar
- `PATCH /api/station` — modo, posición, título en vivo, **`autoScheduleEnabled`** (parrilla automática)
- `POST /api/station/skip` — avanzar `currentPosition`
- `GET|POST /api/schedule` y `PATCH|DELETE /api/schedule/:id` — parrilla semanal (`editor`, `admin` para escritura)
- `GET /api/schedule/today-hints` — bloques del día y cuáles cubren el minuto actual
- `GET|POST /api/playlists` — listados / crear playlist vacía
- `GET|POST /api/streaming/targets`, `PATCH|DELETE …` — destinos Icecast/Shoutcast/AzuraCast (**lectura y detalle requieren sesión**)
- `GET /api/streaming/encoder-url` — URL lista para FFmpeg (**dj+**), según destino activo en `PATCH /api/settings` (`activeStreamingTargetId`)

### Automatización de parrilla (`@radioflow/schedule-worker` **o** scheduler interno)

C3: **un solo** aplicador de `ScheduleBlock` → cola. Detalle: [docs/c3-scheduler-consolidated.md](docs/c3-scheduler-consolidated.md).

1. Activa **Automatizar parrilla** en la UI (Estación) o `PATCH /api/station` con `autoScheduleEnabled: true`.
2. Crea bloques en **Parrilla** con playlist asociada.
3. **Elige un modo** (si configurás worker + poll interno, C3 **apaga** el poll):
   - **Worker externo**: `SCHEDULE_APPLY_MODE=worker`, `SCHEDULE_WORKER_EXPECTED=1`, `INTERNAL_SCHEDULE_POLL_MS=0`, `API_BACKGROUND_MODE=maintenance` + `RADIOFLOW_TOKEN` (dj+). Ver `apps/schedule-worker/.env.example`.
   - **Dentro de la API**: `SCHEDULE_APPLY_MODE=auto|internal`, `API_BACKGROUND_MODE=full` (o `automation`) y `INTERNAL_SCHEDULE_POLL_MS` (p. ej. `20000`); opcional `SCHEDULE_REPLACE_QUEUE=0` para *append*.
   - **Solo HTTP / apply manual**: `SCHEDULE_APPLY_MODE=off` o `API_BACKGROUND_MODE=http-only` + `POST /api/schedule/apply-active`.

### Encoder con WebSocket

`@radioflow/encoder` usa por defecto **`ws://…/api/ws/station`** y hace polling de respaldo. Define **`RADIOFLOW_MEDIA_ROOT`** apuntando al mismo directorio que `MEDIA_ROOT` de la API para resolver rutas relativas de los archivos.

**Salida hacia Icecast**: guía paso a paso en [docs/streaming-encoder-icecast.md](docs/streaming-encoder-icecast.md). Icecast de prueba en Docker: `npm run docker:broadcast` (perfil `broadcast`).

Variables típicas del encoder: ver `apps/encoder/.env.example` (`RADIOFLOW_ICECAST_URL`, `ENABLE_FFMPEG`).

## Limitaciones habituales del MVP y cómo avanzar

| Tema | Qué implica | Cómo se aborda en producto |
|------|----------------|-----------------------------|
| **Parrilla en proceso separado** | El worker evita acoplar timers en la API. | **C3 Opción A**: `@radioflow/schedule-worker` + `SCHEDULE_APPLY_MODE=worker` + `SCHEDULE_WORKER_EXPECTED=1` + `API_BACKGROUND_MODE=maintenance`. **Opción B**: `INTERNAL_SCHEDULE_POLL_MS>0` y `API_BACKGROUND_MODE=full` (sin worker). |
| **Redis sin uso** | El servicio en Compose está reservado. | **Usar** Redis para pub/sub multi-instancia del WebSocket, rate limits, locks de parrilla o colas; **o** quitar el servicio hasta que haga falta. |
| **Encoder + destino** | Antes solo variable de entorno. | **Resuelto en esta versión**: destino activo en **Marca** + `GET /api/streaming/encoder-url` + encoder sin `RADIOFLOW_ICECAST_URL` si hay token. |
| **Multi-tenant / RBAC fino / Liquidsoap / embeddings / apps nativas** | Alcance de plataforma grande. | Fases: modelo `Organization` + `tenantId`, políticas por recurso, motor Liquidsoap o SaaS Icecast, pgvector u otro índice, Capacitor/React Native. |

## Arquitectura prevista (roadmap)

1. **Frontend**: React PWA hoy; apps nativas (Capacitor/React Native) como extensión del mismo panel.
2. **Backend**: motor de parrilla, cola de reproducción y salida al aire vía **encoder FFmpeg → Icecast** (path por defecto). Liquidsoap + M3U es legacy/opt-in.
3. **Streaming**: montaje sobre Icecast/Shoutcast o instancia AzuraCast; esta capa vivirá como servicios configurables en la API.
4. **IA**: cliente hacia Ollama local o Perplexica para embeddings, recomendaciones y enriquecimiento de metadatos.

## Integración continua (GitHub Actions)

El workflow `.github/workflows/ci.yml` ejecuta en paralelo:

- **build-and-smoke**: dependencias, build de shared/API/web, Postgres de servicio, migraciones, API en segundo plano y `scripts/smoke-api.mjs` con humo **profundo** (`SMOKE_PROMOTE_TO_EDITOR=1`: upload, playlist, cola).
- **icecast-reachable**: `docker compose --profile broadcast up -d icecast` y comprobación HTTP al puerto **8000** (sin FFmpeg).

## Licencia

Propietario / a definir por el equipo.
