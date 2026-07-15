# Encoder → Icecast (flujo local y Docker)

Guía mínima para **salir al aire de prueba**: API + biblioteca con audio, **encoder** (`apps/encoder`) y **Icecast 2**.

Para el checklist de **operador día-1** (instalador → biblioteca → Emitir), ver **[day-1-runbook.md](./day-1-runbook.md)**.

## Alerta fuente Icecast (A7)

Con **Emitir activo** (`broadcastEnabled`) la API (modo `maintenance` / `full`) consulta `status-json.xsl` cada `ICECAST_SOURCE_ALERT_POLL_MS` (default 60 s).

Si la fuente del mount está caída **más de** `ICECAST_SOURCE_ALERT_AFTER_MS` (default **3 min**):

1. Entrada en play-log / informes: `icecast_source_down` (y `icecast_source_recovered` al volver).
2. Estado en `GET /api/streaming/broadcast-status` → `sourceAlert`.
3. Opcional: `POST` JSON a `ICECAST_SOURCE_ALERT_WEBHOOK_URL`.

Cooldownactivado con `ICECAST_SOURCE_ALERT_POLL_MS=0`. Silencio en el bus de Cabina sigue siendo `air_silence` (monitor local); A7 cubre el **aire público** sin UI abierta.

## Smoke broadcast (A5)

Script que **falla** si no hay audio usable hacia el oyente:

```bash
# Sin Icecast: filtros PlaySegment (atrim/afade/volume) + libmp3lame
npm run smoke:broadcast:mock

# Con Icecast del repo (perfil broadcast, puerto host por defecto 8000):
docker compose --profile broadcast up -d icecast
npm run smoke:broadcast
# Variables: SMOKE_ICECAST_PORT / RADIOFLOW_ICECAST_PUBLISH_PORT, SMOKE_ICECAST_PASSWORD, …
```

En CI: job `smoke-broadcast` (mock + FFmpeg→`/stream`).

## Path por defecto (A1) + monitor unificado (C1)

**Salida al oyente por defecto** = `apps/encoder` → Icecast/Shoutcast/AzuraCast.

- El encoder recibe `playSegment` / `nowPlayingInfo.playSegment` vía `GET /api/station` y WebSocket `/api/ws/station`.
- Aplica el **mismo contrato** que Cabina: `cueStartSec` / `cueEndSec` (`atrim`), fade-in/out (`afade` según `cabCrossfadeSec`), ganancia (`volume=` = `cabReferenceGainDb` + `playbackGainDb`). Solape: `@radioflow/shared` `playSegmentCrossfadeOverlapSec`.
- Al terminar el archivo (exit 0) **no reemite** la misma pista; pide skip si la cola no avanzó.
- **C1:** con Emitir activo y encoder vivo, Cabina hace **listen-through** de `publicListenUrl` (mismo mount). Ver [c1-unified-air.md](./c1-unified-air.md).
- **C2:** si la cola es canción→voicetrack→canción, el encoder mezcla el VT sobre el outro (`voiceTrackOverlay` + FFmpeg `amix`). Ver [c2-voicetrack-air.md](./c2-voicetrack-air.md).
- **Liquidsoap** (M3U / cron) es **legacy / opcional** para stacks externos; no es el camino documentado para el producto instalable ni para “monitor ≈ oyente”.
- Contenedores: perfiles Compose `liquidsoap` / `liquidsoap-cron` (no arrancan con `up` normal).
- Poll in-API: `LIQUIDSOAP_M3U_POLL_MS` default **0** (A2).

## Metadatos y panel de emisión (Fase 4)

- El **encoder** envía `title` / `artist` a FFmpeg (`-metadata`) según la pista al aire en cabina, y hace **heartbeat** a `POST /api/streaming/encoder-heartbeat` (requiere `RADIOFLOW_TOKEN` con rol dj+). El heartbeat incluye también `assetId`, `album`, `coverUrl` y `stationLogoUrl` cuando la cabina los conoce.
- **`GET /api/public/now-playing`** (sin autenticación) devuelve título, artista, álbum, URL de carátula (`/api/library/assets/:id/cover` o logo de estación) y `startedAt`. Pensado para widgets web y apps propias del cliente.
- **Sidecar E1.3:** al cambiar pista se escribe `{MEDIA_ROOT}/nowplaying/nowplaying.json` y `current-cover.jpg`. URLs HTTP: **`GET /api/public/nowplaying.json`** y **`GET /api/public/current-cover.jpg`** (también servibles por Nginx como estáticos si montás esa carpeta).
- **`GET /api/station`** y el WebSocket `/api/ws/station` incluyen `nowPlayingInfo` con las mismas URLs absolutas.
- **Metadatos Icecast (E1.4):** con `RADIOFLOW_ICECAST_METADATA=1` el encoder llama a `/admin/metadata?mode=updinfo&song=…` usando `RADIOFLOW_ICECAST_ADMIN_USER` / `RADIOFLOW_ICECAST_ADMIN_PASSWORD` (en Docker dev: `radioflow_admin_dev`). Opcional `RADIOFLOW_ICECAST_METADATA_URL=1` envía `url=` con la carátula (Icecast KH).
- La UI en **Streaming** y el inicio muestran `GET /api/streaming/broadcast-status`: estado del encoder, oyentes Icecast (`status-json.xsl`), carátula al aire y enlace de escucha del destino activo en Marca.
- Variable opcional **`PUBLIC_API_BASE_URL`** (origen público sin barra final) para URLs absolutas correctas detrás de Nginx o en producción.
- Con Docker Compose, definí `RADIOFLOW_TOKEN` en el `.env` de la raíz **o** ejecutá `npm run broadcast:prepare` tras tener la API en marcha: el script hace login de admin y pasa el JWT al levantar el servicio `encoder`.

## Qué Icecast usar (definición del proyecto)

**El Icecast de Radioflow Studio** es **solo** el servicio Docker **`icecast`** de este repositorio (`docker-compose.yml`, perfil **`broadcast`**, imagen **`infiniteproject/icecast:latest`**). Contraseña de fuente por defecto **`radioflow_dev`**, definida en Compose con **`RADIOFLOW_ICECAST_SOURCE_PASSWORD`** (en el `.env` raíz; no uses variables genéricas `ICECAST_*` en el mismo shell, suelen pisarse con valores cortos tipo `a`/`b` y el encoder no conecta → el mount `/stream` no existe → **404** al escuchar).

- **No** mezclar con otros Icecast que tengas en Docker (p. ej. otro proyecto que publique `8001→8000`) salvo que configures **explícitamente** la misma URL y credenciales en el encoder; ese no es el flujo documentado aquí.
- **Puerto en tu máquina**: por defecto **`8000`** mapeado al 8000 del contenedor. Si ese puerto está ocupado (en Windows a veces por otro programa), definí en el **`.env` de la raíz del repo** `RADIOFLOW_ICECAST_PUBLISH_PORT=8840` (u otro libre) y usá **`127.0.0.1:8840`** en el navegador y en `RADIOFLOW_ICECAST_URL` del encoder. Tras un intento fallido de `docker compose up`, podés borrar el contenedor en estado *Created* y volver a crearlo: `docker compose rm -f icecast`.

## 1. Requisitos

- API en marcha con medios en disco (misma ruta que usará el encoder).
- **FFmpeg** instalado en la máquina donde corre el encoder si usas `ENABLE_FFMPEG=1`.
- Un puerto **libre en el host** para Icecast: el que elijas con `RADIOFLOW_ICECAST_PUBLISH_PORT` (por defecto **8000**).

## 2. Levantar Icecast con Docker Compose (perfil `broadcast`)

En la raíz del monorepo:

```bash
docker compose --profile broadcast up -d icecast
```

Opcional — **fuente de prueba en `/stream`** (tono continuo; deja de dar 404 al abrir el mount hasta que uses el encoder real):

```bash
docker compose --profile broadcast up -d icecast-hold
```

Pará `icecast-hold` (`docker compose stop icecast-hold`) antes de publicar con el **encoder** al mismo mount `/stream`, o solo uno quedará conectado.

Variables por defecto del servicio (ajústalas en `docker-compose.yml` o con override):

- Contraseña de **source**: coherente con la URL del encoder (ej. `radioflow_dev`).
- **Puerto publicado**: `RADIOFLOW_ICECAST_PUBLISH_PORT` (default **8000**). Estado del servidor: `http://127.0.0.1:<PUERTO>/` (página por defecto de muchas imágenes).
- Listeners suelen usar el mount **`/stream`** (MP3 desde FFmpeg con `-f mp3`).

Si el encoder corre **en el host** y Icecast en Docker, la URL del host es `127.0.0.1:<PUERTO>` (mismo `<PUERTO>` que arriba). Si en el futuro encapsulas el encoder en la misma red Compose, el hostname sería `icecast` y el puerto **interno** sigue siendo **8000**.

## 3. Configurar el encoder

Copia `apps/encoder/.env.example` a `apps/encoder/.env` y define:

| Variable | Ejemplo | Notas |
|----------|---------|--------|
| `RADIOFLOW_API_URL` | `http://127.0.0.1:4000` | URL HTTP de la API |
| `RADIOFLOW_MEDIA_ROOT` | Ruta absoluta al directorio igual que `MEDIA_ROOT` de la API | Imprescindible si en BD las rutas son relativas |
| `RADIOFLOW_ICECAST_URL` | `icecast://source:radioflow_dev@127.0.0.1:8000/stream` (o `:8840/...` si usás `RADIOFLOW_ICECAST_PUBLISH_PORT=8840`) | Opcional si usas **destino activo** en Marca + `RADIOFLOW_TOKEN` (el encoder llama a `GET /api/streaming/encoder-url`). Si defines esta variable, **tiene prioridad** sobre la API. |
| `RADIOFLOW_ICECAST_REFRESH_MS` | `120000` | Si no hay `RADIOFLOW_ICECAST_URL`, reconsulta la URL en la API cada N ms. |
| `RADIOFLOW_TOKEN` | JWT (rol **dj** o superior) | Necesario para resolver la URL de salida desde la API. |
| `ENABLE_FFMPEG` | `0` luego `1` | Primero comprueba logs; con `1` lanza FFmpeg |

Flujo interno:

1. El encoder recibe el estado de la emisora por **WebSocket** (`/api/ws/station`) o por polling.
2. Resuelve la ruta del archivo con `RADIOFLOW_MEDIA_ROOT`.
3. Con `ENABLE_FFMPEG=1`, ejecuta FFmpeg en modo **icecast** (libmp3lame, 192 kbit/s en el código actual).

## 4. Probar sin FFmpeg (recomendado al principio)

Deja `ENABLE_FFMPEG=0` (o sin definir). Deberías ver en consola el **comando FFmpeg sugerido** y mensajes al cambiar de pista en la estación. Así validas API + WS + rutas antes de codificar.

## 5. Probar con FFmpeg

1. Pon una pista **al aire** desde el panel (cola + reproducción / posición actual con archivo existente).
2. `ENABLE_FFMPEG=1`
3. `npm run dev:encoder` (o `npm run start -w @radioflow/encoder`)
4. Abre el stream (según tu cliente): URL típica `http://127.0.0.1:<PUERTO>/stream` (mismo puerto host que Icecast).

Si Icecast rechaza la fuente, revisa contraseña, mount (`/stream`) y que el mapeo de puertos del compose coincida con la URL del encoder (puerto publicado en el host: por defecto **8000** o el valor de `RADIOFLOW_ICECAST_PUBLISH_PORT`).

## 6. Incidencias frecuentes y reconexión FFmpeg

- **`RADIOFLOW_MEDIA_ROOT` vacío**: no se resuelven rutas relativas; el encoder no encontrará el archivo.
- **401 en WebSocket**: algunos despliegues exigen `RADIOFLOW_TOKEN` (JWT rol **dj**+); la lectura de `/api/station` en HTTP puede ser pública según la versión — si el WS falla, alinea el token con la API.
- **Cortes o reconexiones**: el encoder reaplica backoff en el WebSocket; Icecast puede tardar unos segundos en listar la fuente tras el primer connect.
- **FFmpeg cae pero la pista sigue igual** (Icecast reiniciado, red intermitente): con `ENABLE_FFMPEG=1`, el proceso **reintenta** solo mientras no cambie la pista actual. Variables: `RADIOFLOW_FFMPEG_RESTART_BASE_MS`, `RADIOFLOW_FFMPEG_RESTART_MAX_MS`, `RADIOFLOW_FFMPEG_RESTART_MAX_ATTEMPTS` (0 = sin tope), `RADIOFLOW_FFMPEG_KILL_AFTER_MS` (SIGKILL tras SIGTERM).
- **Mismo archivo terminó bien** (`exit 0`): el encoder repite la pista tras `RADIOFLOW_FFMPEG_LOOP_DELAY_MS` (default 800 ms) con el log *Reproduciendo de nuevo la misma pista*, sin acumular backoff de error.
- **Operación**: `GET /api/health/meta` incluye `streamingEncoder.activeStreamingTargetId` y si el destino sigue **habilitado** (sin contraseñas), útil para comprobar que Marca + destino están listos antes de arrancar el encoder.

### 6.1. Prueba operativa: cortar Icecast y ver backoff en logs

Objetivo: con **API + encoder** (`ENABLE_FFMPEG=1`) y una pista al aire, simular caída de Icecast y comprobar que el encoder **reintenta** con **backoff** hasta que vuelva el mount.

1. **Icecast** de este repo (perfil `broadcast`), con el **puerto host** que configuraste (`RADIOFLOW_ICECAST_PUBLISH_PORT` o **8000** por defecto):

   ```bash
   docker compose --profile broadcast up -d icecast
   ```

2. **API** y **encoder** según §3 y §5 (token, `RADIOFLOW_MEDIA_ROOT`, destino Icecast coherente con la contraseña de fuente del contenedor: default **`radioflow_dev`** o el valor de `RADIOFLOW_ICECAST_SOURCE_PASSWORD` en el `.env` raíz).

3. Con audio estable en el mount (`http://127.0.0.1:<PUERTO>/stream`), **para Icecast** unos segundos (sin tocar el encoder):

   ```bash
   docker compose stop icecast
   ```

   Esperá **5–15 s** y volvé a levantarlo:

   ```bash
   docker compose start icecast
   ```

4. En la consola del encoder deberían aparecer, en orden típico:

   - `FFmpeg terminó code=…` (o `FFmpeg error` con mensaje de conexión rechazada / broken pipe).
   - Una o más líneas **`FFmpeg: reinicio en …ms (intento N, …)`** — el delay sube según backoff hasta `RADIOFLOW_FFMPEG_RESTART_MAX_MS`.
   - Tras volver Icecast: **`FFmpeg lanzando`** y el stream otra vez en el admin de Icecast.

   Si no ves `reinicio en`, revisá que `ENABLE_FFMPEG=1`, que FFmpeg esté en el `PATH`, y que la pista **no haya cambiado** (un cambio de pista cancela el timer de reinicio).

5. Si el puerto por defecto ya está en uso (`bind: … permitted`), poné `RADIOFLOW_ICECAST_PUBLISH_PORT` en el `.env` raíz (p. ej. **8840**), `docker compose rm -f icecast` si quedó *Created*, volvé a `up -d icecast` y alineá la URL del encoder y el destino en Marca.

## 7. Producción

Sustituir contraseñas débiles, TLS delante de Icecast o túnel seguro, monitorización de la fuente y límites de clientes en `icecast.xml` (o variables de la imagen Docker que uses).
