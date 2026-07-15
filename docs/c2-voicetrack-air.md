# C2 — Voicetrack bridge en el aire

La locución (voicetrack) solapa el outro de la canción **también en Icecast**, no solo en Web Audio de Cabina.

Referencias: [c1-unified-air.md](./c1-unified-air.md) · A1 `PlaySegmentSpec` · encoder FFmpeg

---

## Problema

Tras C1 (listen-through), el operador oye el mount público. El bridge VT de Cabina (`CabReferencePlayer`) **no** alimenta el stream → el oyente oía track→VT→track en secuencia seca.

## Solución

1. **API** calcula `voiceTrackOverlay` en `enrichStationState` cuando la cola es `track → voicetrack → track` (`buildVoiceTrackOverlaySpec` en `@radioflow/shared`).
2. **Encoder** lanza FFmpeg con **2 inputs** (música + VT): `atrim`/`afade`/`volume` + duck en outro + `adelay` + `amix=duration=first`.
3. Al **EOF** del mix: **2 skips** (A + VT) y se suprime el spawn del VT suelto hasta la siguiente música.

Kill switch: `VOICE_TRACK_BRIDGE_AIR=0`. Duck: `VOICE_TRACK_AIR_DUCK_DB` (default 12).

---

## Contrato `voiceTrackOverlay`

| Campo | Rol |
|-------|-----|
| `voiceTrackPath` / `voiceTrackGainDb` | Archivo VT |
| `overlayAtSec` | Inicio del VT relativo al segmento recortado |
| `duckDb` | Atenuación positiva de la cama |
| `nextMusicAssetId` | Destino tras EOF |
| `skipCountOnEnd: 2` | Avance de cola |

Presencia en `GET /api/station` y WS `station` (mismo enrich).

---

## Cabina

- Planning Web Audio reutiliza `planVoiceTrackBridge` shared (solo si **no** listen-through).
- Con listen-through: oye el overlay del encoder (sin segunda mezcla local).

---

## Criterio de cierre

- [x] Spec + unitarios shared / encoder filter
- [x] Encoder overlay + doble skip
- [x] Docs enlazadas
- [ ] Demo Emitir: cola canción–VT–canción oída en el mount: ____________

## Fuera de alcance

- Acrossfade A→B dual-file (C1.1)
- Sync de `bridgeEnabled` localStorage → settings server (aire usa patrón de cola + env)
