/** Entrada de playlist M3U (línea de pista + metadatos opcionales de #EXTINF). */
export type M3uPlaylistEntry = {
  path: string;
  title?: string;
  /** Duración en segundos según #EXTINF (si viene y es válida). */
  durationSec?: number;
};

/**
 * Parsea un cuerpo .m3u/.m3u8: ignora líneas # salvo #EXTINF, asocia la siguiente línea no-# como ruta/URL.
 * No valida existencia de archivos.
 */
export function parseM3uPlaylist(text: string): M3uPlaylistEntry[] {
  const lines = text.split(/\r?\n/);
  const out: M3uPlaylistEntry[] = [];
  let pending: { title?: string; durationSec?: number } | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith("#EXTINF")) {
      const m = /^#EXTINF:\s*([^,]*)\s*,\s*(.*)$/.exec(line);
      if (m) {
        const durRaw = (m[1] ?? "").trim();
        const durNum = durRaw === "" || durRaw === "-1" ? undefined : Number(durRaw);
        const titlePart = (m[2] ?? "").trim();
        pending = {
          durationSec:
            durNum != null && Number.isFinite(durNum) && durNum > 0 ? Math.round(durNum) : undefined,
          title: titlePart || undefined,
        };
      }
      continue;
    }

    if (line.startsWith("#")) continue;

    out.push({
      path: line,
      title: pending?.title,
      durationSec: pending?.durationSec,
    });
    pending = null;
  }

  return out;
}

/** Reconstruye un .m3u mínimo a partir de entradas (p. ej. para enviar solo rutas relativas al servidor). */
export function buildM3uPlaylist(entries: M3uPlaylistEntry[]): string {
  const lines = ["#EXTM3U"];
  for (const e of entries) {
    const dur = e.durationSec != null && e.durationSec > 0 ? e.durationSec : -1;
    const title = e.title ?? "";
    lines.push(`#EXTINF:${dur},${title}`);
    lines.push(e.path.trim());
  }
  return `${lines.join("\n")}\n`;
}
