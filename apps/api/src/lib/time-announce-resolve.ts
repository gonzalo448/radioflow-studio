import fs from "node:fs";
import path from "node:path";

const AUDIO_EXT = new Set([".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg", ".opus", ".wma"]);

export type TimeAnnounceClipKind = "hour" | "hour_exact" | "minute";

export type ResolvedTimeAnnounceClip = {
  kind: TimeAnnounceClipKind;
  hour?: number;
  minute?: number;
  absPath: string;
  fileName: string;
};

/**
 * Parsea nombres estilo RadioBOSS / emisoras locales:
 * - HRS05.mp3 / hr_05.mp3 / h05.mp3 → hora 5 (seguida de minutos)
 * - HRS05_O.mp3 / hr_05o.mp3 → hora 5 en punto
 * - MIN56.mp3 / m_56.mp3 → minuto 56
 */
export function parseHourMeta(fileName: string): { hour: number; exact: boolean } | null {
  const base = path.basename(fileName, path.extname(fileName)).toLowerCase();

  // HRS05_O / hrs_05_o / hr_05o / h05o
  const exact =
    base.match(/^hrs?[_.\-\s]*(\d{1,2})[_.\-\s]*o$/i) ??
    base.match(/^hora[_.\-\s]*(\d{1,2})[_.\-\s]*o$/i) ??
    base.match(/^h[_.\-\s]*(\d{1,2})o$/i);
  if (exact) {
    const hour = Number(exact[1]);
    if (hour >= 0 && hour <= 23) return { hour, exact: true };
  }

  // HRS05 / hrs_05 / hr_05 / h05 / hora_05
  const hr =
    base.match(/^hrs?[_.\-\s]*(\d{1,2})$/i) ??
    base.match(/^hora[_.\-\s]*(\d{1,2})$/i) ??
    base.match(/^h[_.\-\s]*(\d{1,2})$/i);
  if (hr) {
    const hour = Number(hr[1]);
    if (hour >= 0 && hour <= 23) return { hour, exact: false };
  }
  return null;
}

export function parseMinuteMeta(fileName: string): number | null {
  const base = path.basename(fileName, path.extname(fileName)).toLowerCase();
  const m =
    base.match(/^min(?:uto)?s?[_.\-\s]*(\d{1,2})$/i) ??
    base.match(/^m[_.\-\s]*(\d{1,2})$/i);
  if (m) {
    const minute = Number(m[1]);
    if (minute >= 0 && minute <= 59) return minute;
  }
  return null;
}

export function listTimeAnnounceClips(folderAbs: string): ResolvedTimeAnnounceClip[] {
  if (!folderAbs?.trim() || !fs.existsSync(folderAbs)) return [];
  let st: fs.Stats;
  try {
    st = fs.statSync(folderAbs);
  } catch {
    return [];
  }
  if (!st.isDirectory()) return [];

  const out: ResolvedTimeAnnounceClip[] = [];
  for (const name of fs.readdirSync(folderAbs)) {
    const abs = path.join(folderAbs, name);
    let isFile = false;
    try {
      isFile = fs.statSync(abs).isFile();
    } catch {
      continue;
    }
    if (!isFile) continue;
    const ext = path.extname(name).toLowerCase();
    if (!AUDIO_EXT.has(ext)) continue;

    const hourMeta = parseHourMeta(name);
    if (hourMeta) {
      out.push({
        kind: hourMeta.exact ? "hour_exact" : "hour",
        hour: hourMeta.hour,
        absPath: abs,
        fileName: name,
      });
      continue;
    }
    const minute = parseMinuteMeta(name);
    if (minute != null) {
      out.push({ kind: "minute", minute, absPath: abs, fileName: name });
    }
  }
  return out;
}

export type TimeAnnounceFolderSummary = {
  folderAbs: string;
  hourFiles: number;
  hourExactFiles: number;
  minuteFiles: number;
  totalAudio: number;
};

export type TimeAnnouncePlan = {
  now: Date;
  hour: number;
  minute: number;
  clips: ResolvedTimeAnnounceClip[];
  missing: string[];
};

/**
 * Monta la secuencia RadioBOSS: en punto → solo hora “o”; si no → hora + minuto.
 * Usa el reloj local del proceso (equipo).
 */
export function planTimeAnnounce(folderAbs: string, now = new Date()): TimeAnnouncePlan {
  const hour = now.getHours();
  const minute = now.getMinutes();
  const all = listTimeAnnounceClips(folderAbs);
  const clips: ResolvedTimeAnnounceClip[] = [];
  const missing: string[] = [];

  if (minute === 0) {
    const exact =
      all.find((c) => c.kind === "hour_exact" && c.hour === hour) ??
      all.find((c) => c.kind === "hour" && c.hour === hour);
    if (exact) clips.push(exact);
    else missing.push(`hora en punto ${String(hour).padStart(2, "0")}`);
  } else {
    const hr =
      all.find((c) => c.kind === "hour" && c.hour === hour) ??
      all.find((c) => c.kind === "hour_exact" && c.hour === hour);
    if (hr) clips.push(hr);
    else missing.push(`hora ${String(hour).padStart(2, "0")}`);

    const mn = all.find((c) => c.kind === "minute" && c.minute === minute);
    if (mn) clips.push(mn);
    else missing.push(`minuto ${String(minute).padStart(2, "0")}`);
  }

  return { now, hour, minute, clips, missing };
}
