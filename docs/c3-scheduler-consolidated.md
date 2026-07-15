# C3 — Scheduler consolidado (sin legacy compitiendo)

Un solo camino aplica la **parrilla de producto** (`ScheduleBlock`) a la cola de estación. Liquidsoap / `ProgramacionBlock` quedan legacy opt-in.

Referencias: [architecture.md](./architecture.md) · [b3-ads-parrilla-checklist.md](./b3-ads-parrilla-checklist.md) · encoder [streaming-encoder-icecast.md](./streaming-encoder-icecast.md)

---

## Path canónico

```text
ScheduleBlock (/schedule, /api/schedule)
  → apply-active | tick interno | schedule-worker
  → syncQueueFromPlaylist (cola estación)
  → encoder → Icecast
```

| Pieza | Rol |
|-------|-----|
| Datos | Solo `ScheduleBlock` |
| Apply | **Uno** de: tick API (`INTERNAL_SCHEDULE_POLL_MS`) **o** `@radioflow/schedule-worker` **o** manual `POST /schedule/apply-active` |
| Aire | Cola → encoder (no Liquidsoap en el mismo mount) |

---

## Modos (`SCHEDULE_APPLY_MODE`)

| Valor | Efecto |
|-------|--------|
| `auto` (default) | Si `SCHEDULE_WORKER_EXPECTED=1` → worker; else si poll>0 → internal; else off |
| `internal` | Tick en API si `INTERNAL_SCHEDULE_POLL_MS>0` |
| `worker` | Poll interno **forzado a 0** (gana el worker externo) |
| `off` | Sin aplicador automático |

`SCHEDULE_WORKER_EXPECTED=1` + poll interno >0 → **conflicto resuelto**: gana worker, poll efectivo 0 + warn en log.

Estado en `GET /api/health/meta` → `schedule.{ applyMode, internalPollMsEffective, conflictResolved, liquidsoapM3uPollMs }`.

---

## Despliegues

### Todo-en-uno / desktop (recomendado producto)

```bash
API_BACKGROUND_MODE=full
INTERNAL_SCHEDULE_POLL_MS=60000   # o el valor que uses
SCHEDULE_APPLY_MODE=auto          # o internal
SCHEDULE_WORKER_EXPECTED=0
LIQUIDSOAP_M3U_POLL_MS=0
```

### Workers separados

```bash
# API
API_BACKGROUND_MODE=maintenance   # o http-only si library-worker aparte
INTERNAL_SCHEDULE_POLL_MS=0
SCHEDULE_APPLY_MODE=worker
SCHEDULE_WORKER_EXPECTED=1

# schedule-worker
RADIOFLOW_API_URL=...
RADIOFLOW_TOKEN=...               # dj+
SCHEDULE_POLL_MS=20000
```

Compose perfil `workers`: documentado en `docker-compose.yml` junto al servicio `schedule-worker`.

---

## Legacy (no compite si está off)

| Pieza | Default | Notas |
|-------|---------|-------|
| `LIQUIDSOAP_M3U_POLL_MS` | 0 | M3U desde `ProgramacionBlock` |
| Perfiles Compose `liquidsoap` / `liquidsoap-cron` | opt-in | No Day-1 |
| `/api/programacion` | vivo | Solo stack Liquidsoap; UI redirige a `/schedule?legacy=programacion` |

---

## Lo que no es “segundo scheduler de parrilla”

Siguen siendo features de cabina (pueden tocar la cola como overlays):

- Scheduler events (`SCHEDULER_EVENTS_POLL_MS`)
- AutoDJ refill (append buffer)
- Ads / jingles / headless

No deben usarse como sustituto de `ScheduleBlock`.

---

## Criterio de cierre C3

- [x] Mutex worker ↔ internal (`resolveScheduleApplyMode`)
- [x] `health/meta.schedule` + docs Compose
- [x] Unitarios + smoke meta
- [ ] Responsable / fecha: ____________
