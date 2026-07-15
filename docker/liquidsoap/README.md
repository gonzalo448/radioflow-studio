# Liquidsoap (legacy / opt-in)

**Path por defecto de RadioFlow:** encoder FFmpeg → Icecast (`/stream`).  
Liquidsoap es una integración **externa opcional**: la API puede generar M3U; Liquidsoap los reproduce hacia un mount aparte.

No arranca con `docker compose up` normal. No uses el mismo mount que el encoder.

## Archivos

| Archivo | Uso |
|---------|-----|
| `radio.example.liq` | Tono de prueba → `/liquidsoap.ogg` (validar red/credenciales) |
| `radio.playout.liq` | Playout real desde `station-queue.m3u` + `eventos-hoy.m3u` |

## M3U generados (volumen `/playlists`)

| Archivo | Origen |
|---------|--------|
| `station-queue.m3u` | Cola de cabina desde la pista al aire |
| `eventos-hoy.m3u` | Eventos legacy (`Evento`) del día |
| `programacion-{id}.m3u` | Bloques de parrilla (`ProgramacionBlock`) |

Regeneración (solo si activás el stack legacy):

- Cron Docker: perfil `liquidsoap-cron` (cada 2 min por defecto)
- API: `LIQUIDSOAP_M3U_POLL_MS` — **default `0` (apagado)**; p. ej. `120000` para poll cada 2 min
- Manual: `POST /api/liquidsoap/regenerate` (admin/editor)
- HTTP en vivo: `GET /api/liquidsoap/station-queue.m3u` (sin auth; red interna)
- Eventos one-shot: `GET /api/eventos/actual?format=m3u` (rutas resueltas bajo `MEDIA_ROOT`)

## Arranque (dev, opt-in)

```bash
docker compose --profile broadcast --profile liquidsoap --profile liquidsoap-cron up -d
```

- Encoder (default / recomendado): mount `/stream` — perfil `broadcast` solo
- Liquidsoap (legacy): mount `/liquidsoap.ogg` (`LIQUIDSOAP_MOUNT`)
- Contraseña: `RADIOFLOW_ICECAST_SOURCE_PASSWORD` (default `radioflow_dev`)

Para volver al tono de prueba, cambiá el `command` del servicio `liquidsoap` a `radio.example.liq`.
