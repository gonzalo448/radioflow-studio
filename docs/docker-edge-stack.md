# Nginx y Liquidsoap (respecto a tu `docker-compose` de referencia)

Tu plantilla usaba **frontend/backend** separados, **Postgres 15**, **Express**, variables `DB_*` y `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`. En este monorepo:

| Plantilla | RadioFlow Studio |
|-----------|------------------|
| `./frontend` | `apps/web` (Vite, no CRA) |
| `./backend` | `apps/api` (Fastify, imagen única `Dockerfile` en la raíz) |
| `REACT_APP_API_URL` | No aplica: con Nginx mismo origen, el build puede ir **sin** `VITE_API_ORIGIN` y las peticiones van a `/api`. |
| `DB_HOST` + credenciales sueltas | `DATABASE_URL` (ver `docker-compose.yml` / `docker-compose.prod.yml`) |
| Dos secretos JWT | `JWT_SECRET` (único en la API actual) |
| Postgres 15 | Postgres **16** en Compose |

## Nginx (reverse proxy + estáticos)

1. Generá el panel: `npm run build -w @radioflow/web` (salida en `apps/web/dist`, ignorada por git).
2. Levantá el stack base y el overlay:

**Desarrollo** (misma red por defecto que `api`):

```bash
docker compose -f docker-compose.yml -f docker-compose.edge.dev.yml --profile edge up -d
```

**Producción** (red `radioflow_internal`):

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.edge.prod.yml --profile edge up -d
```

3. Definí `CORS_ORIGIN` en la API con el origen que ve el navegador (p. ej. `https://studio.ejemplo.com`), no la URL interna `https://backend:4000` (esa forma parte de otra época CRA/Docker).

Montajes TLS: añadí un comentario en `docker/nginx/conf.d/radioflow.conf`; plantilla completa HTTP→HTTPS + `/stream` → Icecast en **`docker/nginx/templates/radioflow-https.conf`**, overlay **`docker-compose.edge.tls.yml`** y carpeta **`docker/nginx/tls/`** (ver sección siguiente).

## HTTPS (redirección 80 → 443)

1. Copiá la plantilla y ajustá el dominio:

   ```bash
   cp docker/nginx/templates/radioflow-https.conf docker/nginx/conf.d/radioflow-https.conf
   # editá server_name; si no usás Icecast en la misma red, comentá el bloque location /stream
   ```

2. Dejá **un solo** conjunto de `server` para el puerto 80 en `conf.d` (o quitá `radioflow.conf` si pasás todo a la plantilla, para no duplicar `listen 80`).

3. Colocá `fullchain.pem` y `privkey.pem` en `docker/nginx/tls/`.

4. Levantá con el overlay TLS (además del edge que ya montás):

   ```bash
   docker compose -f docker-compose.prod.yml -f docker-compose.edge.prod.yml -f docker-compose.edge.tls.yml --profile edge up -d
   ```

La plantilla usa **`http://api:4000`** (servicio `api` del monorepo), separa **`/api/ws/`** para WebSocket, `try_files` correcto para la SPA y **`X-Forwarded-Proto: https`** para que la API/Fastify pueda construir URLs si lo necesitás más adelante. La documentación OpenAPI queda en **`/api/docs`** (mismo proxy `/api`).

**Icecast**: el `location /stream` asume un contenedor llamado `icecast` en la misma red (perfil **`broadcast`**). Si no lo usás, comentá ese bloque para evitar errores al resolver el upstream.

### Certbot (Let's Encrypt): dos escenarios

1. **Nginx en el host** (VM con `apt install nginx`, no el contenedor del repo): podés usar el plugin oficial que ajusta el `server` de Nginx y las renovaciones.

   ```bash
   sudo DOMAIN=tu.dominio.com EMAIL=tu@correo.com bash scripts/certbot-letsencrypt-host-nginx.sh
   ```

   El script está en `scripts/certbot-letsencrypt-host-nginx.sh` (requiere root). Tras el `certbot --nginx`, alineá tu `server_name` y el proxy hacia la API (puerto local o Docker publicado) según tu despliegue.

2. **Solo Nginx en Docker** (`docker-compose.edge*.yml`): el flag `--nginx` de Certbot **no ve** el binario dentro del contenedor. Opciones habituales:
   - `certbot certonly --standalone` en el host (parando temporalmente el contenedor que use el 80), o **`certonly --webroot`** con un volumen compartido para `/.well-known/acme-challenge/`;
   - copiar `fullchain.pem` y `privkey.pem` a `docker/nginx/tls/` y usar el overlay `docker-compose.edge.tls.yml` con la plantilla `docker/nginx/templates/radioflow-https.conf`.

## Liquidsoap + Icecast

Tu servicio `liquidsoap` + `icecast` encaja con el perfil **`broadcast`** ya existente y el nuevo perfil **`liquidsoap`** en `docker-compose.yml`:

```bash
docker compose --profile broadcast --profile liquidsoap up -d
```

El script de ejemplo empuja a **`/liquidsoap.ogg`** para no pisar el mount típico del encoder (`/stream`). Contraseña por defecto alineada con `RADIOFLOW_ICECAST_SOURCE_PASSWORD` del Compose de desarrollo (default `radioflow_dev`).

Para M3U generados por la API, activá también **`liquidsoap-cron`** y enlazá el volumen `/playlists` como en `docker/liquidsoap/README.md`.

## Seguridad

No uses contraseñas tipo `hackme` en producción: en `docker-compose.prod.yml` Icecast ya exige variables obligatorias en el `.env`.
