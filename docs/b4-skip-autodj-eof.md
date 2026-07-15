# B4 — Skip / AutoDJ refill / fin de archivo

Contrato operativo para no atascar el aire ni reemitir la misma pista.

Referencias: `POST /api/station/skip` · `runAutoDjRefillTick` · encoder `exit:0` · headless playout  
Tests: `npm run test:unit` · smoke profundo `SMOKE_PROMOTE_TO_EDITOR=1`

---

## Skip (API)

- `POST /api/station/skip` poda lo ya sonado (`removePlayedQueueUpTo`) y deja la siguiente en posición `0`.
- Tras el avance, si hay `autoDjActivePlaylistId` (p. ej. tras `queue-from-playlist`), corre AutoDJ refill.
- Marcadores diferidos (`time_announce`, `station_intro`, `jingle_auto`) se resuelven al aterrizar; no cuentan como “pista nueva” hasta expandirse.

Unit: `finishedPositionAfterSkip` en `apps/api/src/lib/station-skip-math.ts`.

---

## AutoDJ refill

| Condición | Comportamiento |
|-----------|----------------|
| Sin playlist activa en estación | no añade |
| `upcoming` (track/voicetrack tras current) ≥ mínimo | no añade |
| `autoDjMinUpcomingTracks === 0` | mínimo efectivo **4** |
| Buffer bajo + playlist con ítems | añade hasta cubrir el gap (cíclico) |

Unit: `apps/api/src/lib/autodj-buffer.ts`. Smoke: tras skip de cola corta, cola ≥ 4.

---

## Fin de archivo (encoder)

1. FFmpeg `exit:0` → **no** reemitir la misma abs (evita bucle).
2. Breve espera (~350 ms) por si Cabina/headless ya hizo skip.
3. Si `nowPlaying` sigue siendo el archivo terminado → `POST /api/station/skip`.
4. Si ya cambió el path → skip omitido (`already_advanced`).

Unit: `apps/encoder/src/eof-skip-policy.ts`.

---

## Headless fin de segmento

Sin cues / `durationSec` / ffprobe usable: gracia **2.5 s** y skip (nunca 240 s inventados).

Unit: `apps/api/src/lib/headless-segment-duration.ts`.

---

## Criterio de cierre B4

- [x] Unitarios API (skip math, AutoDJ buffer, duración headless)
- [x] Unitarios encoder (política EOF / no doble skip)
- [x] Smoke: skip poda + refill ≥ 4 con `SMOKE_PROMOTE_TO_EDITOR=1`
- [ ] Responsable / fecha: ____________
