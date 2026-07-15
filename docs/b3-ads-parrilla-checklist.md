# B3 — Parrilla + publicidad (flujo validado)

Checklist para **grabar/demo** el flujo operator: parrilla → apply → ads break → cabina.

Referencias: [day-1-runbook.md](./day-1-runbook.md) · UI `/schedule` · `/ads` · `/station`  
Smoke API (CI / staging): `SMOKE_PROMOTE_TO_EDITOR=1` incluye schedule + ads break.

---

## Precondiciones

- [ ] Login **editor** o **admin** (crear bloques) / **dj+** (apply y break)
- [ ] Playlist con ≥ 2 pistas en bóveda
- [ ] Al menos 1 audio usable bajo el prefijo de spots (default `publicidad/`, o el configurado en `/ads`)
- [ ] Cabina con cola sonando (o al menos pista al aire) en `/station`
- [ ] Desktop: workers ON (B2) no es obligatorio para este demo manual

---

## Guion grabable (≈ 5–8 min)

| # | Acción | Criterio PASS |
|---|--------|---------------|
| 1 | Abrir **Parrilla** (`/schedule`) | Página carga; se ven bloques del día |
| 2 | Crear bloque: **día = hoy**, inicio/fin que **cubran el minuto actual**, playlist asociada | Bloque aparece en “Hoy / activos” |
| 3 | **Aplicar bloque activo ahora** (reemplazar cola) | Mensaje OK; cola de estación = playlist del bloque |
| 4 | Ir a **Cabina** (`/station`) | Se oye / ve la música de la parrilla |
| 5 | Abrir **Publicidad** (`/ads`) o menú **Lista → Planificador…** | Catálogo de spots no vacío |
| 6 | **Insertar bloque ahora** (o **Lista → Insertar bloque publicitario ahora**) | N spots encolados *después* de la pista al aire |
| 7 | En Cabina: esperar fin o skip | Se oye el comercial tras la pista actual |

### Atajos de menú (B3)

- **Lista → Insertar bloque publicitario ahora** — `POST /api/ads/break`
- **Lista / Herramientas → Planificador de publicidad…** — `/ads`
- Barra web: ítem **Publicidad** junto a Parrilla

---

## Fallos frecuentes

| Síntoma | Qué hacer |
|---------|-----------|
| `no_active_block` | Ampliar ventana del bloque (hora actual dentro de inicio–fin) |
| `No hay spots` / 400 | Subir MP3 a carpeta `publicidad/` o cambiar `pathPrefix` en `/ads` |
| Break no se oye | Confirmar que hay pista al aire; el break va **después**, no al instante |
| Ads auto no dispara | Tick solo si `enabled` y estación **no** en modo LIVE; demo usa **Insertar ahora** |
| Apply no cambia cola | Rol insuficiente; o `force` / replace en UI |

---

## Criterio de cierre B3

- [ ] Guion completo ejecutado 1× (idealmente con grabación de pantalla)
- [ ] Smoke: `SMOKE_PROMOTE_TO_EDITOR=1` verde (incluye apply-active + ads/break)
- [ ] Responsable / fecha: ____________

---

## Qué no exige B3

- Motor nativo único (C1)
- Soak 72 h (A8) — checklist aparte
- E2E Playwright con audio (frágil)
