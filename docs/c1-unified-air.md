# C1 — Motor de aire único (listen-through)

Unifica lo que oye el operador y lo que oyen los oyentes **sin** reescribir un motor nativo.

Referencias: [streaming-encoder-icecast.md](./streaming-encoder-icecast.md) · [architecture.md](./architecture.md) · B4 skip/EOF

---

## Decisión

| Rol | Quién |
|-----|--------|
| Motor de aire | `apps/encoder` (FFmpeg + contrato A1 `PlaySegmentSpec`) → Icecast |
| Monitor en emisión | Cabina **listen-through** del mismo `publicListenUrl` |
| Fallback | Web Audio dual-deck (`CabReferencePlayer`) cuando no hay Emitir/encoder/URL |

Crossfade dual-file FFmpeg (`acrossfade`) = **C1.1** (fuera de alcance: rompe timing de skip).

---

## Contrato API

`GET /api/streaming/broadcast-status` incluye:

| Campo | Uso |
|-------|-----|
| `airPath: "encoder"` | Path productizado |
| `broadcastEnabled` | Interruptor Emitir |
| `publicListenUrl` | Mount para oyentes y Cabina |
| `encoder` | Heartbeat (stale / ffmpegActive) |

Eligibilidad (shared + UI):

`broadcastEnabled && publicListenUrl && encoder !stale && ffmpegActive && monitorMode !== "local"`

---

## Cabina

- Default `monitorMode = air` (localStorage `radioflow.cabina.monitorMode`).
- Toggle en dock: **Monitor = aire** / **Monitor local**.
- En listen-through:
  - No monta `CabReferencePlayer` (no segunda mezcla).
  - No auto-skip por XF / `onEnded` de asset (encoder EOF es soberano; ver B4).
  - Heartbeat con `playing: true` para que headless no compita con el encoder.
- Skip manual (botón / hotkey / comandos de cola) sigue permitido.

Latencia Icecast es **esperada** (~1–5 s típico); no es desfase de mezcla distinta.

---

## Encoder

- Sigue siendo soberano en fin natural (`exit:0` → skip si la cola no avanzó).
- Solape de fundido: `playSegmentCrossfadeOverlapSec` desde `@radioflow/shared` (sin drift con Cabina).

---

## Criterio de cierre C1

- [x] `publicListenUrl` + `airPath` en broadcast-status
- [x] Cabina listen-through + toggle monitor
- [x] Sin auto-skip Web Audio en listen-through
- [x] Encoder usa shared para overlap
- [x] Unitarios (`npm run test:unit`)
- [ ] Responsable / fecha demo con Emitir + Icecast: ____________

---

## Seguimiento

- **C1.1** — acrossfade dual-file
- **C2** — voicetrack bridge también en el stream → [c2-voicetrack-air.md](./c2-voicetrack-air.md)
