# C5 — Cart / hotkeys: latencia y pulido desktop

El cart wall (RB-082/083) ya disparaba teclas 1–0; C5 reduce la latencia **percibida** al aire y el roce en escritorio.

Referencias: [radioboss-parity.md](./radioboss-parity.md) · [c1-unified-air.md](./c1-unified-air.md) · encoder [streaming-encoder-icecast.md](./streaming-encoder-icecast.md)

---

## Path (sin cambios de arquitectura)

```text
Tecla 1–0 (Electron globalShortcut | navegador | botón)
  → POST /api/jingles/fire { slotKey, pageKey, playNow? }
  → fireJingleSlot → cola estación
  → WS station → encoder → Icecast
```

No hay playout local del jingle: el aire sigue siendo **encoder → Icecast**.

---

## Latencia producto

| Antes | C5 |
|-------|-----|
| Solo `playNext` (suena tras EOF de lo actual) | **`playNow`** (default UI/hotkeys): inserta como siguiente + **skip** si había pista al aire |
| Cliente hacía `await refresh()` (GET /station) tras fire | Confía en **WebSocket** `broadcastStationState` |
| Hotkey + keydown en `/jingles` en desktop = doble fire | En Electron **solo** IPC; debounce ~280–350 ms |
| Errores hotkey silenciosos | Toast `CartFireToast` + evento `radioflow-cart-fired` |

API:

```http
POST /api/jingles/fire
{ "slotKey": "1", "pageKey": "A", "playNow": true }
```

- `playNow: true` → playNext + skip si hay aire; si cola idle → `currentPosition = 0`
- Sin `playNow` / solo `playNext` → comportamiento histórico RB-084 (encola tras aire)

Preferencia local: `radioflow_cart_fire_play_now` (checkbox en `/jingles`).

---

## Pulido desktop

- Debounce en `electron-main.cjs` al enviar `radioflow:cart-key`
- Invalidación de caché de ranuras: `radioflow-jingle-slots-changed` tras PUT
- Toast global visible fuera de `/jingles`

---

## Código clave

| Pieza | Ruta |
|-------|------|
| Modo fire | `apps/api/src/lib/jingle-fire-mode.ts` |
| Fire + skip | `apps/api/src/lib/fire-jingle-slot.ts` |
| Hotkeys | `apps/web/src/hooks/useGlobalCartHotkeys.ts` |
| Prefs | `apps/web/src/lib/cart-fire-prefs.ts` |
| Toast | `apps/web/src/components/jingles/CartFireToast.tsx` |

```bash
npm run test -w @radioflow/api -- src/lib/jingle-fire-mode.test.ts
```

---

## Criterio de cierre C5

- [x] `playNow` en API + default en UI/hotkeys
- [x] Sin GET /station extra tras fire
- [x] Anti doble-fire desktop + debounce
- [x] Feedback visible de éxito/error
- [x] Unitarios de política + docs

## Fuera de C5

- Overlay VT-style del cart sobre aéreo (sin cortar)
- Playout local/IPC sin API
- Cambiar accelerators a Modifier+digit (sigue siendo 1–0 estilo RadioBOSS)
