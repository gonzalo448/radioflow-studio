# Runbook día-1 — Primera emisión al aire

Guía para **operadores** (no hace falta ser desarrollador): instalar RadioFlow Studio, cargar música, conectar Icecast y comprobar que el oyente oye el stream.

**Path por defecto:** encoder FFmpeg → Icecast/Shoutcast/AzuraCast.  
**No uses** Liquidsoap en el mismo mount al mismo tiempo (es legacy / opcional).

Referencias técnicas: [streaming-encoder-icecast.md](./streaming-encoder-icecast.md) · [media-vault.md](./media-vault.md) · [architecture.md](./architecture.md)

---

## Qué vas a lograr

Al terminar este checklist:

1. App abierta con tu usuario.
2. Al menos unas pistas en la **biblioteca** (bóveda local).
3. Cola en **Cabina** y audio de referencia.
4. Destino Icecast configurado y **Emitir** activo.
5. URL pública del stream que reproduce en VLC/navegador.

Tiempo orientativo: **30–60 min** la primera vez (sin contar catalogar toda la discoteca).

---

## A) Producto instalable Windows (recomendado para emisoras)

### A1. Instalar y primer arranque

1. Ejecutá el instalador `RadioFlow-Studio-Setup-*.exe` (o el que te entregó tu proveedor).
2. Abrí **RadioFlow Studio** (ventana de escritorio; no hace falta Chrome).
3. Completá **Bienvenida → Crear tu usuario** y guardá email/contraseña en un lugar seguro.
4. Los datos viven en `%APPDATA%\radioflow-studio` (SQLite + carpeta `media`). No borres esa carpeta si querés conservar la emisora.

> Si necesitás repetir la bienvenida: cerrá la app y borrá (o renombrá) `%APPDATA%\radioflow-studio`.

### A2. Biblioteca: meter audio en la bóveda

1. Menú **Herramientas → Biblioteca** (`/library`) o **Explorador** (`/explorador`).
2. Importá carpetas/archivos de audio (MP3/WAV, etc.). Los archivos se copian/usan bajo la bóveda local — **no** dejes solo atajos a rutas que luego movés.
3. Esperá a que las pistas aparezcan en el catálogo (título/artista). Si alguna no tiene duración, la app puede medirla en segundo plano; para el aire es mejor tener duración visible antes de usar esa pista.

Checklist mínimo:

- [ ] ≥ 5 pistas visibles en Biblioteca
- [ ] Abrís una y se oye/preview o metadatos OK

### A3. Cola en Cabina

1. Abrí **Cabina** (`/station`).
2. Arrastrá pistas desde la biblioteca (o usá «Abrir lista» / playlist) hasta tener **cola** con varias canciones.
3. Poné la emisión en marcha (reproducir / modo automático según tu flujo habitual).
4. Confirmá en el panel: **pista al aire** + siguientes en la cola.

Checklist:

- [ ] Hay pista actual con archivo válido
- [ ] Al terminar una pista, avanza la siguiente (sin quedarse en silencio infinito)

### A4. Servidor de streaming (Icecast)

Necesitás un **servidor Icecast** (u otro destino compatible) al que RadioFlow envía la fuente:

| Opción | Cuándo |
|--------|--------|
| Icecast propio / hosting | Tenés host, puerto, mount y contraseña de **source** |
| Docker en la misma PC (técnico) | Ver apéndice B abajo (`docker compose --profile broadcast`) |
| AzuraCast / Shoutcast | Mismos datos desde el panel del proveedor |

Anotá antes de seguir:

- Host (ej. `127.0.0.1` o `icecast.tudominio.com`)
- Puerto (ej. `8000`)
- Mount (típico `/stream`)
- Usuario source (suele ser `source`) y **contraseña de fuente**
- URL pública para oyentes (puede ser `http://host:puerto/stream` o una URL HTTPS detrás de Nginx)

### A5. Emitir (encoder)

1. Menú **Emitir…** / ruta `/emitir` (o acceso **Streaming**).
2. Creá un **destino** Icecast con host / puerto / mount / contraseña.
3. Marcá ese destino como **activo** (también se refleja en **Marca**).
4. Activá la emisión / encoder local (en escritorio el panel arranca el encoder embebido cuando hay destino y broadcast habilitado).
5. En el panel de estado: encoder **conectado** / heartbeat OK, oyentes ≥ 0 (puede ser 0 sin nadie escuchando).

Checklist:

- [ ] Destino activo guardado
- [ ] Estado de emisión sin error de conexión a Icecast
- [ ] Abrís la URL del mount en VLC o el navegador y **oí** la misma música (o casi) que en Cabina

### A6. Criterio de “día-1 OK”

Pasá estas pruebas en orden:

| # | Prueba | Esperado |
|---|--------|----------|
| 1 | Escucha externa | URL del mount reproduce audio |
| 2 | Cambio de pista | Al avanzar en Cabina, el stream cambia (sin quedarse en bucle de la misma canción) |
| 3 | Cues (si los usás) | Una pista con entrada/salida definida no suena con silencio largo de cabeza/cola en Icecast |
| 4 | Reinicio suave | Cerrás y abrís Emitir/encoder: vuelve a conectar al mount en &lt; 1–2 min |

Si 1–2 fallan, **no** pases a parrilla/ads/scheduler: arreglá destino + encoder primero.

### A7. Problemas frecuentes (día-1)

| Síntoma | Qué revisar |
|---------|-------------|
| 404 en `/stream` | Icecast no tiene fuente; encoder apagado o contraseña/mount incorrectos; otro proceso ya ocupa el mount |
| Encoder no conecta | Host/puerto desde la PC del operador; firewall; password source |
| Oís Cabina pero no Icecast | Destino inactivo, broadcast desactivado, o FFmpeg no arrancó en escritorio |
| Misma pista se repite | Cola no avanza / sin duración usable — revisá Biblioteca (duración) y que la cola tenga siguientes |
| Silencio al cambiar | Esperá el fundido (`cabCrossfadeSec`); comprobá cues extremos |

Detalle técnico: [streaming-encoder-icecast.md](./streaming-encoder-icecast.md) §6.

---

## B) Apéndice: staging / desarrollo (Docker + monorepo)

Para técnicos que levantan el stack del repo (no es el flujo del cliente instalado).

```bash
# 1) API + panel (o desktop embebido)
npm install
npm run build -w @radioflow/shared
npm run dev:desktop:embedded   # o npm run dev (solo API+web)

# 2) Icecast del repo
# En .env raíz: RADIOFLOW_ICECAST_PUBLISH_PORT=8840  (si 8000 está ocupado)
docker compose --profile broadcast up -d icecast

# 3) Atajo opcional: tono de prueba + token + encoder
npm run broadcast:prepare
# o: npm run docker:broadcast  y luego Emitir / encoder con MEDIA_ROOT alineado
```

Luego: login → biblioteca/upload → cola Cabina → destino Icecast `127.0.0.1:<PUERTO>` mount `/stream` password `radioflow_dev` (o `RADIOFLOW_ICECAST_SOURCE_PASSWORD`) → escuchar `http://127.0.0.1:<PUERTO>/stream`.

Producción servidor (Postgres, TLS, go-live): [release-1.0-runbook.md](./release-1.0-runbook.md) · [README-prod.md](../README-prod.md).

---

## C) Qué no es día-1 (viene después)

- Smoke CI broadcast (`npm run smoke:broadcast`) → [streaming-encoder-icecast.md](./streaming-encoder-icecast.md) § smoke A5
- Backup/restore firmado → [backup-restore.md](./backup-restore.md)
- Alerta Icecast sin fuente (A7) → [streaming-encoder-icecast.md](./streaming-encoder-icecast.md) § Alerta
- Soak 72 h (A8 / V1-06) → [staging-72h-soak.md](./staging-72h-soak.md) (`npm run soak:watch`)
- Parrilla + publicidad (B3) → [b3-ads-parrilla-checklist.md](./b3-ads-parrilla-checklist.md)
- Skip / AutoDJ / fin de archivo (B4) → [b4-skip-autodj-eof.md](./b4-skip-autodj-eof.md)
- Aire único / listen-through (C1) → [c1-unified-air.md](./c1-unified-air.md)
- Voicetrack bridge en el aire (C2) → [c2-voicetrack-air.md](./c2-voicetrack-air.md)
- Scheduler consolidado (C3) → [c3-scheduler-consolidated.md](./c3-scheduler-consolidated.md)
- ID3 escritura round-trip (C4) → [c4-id3-write.md](./c4-id3-write.md)
- Cart / hotkeys latencia (C5) → [c5-cart-hotkeys.md](./c5-cart-hotkeys.md)
- Backup/restore formal → [operations.md](./operations.md) / release runbook
- Liquidsoap / M3U (legacy)

---

## Checklist imprimible

- [ ] App instalada / arranca
- [ ] Usuario creado (credenciales guardadas)
- [ ] Biblioteca con pistas
- [ ] Cola en Cabina avanza
- [ ] Icecast/destino con datos anotados
- [ ] Emitir activo + encoder OK
- [ ] URL pública oye audio
- [ ] Cambio de pista refleja en el stream
