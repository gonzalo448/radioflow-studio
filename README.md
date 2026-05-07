# RadioFlow Studio

Plataforma integral de automatización y gestión radial: programación, librerías multimedia, streaming compatible con Icecast/Shoutcast/AzuraCast, control remoto vía PWA y preparación para curaduría semántica (Ollama / Perplexica).

## Requisitos

- Node.js 20+
- Docker Desktop (para PostgreSQL y Redis opcional de desarrollo)
- npm (workspaces en la raíz)

## Arranque rápido

1. **Infra local (Postgres, Redis y API en contenedor)**

   ```bash
   docker compose up -d
   ```

   Levanta PostgreSQL, Redis y la **API** en el puerto **4000** (con `prisma migrate deploy` al arrancar). Los archivos subidos se guardan en el volumen `radioflow_media` montado en `/app/media` dentro del contenedor.

   Perfil opcional **workers** (parrilla automática, requiere `RADIOFLOW_TOKEN`):

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

4. **Desarrollo (API + PWA)**

   ```bash
   npm run dev
   ```

   **Pruebas de humo** (API levantada y `DATABASE_URL` + `JWT_SECRET` definidos):

   ```bash
   npm run smoke:api
   ```

   Por defecto solo comprueba health, BD, estación, settings y registro. Para **incluir** subida a biblioteca, playlist y `queue-from-playlist`, define `SMOKE_PROMOTE_TO_EDITOR=1` (sube el usuario a rol *editor* en la BD; **solo en entornos de prueba**):

   ```bash
   # Linux / macOS
   SMOKE_PROMOTE_TO_EDITOR=1 DATABASE_URL=postgresql://... npm run smoke:api

   # Windows PowerShell
   $env:SMOKE_PROMOTE_TO_EDITOR="1"; $env:DATABASE_URL="postgresql://..."; npm run smoke:api
   ```

   La CI ejecuta el humo **profundo** automáticamente.

   Opcional: `npm run dev:auto` — API + PWA + encoder (WS) + **schedule-worker** (parrilla automática).

   - Panel: [http://localhost:5173](http://localhost:5173)
   - API: [http://localhost:4000/api/health](http://localhost:4000/api/health)
   - WebSocket estación: `ws://localhost:4000/api/ws/station` (en dev detrás del proxy: `ws://localhost:5173/api/ws/station`)

Tras el primer registro, puedes promover un usuario a administrador con Prisma Studio (`npm run db:studio -w @radioflow/api`) o con SQL: `UPDATE "User" SET role = 'admin' WHERE email = 'tu@correo'`.

## Estructura del monorepo

| Ruta | Rol |
|------|-----|
| `apps/api` | Backend Fastify: REST, JWT, usuarios, librería inicial (Prisma + PostgreSQL) |
| `apps/web` | Frontend React + Vite + PWA (instalable en móvil/tablet/escritorio) |
| `apps/schedule-worker` | Automatización de parrilla: bloque activo → `queue-from-playlist` |
| `packages/shared` | Tipos y contratos compartidos |
| `docker-compose.yml` | PostgreSQL 16, Redis 7, **API** (imagen Docker), Icecast opcional (`profile broadcast`) y perfil `workers` |

## API útil (v0.1)

- `GET /api/health` — estado del proceso (rápido, sin consultar BD)
- `GET /api/health/ready` — listo para tráfico; **503** si la base de datos no responde (orquestación / balanceadores)
- `POST /api/auth/register` — registro (`email`, `password`, `displayName` opcional)
- `POST /api/auth/login` — inicio de sesión
- `GET /api/users/me` — perfil (header `Authorization: Bearer <token>`)
- `GET /api/users` — listado (solo `admin`)
- `GET|POST /api/library/assets` — catálogo; `?q=` filtro por título/artista/album
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

1. Activa **Automatizar parrilla** en la UI (Estación) o `PATCH /api/station` con `autoScheduleEnabled: true`.
2. Crea bloques en **Parrilla** con playlist asociada.
3. **Elige un modo** (no mezcles worker + scheduler interno sin necesidad):
   - **Worker externo**: `RADIOFLOW_TOKEN` (usuario **dj+**) y `SCHEDULE_REPLACE_QUEUE` (por defecto sustituye la cola). Ver `apps/schedule-worker/.env.example`.
   - **Dentro de la API**: define `INTERNAL_SCHEDULE_POLL_MS` (p. ej. `20000`) y opcional `SCHEDULE_REPLACE_QUEUE=0` para hacer *append*. No requiere token: corre en el mismo proceso que Fastify. Útil en Docker con un solo contenedor de API.

### Encoder con WebSocket

`@radioflow/encoder` usa por defecto **`ws://…/api/ws/station`** y hace polling de respaldo. Define **`RADIOFLOW_MEDIA_ROOT`** apuntando al mismo directorio que `MEDIA_ROOT` de la API para resolver rutas relativas de los archivos.

**Salida hacia Icecast**: guía paso a paso en [docs/streaming-encoder-icecast.md](docs/streaming-encoder-icecast.md). Icecast de prueba en Docker: `npm run docker:broadcast` (perfil `broadcast`).

Variables típicas del encoder: ver `apps/encoder/.env.example` (`RADIOFLOW_ICECAST_URL`, `ENABLE_FFMPEG`).

## Limitaciones habituales del MVP y cómo avanzar

| Tema | Qué implica | Cómo se aborda en producto |
|------|----------------|-----------------------------|
| **Parrilla en proceso separado** | El worker evita acoplar timers en la API. | **Opción A (actual)**: `@radioflow/schedule-worker`. **Opción B**: `INTERNAL_SCHEDULE_POLL_MS>0` en la API (misma deduplicación en BD; **no** mezclar con el worker salvo conocimiento del doble poll). **Opción C**: Redis + colas cuando escales réplicas. |
| **Redis sin uso** | El servicio en Compose está reservado. | **Usar** Redis para pub/sub multi-instancia del WebSocket, rate limits, locks de parrilla o colas; **o** quitar el servicio hasta que haga falta. |
| **Encoder + destino** | Antes solo variable de entorno. | **Resuelto en esta versión**: destino activo en **Marca** + `GET /api/streaming/encoder-url` + encoder sin `RADIOFLOW_ICECAST_URL` si hay token. |
| **Multi-tenant / RBAC fino / Liquidsoap / embeddings / apps nativas** | Alcance de plataforma grande. | Fases: modelo `Organization` + `tenantId`, políticas por recurso, motor Liquidsoap o SaaS Icecast, pgvector u otro índice, Capacitor/React Native. |

## Arquitectura prevista (roadmap)

1. **Frontend**: React PWA hoy; apps nativas (Capacitor/React Native) como extensión del mismo panel.
2. **Backend**: motor de parrilla, cola de reproducción y hooks hacia codificadores (FFmpeg / liquidsoap) en fases posteriores.
3. **Streaming**: montaje sobre Icecast/Shoutcast o instancia AzuraCast; esta capa vivirá como servicios configurables en la API.
4. **IA**: cliente hacia Ollama local o Perplexica para embeddings, recomendaciones y enriquecimiento de metadatos.

## Integración continua (GitHub Actions)

El workflow `.github/workflows/ci.yml` ejecuta en paralelo:

- **build-and-smoke**: dependencias, build de shared/API/web, Postgres de servicio, migraciones, API en segundo plano y `scripts/smoke-api.mjs` con humo **profundo** (`SMOKE_PROMOTE_TO_EDITOR=1`: upload, playlist, cola).
- **icecast-reachable**: `docker compose --profile broadcast up -d icecast` y comprobación HTTP al puerto **8000** (sin FFmpeg).

## Licencia

Propietario / a definir por el equipo.
