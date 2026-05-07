# RadioFlow Studio

Plataforma integral de automatización y gestión radial: programación, librerías multimedia, streaming compatible con Icecast/Shoutcast/AzuraCast, control remoto vía PWA y preparación para curaduría semántica (Ollama / Perplexica).

## Requisitos

- Node.js 20+
- Docker Desktop (para PostgreSQL y Redis de desarrollo)
- npm (workspaces en la raíz)

## Arranque rápido

1. **Infra local**

   ```bash
   docker compose up -d
   ```

2. **Variables de entorno**

   Copia `.env.example` a `apps/api/.env` y ajusta si hace falta (mínimo `JWT_SECRET` y `DATABASE_URL`).

3. **Dependencias y base de datos**

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

   Opcional: API + PWA + proceso encoder (sondeo / FFmpeg): `npm run dev:full`.

   - Panel: [http://localhost:5173](http://localhost:5173)
   - API: [http://localhost:4000/api/health](http://localhost:4000/api/health)
   - WebSocket estación: `ws://localhost:4000/api/ws/station` (en dev detrás del proxy: `ws://localhost:5173/api/ws/station`)

Tras el primer registro, puedes promover un usuario a administrador con Prisma Studio (`npm run db:studio -w @radioflow/api`) o con SQL: `UPDATE "User" SET role = 'admin' WHERE email = 'tu@correo'`.

## Estructura del monorepo

| Ruta | Rol |
|------|-----|
| `apps/api` | Backend Fastify: REST, JWT, usuarios, librería inicial (Prisma + PostgreSQL) |
| `apps/web` | Frontend React + Vite + PWA (instalable en móvil/tablet/escritorio) |
| `apps/encoder` | Proceso que sondea `/api/station` y sugiere (u opcionalmente lanza) FFmpeg hacia Icecast |
| `packages/shared` | Tipos y contratos compartidos |
| `docker-compose.yml` | PostgreSQL 16 y Redis 7 |

## API útil (v0.1)

- `GET /api/health` — estado del servicio
- `POST /api/auth/register` — registro (`email`, `password`, `displayName` opcional)
- `POST /api/auth/login` — inicio de sesión
- `GET /api/users/me` — perfil (header `Authorization: Bearer <token>`)
- `GET /api/users` — listado (solo `admin`)
- `GET|POST /api/library/assets` — catálogo inicial de medios
- `WS /api/ws/station` — flujo JSON `{ type: "station", payload }` con el mismo cuerpo que `GET /api/station`; emisión al conectar y tras cada cambio en cola/modo
- `POST /api/station/queue` — encolar pista (`dj`, `editor`, `admin`)
- `DELETE /api/station/queue/:itemId` — quitar y reordenar
- `PATCH /api/station` — modo (`AUTO` \| `LIVE_ASSIST` \| `LIVE`), posición, título en vivo
- `POST /api/station/skip` — avanzar `currentPosition`
- `GET|POST /api/schedule` y `PATCH|DELETE /api/schedule/:id` — parrilla semanal (`editor`, `admin` para escritura)
- `GET /api/schedule/today-hints` — bloques del día y cuáles cubren el minuto actual
- `GET|POST /api/playlists` — listados / crear playlist vacía
- `GET|POST /api/streaming/targets`, `GET|PATCH|DELETE /api/streaming/targets/:id` — destinos Icecast/Shoutcast/AzuraCast (sin devolver la contraseña de fuente)

## Arquitectura prevista (roadmap)

1. **Frontend**: React PWA hoy; apps nativas (Capacitor/React Native) como extensión del mismo panel.
2. **Backend**: motor de parrilla, cola de reproducción y hooks hacia codificadores (FFmpeg / liquidsoap) en fases posteriores.
3. **Streaming**: montaje sobre Icecast/Shoutcast o instancia AzuraCast; esta capa vivirá como servicios configurables en la API.
4. **IA**: cliente hacia Ollama local o Perplexica para embeddings, recomendaciones y enriquecimiento de metadatos.

Variables típicas del encoder: ver `apps/encoder/.env.example` (`RADIOFLOW_ICECAST_URL`, `ENABLE_FFMPEG`).

## Licencia

Propietario / a definir por el equipo.
