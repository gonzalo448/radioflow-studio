# Encoder → Icecast (flujo local y Docker)

Guía mínima para **salir al aire de prueba**: API + biblioteca con audio, **encoder** (`apps/encoder`) y **Icecast 2**.

## 1. Requisitos

- API en marcha con medios en disco (misma ruta que usará el encoder).
- **FFmpeg** instalado en la máquina donde corre el encoder si usas `ENABLE_FFMPEG=1`.
- Puerto **8000** libre (o cambia el mapeo del contenedor).

## 2. Levantar Icecast con Docker Compose (perfil `broadcast`)

En la raíz del monorepo:

```bash
docker compose --profile broadcast up -d icecast
```

Variables por defecto del servicio (ajústalas en `docker-compose.yml` o con override):

- Contraseña de **source**: coherente con la URL del encoder (ej. `radioflow_dev`).
- Estado del servidor: [http://127.0.0.1:8000](http://127.0.0.1:8000) (página por defecto de muchas imágenes).
- Listeners suelen usar el mount **`/stream`** (MP3 desde FFmpeg con `-f mp3`).

Si el encoder corre **en el host** y Icecast en Docker, la URL del host es `127.0.0.1:8000`. Si en el futuro encapsulas el encoder en la misma red Compose, el hostname sería `icecast`.

## 3. Configurar el encoder

Copia `apps/encoder/.env.example` a `apps/encoder/.env` y define:

| Variable | Ejemplo | Notas |
|----------|---------|--------|
| `RADIOFLOW_API_URL` | `http://127.0.0.1:4000` | URL HTTP de la API |
| `RADIOFLOW_MEDIA_ROOT` | Ruta absoluta al directorio igual que `MEDIA_ROOT` de la API | Imprescindible si en BD las rutas son relativas |
| `RADIOFLOW_ICECAST_URL` | `icecast://source:radioflow_dev@127.0.0.1:8000/stream` | Usuario típico `source`; contraseña = `ICECAST_SOURCE_PASSWORD` del contenedor |
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
4. Abre el stream (según tu cliente): URL típica `http://127.0.0.1:8000/stream`

Si Icecast rechaza la fuente, revisa contraseña, mount (`/stream`) y que el contenedor exponga el puerto 8000.

## 6. Incidencias frecuentes

- **`RADIOFLOW_MEDIA_ROOT` vacío**: no se resuelven rutas relativas; el encoder no encontrará el archivo.
- **401 en WebSocket**: algunos despliegues exigen `RADIOFLOW_TOKEN` (JWT rol **dj**+); la lectura de `/api/station` en HTTP puede ser pública según la versión — si el WS falla, alinea el token con la API.
- **Cortes o reconexiones**: el encoder reaplica backoff en el WebSocket; Icecast puede tardar unos segundos en listar la fuente tras el primer connect.

## 7. Producción

Sustituir contraseñas débiles, TLS delante de Icecast o túnel seguro, monitorización de la fuente y límites de clientes en `icecast.xml` (o variables de la imagen Docker que uses).
