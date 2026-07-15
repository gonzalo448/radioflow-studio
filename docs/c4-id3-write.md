# C4 — ID3 escritura round-trip

Metadatos de biblioteca pueden **escribirse de vuelta** al archivo MP3 y verificarse releiendo el tag (mismo camino que «Releer ID3»).

Referencias: [architecture.md](./architecture.md) · lectura [RB-033](./radioboss-parity.md) · API biblioteca

---

## Antes / después

| Dirección | Antes | C4 |
|-----------|-------|-----|
| Archivo → DB | `enrichMediaAssetFromAudioFile` / `POST …/sync-from-file` | igual |
| DB → archivo | solo Prisma (PATCH) | `POST …/write-to-file` + `node-id3` |

---

## Campos escritos (MP3)

| Campo catálogo | Frame ID3 |
|----------------|-----------|
| `title` | TIT2 |
| `artist` | TPE1 |
| `album` | TALB |
| `genre` | TCON |
| `releaseYear` | TYER / year |
| `id3Comment` | COMM (`language: spa`) |

Fuera de C4: m4a/flac/ogg, carátula embebida, write masivo.

---

## API

```http
PATCH /api/library/assets/:id
Body: { title?, artist?, album?, genre?, releaseYear?, id3Comment?, … }
→ actualiza solo DB

POST /api/library/assets/:id/write-to-file
→ escribe tags del catálogo al .mp3 → relee (enrich) → respuesta = asset sincronizado
```

Errores típicos: `422` si no es MP3 o es stream remoto; `400` si el archivo no está en vault.

---

## UI

Diálogo **Información de pista** (`MusicLibraryAssetDetailDialog`):

- Inputs **Año** y **Comentario ID3**
- Checkbox «También escribir tags al archivo MP3» al guardar
- Botón **Escribir al archivo** (estado actual del catálogo → disco)
- **Releer ID3** sin cambios (archivo → DB)

---

## Código

| Pieza | Ruta |
|-------|------|
| Write + round-trip | `apps/api/src/lib/id3-write-asset.ts` |
| Lectura | `apps/api/src/lib/id3-enrich-asset.ts` |
| Dependencia | `node-id3` en `@radioflow/api` |
| Tests | `apps/api/src/lib/id3-write-asset.test.ts` |

```bash
npm run test:unit
# o: npm run test -w @radioflow/api -- id3-write-asset
```

---

## Siguiente

**C5** — Cart/hotkeys latencia y pulido desktop → [c5-cart-hotkeys.md](./c5-cart-hotkeys.md).
