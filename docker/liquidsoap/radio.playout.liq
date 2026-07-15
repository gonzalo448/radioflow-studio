# Playout desde M3U generados por RadioFlow API (perfil liquidsoap-cron).
# Requiere volumen /playlists (station-queue.m3u) y /media (solo rutas locales).
#
# Variables opcionales:
#   ICECAST_HOST (default icecast)
#   ICECAST_PORT (default 8000)
#   ICECAST_SOURCE_PASSWORD (default radioflow_dev)
#   LIQUIDSOAP_MOUNT (default liquidsoap.ogg)

password = getenv("ICECAST_SOURCE_PASSWORD", "radioflow_dev")
host = getenv("ICECAST_HOST", "icecast")
port = int_of_string(default=8000, getenv("ICECAST_PORT", "8000"))
mount = getenv("LIQUIDSOAP_MOUNT", "liquidsoap.ogg")

set("log.stdout", true)
set("init.allow_root", true)

# Recarga al cambiar station-queue.m3u (cron API cada ~2 min recomendado)
queue = playlist(
  "/playlists/station-queue.m3u",
  reload_mode="watch",
  mode="normal"
)

# Eventos one-shot del día (manifest estático; Liquidsoap no evalúa hora)
eventos = playlist(
  "/playlists/eventos-hoy.m3u",
  reload_mode="watch",
  mode="normal"
)

# Prioridad: cola cabina; si vacía, eventos del día; si no, silencio seguro
src = fallback(track_sensitive=false, [queue, eventos, blank()])
safe = mksafe(normalize(src, target=-16.0, threshold=-40.0))

output.icecast(
  %vorbis,
  host=host,
  port=port,
  password=password,
  mount=mount,
  name="RadioFlow Liquidsoap",
  description="Playout M3U desde API",
  safe
)
