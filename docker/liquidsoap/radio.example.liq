# Ejemplo mínimo: tono de prueba hacia Icecast (infallible).
# Mont: http://<host>:8000/liquidsoap.ogg — no choca con /stream del encoder típico.
# Contraseña alineada con RADIOFLOW_ICECAST_SOURCE_PASSWORD (default radioflow_dev) en docker-compose.yml.
# Sustituí por playlist(/playlists/*.m3u) cuando el cron genere M3U en el volumen compartido.

output.icecast(
  %vorbis,
  host = "icecast",
  port = 8000,
  password = "radioflow_dev",
  mount = "liquidsoap.ogg",
  sine()
)
