/** Entrada para export PLS (Winamp / RadioBOSS). */
export type PlsPlaylistEntry = {
  path: string;
  title?: string;
  durationSec?: number;
};

/** Parsea .pls (Winamp / RadioBOSS) a entradas de ruta. */
export function parsePlsPlaylist(text: string): PlsPlaylistEntry[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const files = new Map<number, string>();
  const titles = new Map<number, string>();
  const lengths = new Map<number, number>();
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("[")) continue;
    const m = /^(\w+?)(\d+)=(.*)$/.exec(line);
    if (!m) continue;
    const [, key, idxStr, val] = m;
    const idx = Number(idxStr);
    if (!Number.isFinite(idx)) continue;
    if (key === "File") files.set(idx, val.trim());
    else if (key === "Title") titles.set(idx, val.trim());
    else if (key === "Length") {
      const n = Number(val);
      if (Number.isFinite(n) && n > 0) lengths.set(idx, n);
    }
  }
  const indices = [...files.keys()].sort((a, b) => a - b);
  return indices.map((idx) => ({
    path: files.get(idx)!,
    title: titles.get(idx),
    durationSec: lengths.get(idx),
  }));
}

/** Genera un .pls mínimo compatible con Winamp / RadioBOSS. */
export function buildPlsPlaylist(entries: PlsPlaylistEntry[]): string {
  const n = entries.length;
  const lines = ["[playlist]", `NumberOfEntries=${n}`];
  entries.forEach((e, i) => {
    const idx = i + 1;
    lines.push(`File${idx}=${e.path.trim()}`);
    if (e.title) lines.push(`Title${idx}=${e.title}`);
    if (e.durationSec != null && e.durationSec > 0) lines.push(`Length${idx}=${Math.round(e.durationSec)}`);
  });
  lines.push("Version=2");
  return `${lines.join("\r\n")}\r\n`;
}
