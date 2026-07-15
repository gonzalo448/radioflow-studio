# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es/1.0.0/).

## [1.0.0] - 2026-06-29

### Added

- Runbook de producción v1.0 (`docs/release-1.0-runbook.md`).
- Spike **pgvector**: migración `20260701120000_pgvector_embedding`, búsqueda `<=>` en PostgreSQL.
- Job de cola **`semantic_enrich`** para enrich masivo vía Ollama + pgvector.
- Scripts operativos: `prod-staging-verify.mjs`, `prod-backup-restore-drill.mjs`, `ci-verify-jwt-secret.mjs`, `ci-verify-npm-audit.mjs`.
- CI: Postgres `pgvector/pgvector:pg16`, smoke post-migrate, auditoría JWT ≥ 32 chars en prod, **npm audit 0 critical**.
- Backfill pgvector: job `pgvector_backfill` + `npm run pgvector:backfill`.
- Guía soak 72 h: `docs/staging-72h-soak.md`.
- Script `dev:panel-prod` para panel contra API Docker.

### Changed

- Versión monorepo alineada a **1.0.0**.
- `docker-compose.prod.yml`: imagen pgvector, `BOOTSTRAP_LOCAL_ADMIN=0` explícito.
- `loadEnv()`: rechaza `JWT_SECRET` &lt; 32 en `NODE_ENV=production`.
- `GET /api/semantic/status` expone `pgvectorEnabled` y `pgvectorBackfillPending`.

### Security

- Bootstrap de admin local desactivado por defecto en compose prod.
- Validación de longitud mínima de JWT en runtime prod y CI.

## [0.2.0] - 2026-06 (pre-release)

Roadmap P0–P3: cabina, scheduler, pedidos web, búsqueda semántica (RAM), desktop Electron, informes, TTS, Redis pub/sub WS, render playlist, etc.

[1.0.0]: https://github.com/radioflow/radioflow-studio/compare/v0.2.0...v1.0.0
