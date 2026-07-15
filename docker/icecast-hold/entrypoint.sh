#!/bin/sh
set -e
PASS="${ICECAST_SOURCE_PASSWORD:-radioflow_dev}"
exec ffmpeg -hide_banner -loglevel warning -re \
  -f lavfi -i "sine=frequency=440:sample_rate=44100" \
  -c:a libmp3lame -b:a 128k -content_type audio/mpeg -f mp3 \
  "icecast://source:${PASS}@icecast:8000/stream"
