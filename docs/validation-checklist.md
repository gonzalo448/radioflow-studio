# Checklist de validación final — RadioFlow Studio

Marcá cada ítem al cerrar un entorno (staging o producción). Las rutas y nombres están alineados al **monorepo actual** (`apps/api`, `apps/web`, `docker-compose.prod.yml`).

---

## Autenticación y roles

- [ ] **Login** (`POST /api/auth/login` o alias `POST /api/login`) y **logout** (`POST /api/auth/logout` / `POST /api/logout`) funcionan como espera el panel.
- [ ] **Refresh tokens** se generan al iniciar sesión y se **rotan** al refrescar; desde **Sesiones** (admin) podés **revocar** y el cliente pierde acceso al agotarse el access token / al fallar el refresh.
- [ ] Cada rol del modelo Prisma ve solo lo permitido:
  - `admin` — consola `/admin/*`, usuarios, sesiones, eventos, etc.
  - `editor` — biblioteca, programación, marca según políticas actuales.
  - `dj` — operación en vivo / cola según rutas.
  - `viewer` — lectura acorde a rutas (equivalente a “oyente” de solo consulta).
  - `operador` — según reglas definidas en la API (si lo usás en despliegue).

> Roles en código: `admin` \| `editor` \| `dj` \| `viewer` \| `operador` (no existe literal `oyente`; lo habitual es `viewer`).

---

## Streaming

- [ ] **Liquidsoap** (tu `.liq` + contenedor/perfil) consume **playlists** (M3U generados por la API/cron) y/o **eventos** (`GET /api/eventos/actual`, etc.) **sin errores** en logs.
- [ ] **Icecast** emite el mount configurado (típico **`/stream`**). La URL pública puede ser `https://tu-dominio/stream` si **Nginx** hace proxy a Icecast (ver `docker/nginx/templates/radioflow-https.conf`); el puerto directo de Icecast suele ser **HTTP** (p. ej. `:8000`).
- [ ] Un **oyente externo** (VLC, navegador) reproduce la URL pública del stream.

---

## Backend y API

- [ ] Endpoints principales responden con token/cabeceras correctas:
  - Usuarios: `GET /api/users` o `GET /api/usuarios` (admin), `GET /api/users/me`.
  - Eventos: `GET /api/eventos`, `POST /api/eventos` (admin), etc.
  - Sesiones: `GET /api/sesiones`, `POST /api/sesiones/revocar/:id` (admin).
- [ ] **Validaciones**: cuerpos inválidos devuelven **400**; conflictos (p. ej. email duplicado) **409** donde aplique; no se aceptan campos obligatorios vacíos.
- [ ] **Logs** de la API registran peticiones y errores (salida del contenedor `api` o `node`).

---

## Frontend

- [ ] Navegación fluida entre **Historial, Playlists, Programación, Usuarios, Eventos, Sesiones** (rutas `/admin/*` y rutas generales según rol).
- [ ] **Notificaciones** (toast) al crear evento con éxito o error; al revocar sesión podés ampliar el mismo patrón con `useNotification` si aún no está cableado ahí.
- [ ] **Responsive**: panel usable en móvil y tablet (PWA / layout actual).

---

## Seguridad

- [ ] **HTTPS** con certificado válido (Certbot en el host o PEM en `docker/nginx/tls/` + plantilla TLS).
- [ ] **Redirección HTTP → HTTPS** activa en Nginx cuando corresponda.
- [ ] **Secretos** (`JWT_SECRET`, `POSTGRES_PASSWORD`, claves Icecast, etc.) solo en **`.env`** / secretos del orquestador, nunca en el código ni en imágenes versionadas.

---

## Base de datos

- [ ] **Migraciones** aplicadas (`prisma migrate deploy` en arranque del contenedor `api` o manualmente). Tras `git pull`, si el humo o el registro fallan con **P2022** (columna inexistente), ejecutá `npx prisma migrate deploy` en `apps/api` contra la misma `DATABASE_URL` que usa la API.
- [ ] Tablas presentes según `schema.prisma` (entre otras: `User`, `Evento`, playlists, `RefreshToken`).
- [ ] **Backup** con `pg_dump` probado y automatizado (ver [docs/operations.md](operations.md)).
- [ ] **Integridad**: relaciones coherentes (p. ej. `RefreshToken` → `User`; eventos y playlists según tu modelo de negocio).

---

## Despliegue

- [ ] **`docker compose -f docker-compose.prod.yml up -d`** (extensión **`.yml`**, no `.yaml`) levanta **postgres**, **redis**, **api** sin errores; perfiles opcionales (`broadcast`, `edge`, etc.) según tu diseño.
- [ ] **Nginx** (overlays `docker-compose.edge.prod.yml` + TLS si aplica) sirve el **build** de `apps/web/dist` y hace **proxy** a `api`; opcionalmente proxy a **Icecast** en `/stream`.
- [ ] **Reinicio** de contenedores (`docker compose … restart` o redeploy): la app vuelve a estado sano (readiness `GET /api/health/ready`).

---

## Documentación y API explorables

- [ ] OpenAPI / **Swagger UI** en **`/api/docs`** accesible (si `OPENAPI_ENABLED` no está en `0`). Ver [README-prod.md](../README-prod.md).
- [ ] **`npm run test:e2e`** (Playwright) en verde con API + Vite levantados (o en CI tras el job de build).

---

## Referencias

- [README-prod.md](../README-prod.md) — pasos de despliegue.
- [docs/docker-edge-stack.md](docker-edge-stack.md) — Nginx, TLS, Certbot, Liquidsoap.
- [docs/operations.md](operations.md) — backups y operación.
