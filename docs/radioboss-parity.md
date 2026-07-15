# Paridad RadioBOSS — RadioFlow Studio

Documento de referencia para **producto y desarrollo**: compara la funcionalidad de [RadioBOSS](https://www.djsoft.net/enu/description_radioboss.htm) (manual parte VI — menús y operación) con lo implementado en **RadioFlow Studio** a la fecha.

**Uso como backlog:** cada fila tiene un ID (`RB-xxx`). Marcá `- [x]` en la columna de backlog cuando el ítem esté cerrado en producto. Actualizá la columna **Estado** al fusionar cambios.

**Código de referencia UI:** menús en `apps/web/src/layout/RadioflowTopMenuBar.tsx`.

---

## Leyenda de estado

| Símbolo | Significado |
|---------|-------------|
| ✅ | **Implementado** — usable en producción para el caso habitual |
| 🟡 | **Parcial** — existe equivalente limitado, solo API, solo UI, o comportamiento distinto |
| ❌ | **No** — sin implementar o solo placeholder |
| ➖ | **N/A** — no aplica al modelo RadioFlow (decisión de independencia) |
| 🔮 | **Diferenciador** — no existe en RadioBOSS; se mantiene como valor propio |

---

## Resumen por área (actualizado v0.2)

| Área | ✅ | 🟡 | ❌ / 🔮 | Cobertura aprox. |
|------|----|----|---------|------------------|
| Menú Archivo | 9 | 0 | 0 | **100 %** |
| Menú Edición | 10 | 0 | 0 | **100 %** |
| Menú Vista | 18 | 0 | 0 | **100 %** |
| Menú Lista | 24 | 0 | 0 | **100 %** |
| Menú Herramientas | 14 | 0 | 2 🔮 | **88 %** |
| Menú Jingles | 5 | 0 | 0 | **100 %** |
| Menú Configuración | 6 | 0 | 0 | **100 %** |
| Menú Ayuda / Usuario | 5 | 0 | 1 ➖ | **100 %** |
| Cabina / Player | 9 | 0 | 1 🔮 | **90 %** |
| Scheduler y eventos | 9 | 0 | 0 | **100 %** |
| Streaming y metadatos | 6 | 0 | 0 | **100 %** |
| Diferenciadores RadioFlow (RF) | 1 | 0 | 7 🔮 | **13 %** *(valor propio, no paridad RB)* |
| **Paridad RadioBOSS (RB inventariados)** | **~105** | **0** | **~4** | **~97 %** |
| **Producto integral estimado** | — | — | — | **~82 %** |

> **Nota:** Los ítems 🔮 (pedidos web, búsqueda semántica, WS remoto avanzado) son capacidades propias de RadioFlow, no huecos de RadioBOSS. El resumen v0.1 de abajo quedó obsoleto; usar esta tabla.

---

## Menú Archivo

| ID | Ítem RadioBOSS | Ítem RadioFlow | Estado | Notas / ruta | Prioridad |
|----|----------------|----------------|--------|--------------|-----------|
| RB-001 | Nueva playlist | Nueva lista… | ✅ | `POST /api/playlists` · menú Archivo | — |
| RB-002 | Abrir playlist | Abrir… | ✅ | `/playlists` | — |
| RB-003 | Guardar | Guardar | ✅ | Diálogo estado auto-guardado · `updatedAt` en API | P3 |
| RB-004 | Guardar como | Guardar como… | ✅ | `POST /playlists/:id/duplicate` · copia real | P2 |
| RB-005 | Exportar playlist (M3U, PLS, etc.) | Exportar JSON/M3U/PLS… | ✅ | Menú Archivo + `GET /playlists/:id/export` | P2 |
| RB-006 | Informes / exportación | Exportar / informes… | ✅ | `/reports` · `GET /api/reports/play-log` | — |
| RB-007 | Salir | Salir | ✅ | Cierra sesión · `/login` | — |
| RB-008 | Abrir carpeta de datos | Abrir carpeta de datos… | ✅ | IPC `openUserDataFolder` · menú Archivo (desktop) | P3 |
| RB-009 | Importar playlist externa | Importar lista… | ✅ | Archivo → M3U/PLS · `POST /playlists/import-file` | P2 |

**Backlog Archivo**

- [x] RB-004 Duplicar playlist “guardar como” copia real
- [x] RB-005 Export M3U / PLS desde menú Archivo
- [x] RB-009 Importar archivo de lista desde Archivo → Abrir

---

## Menú Edición

| ID | Ítem RadioBOSS | Ítem RadioFlow | Estado | Notas / ruta | Prioridad |
|----|----------------|----------------|--------|--------------|-----------|
| RB-010 | Deshacer | Deshacer | ✅ | Pila 20 pasos · `PUT .../items/restore` · Rehacer | P3 |
| RB-011 | Cortar | Cortar | ✅ | Portapapeles interno + quita de lista | — |
| RB-012 | Copiar | Copiar | ✅ | `playlistClipboard` | — |
| RB-013 | Pegar | Pegar | ✅ | `POST .../items/batch` | — |
| RB-014 | Seleccionar todo | Seleccionar todo | ✅ | Detalle de playlist | — |
| RB-015 | Seleccionar nada | Seleccionar nada | ✅ | Detalle de playlist | — |
| RB-016 | Invertir selección | Invertir selección | ✅ | Menú Edición | P3 |
| RB-017 | Recortar selección | Recortar selección | ✅ | Deja solo filas seleccionadas | — |
| RB-018 | Eliminar | Eliminar | ✅ | Quita ítems seleccionados | — |
| RB-019 | Eliminar todo | Eliminar todo | ✅ | Vacía la lista | — |

**Backlog Edición**

- [x] RB-010 Pila deshacer/rehacer en editor de playlist (mín. 20 pasos)
- [x] RB-016 Invertir selección

---

## Menú Vista

| ID | Ítem RadioBOSS | Ítem RadioFlow | Estado | Notas / ruta | Prioridad |
|----|----------------|----------------|--------|--------------|-----------|
| RB-020 | Reproductor / Player | Cabina… | ✅ | `/station` · **C1** listen-through del mount cuando Emitir+encoder; Web Audio fallback | — |
| RB-021 | Editor de playlist | Listas… | ✅ | `/playlists` · `/playlists/:id` | — |
| RB-022 | Biblioteca musical | Librería… | ✅ | `/library` | — |
| RB-023 | Explorador de archivos | Explorador de archivos… | ✅ | `/explorador` · nativo en desktop | — |
| RB-024 | Programador / Scheduler | Parrilla… | ✅ | `/schedule` · bloques semanales | — |
| RB-025 | Streaming / Broadcast | Streaming… | ✅ | `/streaming` · encoder + destinos | — |
| RB-026 | Informes | Informes… | ✅ | `/reports` | — |
| RB-027 | Opciones / marca | Marca / opciones… | ✅ | `/settings` | — |
| RB-028 | Panel de control | Panel… | ✅ | `/panel` | — |
| RB-029 | Búsqueda en librería | Búsqueda en librería | ✅ | `/library` · `?q=` | — |
| RB-030 | Programador de eventos | Programador de eventos… | ✅ | `/scheduler` · admin/editor | — |
| RB-031 | Ecualizador / FX en aire | Efectos (FX) | ✅ | EQ 3 bandas en `CabReferencePlayer` + `/fx` | P2 |
| RB-032 | Paneles acoplables | Paneles laterales | ✅ | Rieles cola / scheduler / pedidos | — |
| RB-033 | Información de pista | Información de pista… | ✅ | `/library` · diálogo ID3 + ganancia · **C4** write MP3 ([c4-id3-write.md](./c4-id3-write.md)) | P3 |
| RB-034 | Pantalla completa | Pantalla completa | ✅ | API fullscreen del shell | — |
| RB-035 | Barra de herramientas / reloj ON AIR | Cinta + reloj | ✅ | `NowPlayingRibbon` · cuenta atrás top-of-hour | P2 |
| RB-036 | Voicetrack editor | Editor de voicetrack… | ✅ | `/voicetrack` · trim · ducking · **C2** overlay en encoder (`voiceTrackOverlay`) | P1 |
| RB-037 | Advertisement scheduler | Planificador de publicidad… | ✅ | `/ads` · reglas + tick automático | — |

**Backlog Vista**

- [x] RB-031 FX reales en cadena Web Audio (cabina)
- [x] RB-033 Panel “información de pista” con ID3, loudness, BPM · **C4** escritura MP3 round-trip
- [x] RB-035 Cabecera broadcast (anterior / aire / siguiente / reloj hora)
- [x] RB-036 Voicetrack MVP + fase extra (editor `/voicetrack`, trim de forma de onda)
- [x] RB-037 Módulo advertisement scheduler (`/ads`)

---

## Menú Lista (Playlist)

| ID | Ítem RadioBOSS | Ítem RadioFlow | Estado | Notas / ruta | Prioridad |
|----|----------------|----------------|--------|--------------|-----------|
| RB-040 | Playlist Generator Pro | Generador de playlist (Pro)… | ✅ | Rotación por categorías, presets, `POST /playlists/generate` | — |
| RB-041 | Generación automática programada | Generar y poner al aire… | ✅ | `GENERATE_AND_PLAY_PLAYLIST` en `/scheduler` | — |
| RB-042 | Añadir archivo | Añadir archivo… | ✅ | Playout: `/library` · detalle: explorador | — |
| RB-043 | Añadir carpeta | Añadir carpeta… | ✅ | Playout: biblioteca · detalle: explorador | — |
| RB-044 | Añadir URL / stream | Añadir URL… | ✅ | `POST .../items/stream-url` · redirect en `/library/assets/:id/stream` | P2 |
| RB-045a | Añadir todo desde género/artista/carpeta | Menú Lista + ♫ Catálogo | ✅ | `fill-from-*` · Playout `/station` | — |
| RB-045b | Añadir pistas de otra lista | Añadir pistas de otra lista… | ✅ | `merge-from-playlist` · transfer DnD entre pestañas | — |
| RB-045 | Mostrar duplicados | Mostrar duplicados… | ✅ | Playout + detalle por `assetId` | — |
| RB-045c | Archivos inexistentes | Mostrar archivos inexistentes… | ✅ | `POST /library/check-tracks` en lista activa | — |
| RB-046 | Insertar playlist | Insertar lista… | ✅ | Diálogo fusionar / reemplazar en Playout | — |
| RB-047 | Mezclar / shuffle | Mezclar orden | ✅ | Playout + detalle | — |
| RB-048 | Buscar en playlist | Buscar en la lista… | ✅ | Filtro en Playout + detalle | — |
| RB-048a | Recargar metadatos | Recargar metadatos de pistas… | ✅ | `sync-metadata-bulk` desde menú Lista | — |
| RB-049 | Añadir comando (pause, marker, etc.) | — | ✅ | Pausa/marcador/nota; sync cola; auto-skip; countdown visible en cabina | P1 |
| RB-050 | Track list dinámica | — | ✅ | Ítem `track_list` · expande al sync · menú Lista | P1 |
| RB-051 | Hour markers / bloques hora | Marcador de hora… | ✅ | Kind `hour_marker` · menú Lista | P2 |
| RB-052 | Insertar comercial / break | Insertar bloque publicitario… | ✅ | Menú Lista + POST `/api/ads/break` | — |
| RB-053 | Rotación por categorías | Rotación por categorías (%) | ✅ | `categoryRules` en Generator Pro | — |
| RB-054 | Reglas anti-repetición | Separación de artista | ✅ | `minArtistGap` global en generador | — |
| RB-055 | Reiniciar «ya sonó» | Reiniciar estado «ya sonó»… | ✅ | `rotationResetAt` · skips desde reset | P3 |
| RB-056 | Comando DTMF en lista | Insertar comando DTMF… | ✅ | Kind `dtmf` · dispara RB-118 al avanzar | P3 |
| RB-057 | Locución TTS | Insertar locución TTS… | ✅ | SAPI / espeak · voicetrack en lista | P3 |

**Backlog Lista**

- [x] RB-040 UI Playlist Generator Pro (duración, rotación por categorías, presets)
- [x] RB-041 / RB-127 Evento scheduler genera playlist y pone al aire
- [x] RB-044 Añadir URL de audio a playlist
- [x] RB-046 Insertar/fusionar otra playlist (Playout + API)
- [x] RB-045a Rellenar desde género, artista, carpeta
- [x] DnD entre pestañas (mover/copiar con Shift)
- [x] RB-049 Comandos en playlist (API + UI) — pausa/marcador/nota MVP
- [x] RB-050 Track list por carpeta/género/filtro (expande al poner al aire)
- [x] RB-051 Hour markers
- [x] RB-052–054 Bloque publicitario (RB-054 ya cubierto por minArtistGap en generator)
- [x] RB-055 Reiniciar «ya sonó» en lista
- [x] RB-056 Comando DTMF en playlist
- [x] RB-057 Locución TTS en lista

---

## Menú Herramientas

| ID | Ítem RadioBOSS | Ítem RadioFlow | Estado | Notas / ruta | Prioridad |
|----|----------------|----------------|--------|--------------|-----------|
| RB-060 | Biblioteca musical | Biblioteca musical | ✅ | `/library` | — |
| RB-061 | Generador de informes | Generador de informes | ✅ | Resumen skips/hora + oyentes Icecast + play-log | P2 |
| RB-062 | Cart wall | Jingles / cart wall | ✅ | `/jingles` · 10 ranuras | — |
| RB-063 | Estadísticas de transmisión | Estadísticas de transmisión… | ✅ | Oyentes en `/reports` + `/streaming` | P2 |
| RB-064 | Título del stream | Título del stream… | ✅ | Metadatos encoder + panel streaming | — |
| RB-065 | Cola de reproducción | Cola de reproducción… | ✅ | Cr.p. · `PlaybackQueueEntry` | — |
| RB-066 | Pedidos / dedicatorias | Pedidos de canciones… | ✅ | `/requests` — extra RadioFlow | — |
| RB-071 | Protección repetición pedidos | Protección repetición pedidos… | ✅ | Cooldown artista/título en Marca | P3 |
| RB-072 | Render playlist a archivo | Renderizar playlist a archivo… | ✅ | Export M3U lista abierta | P3 |
| RB-058 | Auto intro | Auto intro… | ✅ | Carpeta intros/ · match por artista | P3 |
| RB-059 | Time stretch | Time stretch… | ✅ | Job ffmpeg `atempo` · menú Herramientas | P3 |
| RB-067 | Check music tracks (Verify) | Comprobar / Verificar… | ✅ | Menú + diálogos en biblioteca | P2 |
| RB-068 | Process tracks | Procesar pistas… | ✅ | Loudness, BPM, trim, transcode MP3 + progreso | P2 |
| RB-069 | Conversor de formatos | Convertir biblioteca a MP3… | ✅ | `POST /library/process-jobs/vault-transcode-mp3` | P2 |
| RB-070 | Búsqueda semántica (IA) | — | 🔮 | Ollama · `/api/semantic` | — |

**Backlog Herramientas**

- [x] RB-061 Informes: canciones por hora (skips), resumen actividad
- [x] RB-067 UI Verify en librería
- [x] RB-068 UI Process tracks (lote, progreso, trim/transcode)
- [x] RB-069 Asistente “convertir biblioteca” masivo (toda la bóveda en un clic)
- [x] RB-071 Protección repetición pedidos
- [x] RB-072 Render playlist (M3U desde menú Lista)
- [x] RB-058 Auto intro por carpeta de intros
- [x] RB-059 Time stretch (job biblioteca)

---

## Menú Jingles

| ID | Ítem RadioBOSS | Ítem RadioFlow | Estado | Notas / ruta | Prioridad |
|----|----------------|----------------|--------|--------------|-----------|
| RB-080 | Abrir cart wall | Abrir cart wall… | ✅ | `/jingles` | — |
| RB-081 | Asignar teclas | Asignar pistas a teclas… | ✅ | `JingleAssignDialog` · menú Jingles · `/jingles?assign=1` | P3 |
| RB-082 | Hotkeys globales 1–0 | Electron globalShortcut | ✅ | Cart wall 1–0 · **C5** debounce + toast ([c5-cart-hotkeys.md](./c5-cart-hotkeys.md)) | P2 |
| RB-083 | Múltiples cart walls / páginas | Página A/B/C | ✅ | `pageKey` en jingles · hotkeys usan página activa | P3 |
| RB-084 | playNext tras aire | playNext / playNow | ✅ | Encola tras aire; **C5** `playNow` corta al instante | — |

**Backlog Jingles**

- [x] RB-082 Hotkeys cart globales en Electron (1–0)
- [x] RB-083 Varias páginas de cart (A/B/C…)

---

## Menú Configuración

| ID | Ítem RadioBOSS | Ítem RadioFlow | Estado | Notas / ruta | Prioridad |
|----|----------------|----------------|--------|--------------|-----------|
| RB-090 | Opciones generales | Opciones… | ✅ | `/settings` · marca, streaming activo | — |
| RB-091 | Teclas rápidas | Teclas rápidas… | ✅ | Diálogo cabina · Espacio/N/M defaults | P2 |
| RB-092 | Fundidos cruzados | Fundidos cruzados… | ✅ | Diálogo · `cabCrossfadeSec` 0–30 s | P2 |
| RB-093 | Nivelación automática | Nivelación automática… | ✅ | `cabReferenceGainDb` + link loudness jobs | P2 |
| RB-094 | RDS | RDS en Marca | ✅ | Plantilla + sidecar `rds.txt` · export Now Playing | P2 |
| RB-095 | Modo estación / perfiles audio | Perfiles cabina | ✅ | Música / Talk / Noche en `CabinaOptionsDialog` | P3 |

**Backlog Configuración**

- [x] RB-091 Editor de atajos (cabina)
- [x] RB-092 Diálogo fundidos (duración)
- [x] RB-093 Panel nivelación (estación + por pista)
- [x] RB-094 RDS vía encoder o hardware serial

---

## Menú Ayuda y Usuario

| ID | Ítem RadioBOSS | Ítem RadioFlow | Estado | Notas / ruta | Prioridad |
|----|----------------|----------------|--------|--------------|-----------|
| RB-100 | Contenidos / manual | Contenidos | ✅ | `/help` | — |
| RB-101 | Acerca de | Acerca de RadioFlow Studio… | ✅ | Diálogo en menú | — |
| RB-102 | Buscar actualizaciones | — | ✅ | Desktop · auto-update + Ayuda (producto instalable) | — |
| RB-103 | Gestión de cuentas | Gestión de cuentas… | ✅ | `/security` · admin | — |
| RB-104 | Usuarios / roles red | Panel de control | ✅ | `/panel` · roles Prisma | — |
| RB-105 | Manual integrado RadioBOSS | — | ➖ | Enlace a este doc + ayuda propia | — |

**Backlog Ayuda**

- [x] RB-105 Enlazar este documento desde `/help`

---

## Cabina / Player (fuera del menú superior)

| ID | Capacidad RadioBOSS | RadioFlow | Estado | Notas | Prioridad |
|----|---------------------|-----------|--------|-------|-----------|
| RB-110 | Reproducción 24/7 estable | Web Audio + headless API | ✅ | `HEADLESS_PLAYOUT_POLL_MS` · heartbeat UI · encoder WS | **P1** |
| RB-111 | Modos Auto / Live Assist / Manual | AUTO / LIVE_ASSIST / LIVE | ✅ | `PATCH /api/station` | — |
| RB-112 | Crossfade entre pistas | Dual-deck `CabReferencePlayer` | ✅ | Default ~4 s | — |
| RB-113 | Skip / siguiente | `POST /api/station/skip` | ✅ | | — |
| RB-114 | Cola lineal + Cr.p. | Tabla + `playbackQueue` | ✅ | Estilo manual RadioBOSS | — |
| RB-115 | VU / medidores | VU + IPC desktop HUD | ✅ | | — |
| RB-116 | Título en vivo manual | `liveTitle` en estación | ✅ | | — |
| RB-117 | Automatizar parrilla | `autoScheduleEnabled` + worker/interno | ✅ | **C3** un aplicador (`SCHEDULE_APPLY_MODE`); ver [c3-scheduler-consolidated.md](./c3-scheduler-consolidated.md) | — |
| RB-118 | DTMF dispara eventos | POST /station/dtmf | ✅ | Mapa configurable · skip / cart / modo | P3 |
| RB-119 | WebSocket / estado remoto | `WS /api/ws/station` | 🔮 | | — |

**Backlog Cabina**

- [x] RB-110 Motor headless de playout (API avanza cola sin UI; encoder + WS)
- [x] RB-118 Eventos por DTMF

---

## Scheduler y eventos (RadioBOSS §4)

| ID | Capacidad RadioBOSS | RadioFlow | Estado | Notas | Prioridad |
|----|---------------------|-----------|--------|-------|-----------|
| RB-120 | Eventos por hora / calendario | `SchedulerEvent` | ✅ | `/scheduler` | — |
| RB-121 | Asistente de comandos (wizard) | Asistente en `/scheduler` | ✅ | 8 plantillas · 3 pasos · programación rápida | P1 |
| RB-122 | Reproducir playlist | `PLAY_PLAYLIST` | ✅ | | — |
| RB-123 | Reproducir archivo | `PLAY_ASSET` | ✅ | | — |
| RB-124 | Comandos (skip, etc.) | `RUN_COMMAND` ampliado | ✅ | Modos, clear queue, cart slot, playlist | P2 |
| RB-125 | Parrilla semanal por bloques | `ScheduleBlock` | ✅ | `/schedule` | — |
| RB-126 | Eventos one-shot legacy | `Evento` + Liquidsoap | ✅ | M3U resuelto · `eventos-hoy.m3u` · `/eventos/actual?format=m3u` | P2 |
| RB-127 | Generar playlist en evento | GENERATE_AND_PLAY_PLAYLIST | ✅ | `/scheduler` · genera + encola | — |
| RB-128 | Comerciales en evento | PLAY_AD_BREAK | ✅ | `/scheduler` | — |

**Backlog Scheduler**

- [x] RB-121 Wizard de eventos (plantillas RadioBOSS)
- [x] RB-124 Ampliar catálogo `RUN_COMMAND`
- [x] RB-126 Eventos legacy + M3U Liquidsoap
- [x] RB-127–128 Evento generar playlist + bloque publicitario

---

## Streaming y metadatos

| ID | Capacidad RadioBOSS | RadioFlow | Estado | Notas | Prioridad |
|----|---------------------|-----------|--------|-------|-----------|
| RB-130 | Encoder integrado | `apps/encoder` FFmpeg | ✅ | WS + polling · **A1** `playSegment` (cues/`afade`/gain) · path por defecto vs Liquidsoap legacy | — |
| RB-131 | Icecast / Shoutcast / AzuraCast | `StreamProtocol` enum | ✅ | Destinos múltiples | — |
| RB-132 | Metadatos Now Playing | FFmpeg `-metadata` | ✅ | | — |
| RB-133 | Oyentes / estadísticas | Icecast status API | ✅ | Muestreo periódico · `/reports` pestaña Oyentes | P2 |
| RB-134 | RDS salida FM | RDS sidecar | ✅ | Mismo pipeline RB-094 · `rds.txt` | P2 |
| RB-135 | Salida múltiple simultánea | Destinos secundarios | ✅ | `extraStreamingTargetIds` · encoder multi-FFmpeg output | P3 |

**Backlog Streaming**

- [x] RB-134 RDS
- [x] RB-135 Multi-mount simultáneo

---

## Independencia RadioFlow (mantener)

| ID | Capacidad | Estado | Notas |
|----|-----------|--------|-------|
| RF-001 | API REST + OpenAPI | 🔮 | `GET /api/docs` |
| RF-002 | Multi-usuario / roles | 🔮 | admin, editor, dj, viewer, operador |
| RF-003 | Despliegue Docker / K8s | 🔮 | Monorepo |
| RF-004 | PWA + Electron mismo código | 🔮 | |
| RF-005 | Pedidos de canciones moderados | ✅ | `/requests` |
| RF-006 | Búsqueda semántica Ollama | 🔮 | Opcional |
| RF-007 | Liquidsoap vía M3U generados | 🔮 | Legacy / externo · path por defecto = encoder Icecast (A1) |
| RF-008 | Refresh tokens / sesiones | 🔮 | Seguridad moderna |

---

## Prioridades sugeridas (épica de producto)

### P0 — Emisora comercial creíble
1. RB-040, RB-041, RB-053, RB-054 — **Playlist Generator Pro**
2. RB-037, RB-052, RB-128 — **Advertisement scheduler**
3. RB-127 — Generación programada en scheduler

### P1 — Formato hablado y operación pro
4. RB-036 — Voicetrack
5. RB-110 — Playout nativo 24/7
6. RB-046, RB-049, RB-050 — Comandos y track lists en playlist
7. RB-121 — Wizard de eventos

### P2 — Pulido “se siente RadioBOSS”
8. RB-091, RB-092, RB-093 — Teclas, fundidos, nivelación (UI)
9. RB-067, RB-068 — Verify y Process tracks en librería
10. RB-005, RB-044 — Export/import playlist clásico
11. RB-061, RB-063 — Informes avanzados
12. RB-082 — Hotkeys cart globales
13. RB-134 — RDS

### P3 — Nice to have
14. RB-010, RB-083, RB-095, RB-118, RB-135

---

## Cómo actualizar este documento

1. Al cerrar un ítem de backlog, cambiar **Estado** a ✅ o 🟡 según corresponda y marcar `- [x]`.
2. Si se añade un ítem al menú en `RadioflowTopMenuBar.tsx`, añadir fila aquí con nuevo ID `RB-xxx`.
3. En release notes, referenciar IDs (`Cerrado RB-040 en v0.2`).
4. Revisión recomendada: **cada minor release** o al fusionar una épica P0/P1.

---

## Referencias

- Manual RadioBOSS (parte VI — menús): [djsoft.net manual](https://manual.djsoft.net/radioboss/en/)
- Arquitectura RadioFlow: [architecture.md](./architecture.md)
- QA entorno: [validation-checklist.md](./validation-checklist.md)
- Menú implementado: `apps/web/src/layout/RadioflowTopMenuBar.tsx`
