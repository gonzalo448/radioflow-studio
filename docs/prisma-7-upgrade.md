# Migración a Prisma 7 (pendiente de épica dedicada)

RadioFlow Studio usa **Prisma 6.19.x** con dual schema (PostgreSQL + SQLite standalone para Electron).

Prisma 7 introduce cambios que afectan a todo `apps/api`:

1. **`prisma.config.ts`** — `DATABASE_URL` sale del `schema.prisma`.
2. **Generator `prisma-client`** — `output` obligatorio; imports dejan de ser `@prisma/client`.
3. **Driver adapters** — `@prisma/adapter-pg` (prod) y `@prisma/adapter-better-sqlite3` (desktop).
4. **`db.ts`** — instanciar `PrismaClient({ adapter })` según dialecto.
5. **CI / Docker** — `prisma generate` explícito tras `migrate` (ya lo hace el build).

## Checklist cuando se aborde

- [ ] Crear `apps/api/prisma.config.ts` y config standalone.
- [ ] Actualizar `generator` en ambos schemas.
- [ ] Sustituir imports `@prisma/client` (~30 archivos).
- [ ] Probar `migrate deploy` + E2E + desktop embebido.
- [ ] Revisar `scheduler-events` advisory lock en SQLite.

Referencia oficial: [Upgrade to Prisma 7](https://www.prisma.io/docs/orm/more/upgrade-guides/upgrading-versions/upgrading-to-prisma-7)

## Revisión de dependencias (P2-08, hecho en v0.2)

- `prisma` / `@prisma/client` → **^6.19.3**
- Ejecutar periódicamente: `npm audit` y `npm audit fix` en la raíz del monorepo.
