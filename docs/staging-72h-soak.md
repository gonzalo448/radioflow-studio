# Staging 72 h — soak test (V1-06 / A8)

Checklist y **evidencia** para validar estabilidad prod-like antes de go-live comercial.

Referencias: [release-1.0-runbook.md](./release-1.0-runbook.md) · [validation-checklist.md](./validation-checklist.md) · Camino A (A1–A7) en [architecture.md](./architecture.md)

**Estado del entregable A8:** criterios + script de evidencia listos. Un **PASS firmado** requiere ejecutar el soak real (≥ 72 h) y completar la tabla de cierre abajo (no se marca PASS solo por merge de código).

---

## Arranque

```bash
docker compose -f docker-compose.prod.yml up -d
npm run verify:prod-staging

# Encoder + Icecast (recomendado para V1-06 stream)
docker compose --profile broadcast up -d icecast
# + encoder / Emitir según day-1 y streaming-encoder-icecast.md
```

Panel: instalador / `npm run dev:desktop:embedded`, o `npm run dev:web-ci` solo en CI.

Preflight corto:

```bash
npm run smoke:api
npm run smoke:broadcast:mock
# con Icecast arriba:
npm run smoke:broadcast
npm run backup:desktop:selftest   # o drill:backup en Postgres
```

---

## Objetivo (PASS automático + humano)

| Métrica | Target |
|---------|--------|
| Uptime `GET /api/health/ready` | ≥ **99 %** de muestras en 72 h |
| Reinicios inesperados contenedor `api` | **0** (revisión `docker compose ps` / eventos) |
| Fuente Icecast (`sourceAlert` / sin fuente) | Sin racha &gt; **5 min** (`SOAK_MAX_SOURCE_DOWN_MS`) |
| Encoder + Icecast | Sin caída continua &gt; 5 min mientras Emitir activo |
| Scenarios manuales | Al menos 1× cada ítem (tabla abajo) |
| Backup/restore | Drill firmado ([backup-restore.md](./backup-restore.md)) |
| CI `main` | Build + smoke + E2E verdes |

---

## Observador de evidencia (script)

```bash
# Una muestra (smoke del harness)
npm run soak:sample

# Soak completo 72 h (dejar corriendo en host de staging)
set SOAK_TOKEN=<JWT dj+>          # Windows PowerShell: $env:SOAK_TOKEN="..."
set SOAK_REQUIRE_BROADCAST=1      # exige muestras Icecast/encoder
npm run soak:watch

# Prueba corta (p. ej. 2 min cada 20 s)
# SOAK_DURATION_MS=120000 SOAK_INTERVAL_MS=20000 npm run soak:watch
```

Salida en `logs/soak/` (gitignored salvo `.gitkeep`):

| Archivo | Contenido |
|---------|-----------|
| `soak-<stamp>.jsonl` | Una línea JSON por muestra |
| `soak-summary-<stamp>.json` | Agregado + `pass` / `reasons` |
| `soak-signoff-<stamp>.md` | Plantilla de firma humana |

Criterios del resumen automático (`soak-watch`):

- `uptimeReadyPct` ≥ 99
- racha `sourceAlert.active` &lt; `SOAK_MAX_SOURCE_DOWN_MS` (default 300 000)
- si `SOAK_REQUIRE_BROADCAST=1`, hubo muestras de broadcast-status

El proceso sale **exit 1** si el resumen es FAIL.

Monitoreo manual complementario (cada 4–8 h):

```bash
docker compose -f docker-compose.prod.yml ps
curl -fsS http://127.0.0.1:4000/api/health/ready
docker compose -f docker-compose.prod.yml logs api --since 1h | tail -80
```

---

## Criterios Camino A (durante el soak)

| ID | Qué comprobar | Evidencia sugerida |
|----|---------------|-------------------|
| A1 | Cues/gain/XF: monitor ≈ Icecast | Nota en sign-off; un cambio de pista sin bucle |
| A2 | Solo encoder→Icecast (no Liquidsoap en mismo mount) | `LIQUIDSOAP_M3U_POLL_MS=0`; compose sin perfil liquidsoap |
| A3 | Headless avanza con duración real | Logs `headless_playout` sin gracia interminable |
| A4 | Operador pudo seguir día-1 | Checklist [day-1-runbook.md](./day-1-runbook.md) |
| A5 | `smoke:broadcast` OK al inicio | Log CI o local |
| A6 | Backup/restore drill | `drill:backup` / `backup:desktop` + verify |
| A7 | Alerta fuente si se fuerza caída &gt; umbral | play-log `icecast_source_down` (prueba controlada opcional) |

---

## Escenarios manuales (al menos 1×)

- [ ] Login → cabina → play / pause / skip
- [ ] Crear playlist y cargar cola
- [ ] Subir pista a biblioteca
- [ ] Moderar pedido web (`/requests`)
- [ ] Reinicio: `docker compose -f docker-compose.prod.yml restart api` → sesión recupera
- [ ] Backup: `npm run drill:backup` (y restore en staging si aplica)
- [ ] Escucha externa del mount Icecast estable

---

## Criterio de cierre (firma release)

Adjuntá el `soak-summary-*.json` con `"pass": true` y el `soak-signoff-*.md` firmado.

| Campo | Valor |
|-------|-------|
| Fecha inicio | ____________ |
| Fecha fin | ____________ |
| Responsable | ____________ |
| Summary JSON | `logs/soak/soak-summary-____.json` |
| Resultado automático | ☐ PASS / ☐ FAIL |
| Resultado firmado V1-06 | ☐ PASS / ☐ FAIL |
| Notas | |

---

## Tag release (post-soak PASS)

Cuando soak + checklist manual + CI `main` estén ✅:

```bash
git tag -a v1.0.0 -m "RadioFlow Studio 1.0.0"
git push origin v1.0.0
```

Ver [CHANGELOG.md](../CHANGELOG.md).
