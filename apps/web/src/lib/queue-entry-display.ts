import type {
  ApiPlaylistCmdSpec,
  ApiPlaylistContainerSpec,
  ApiPlaylistItem,
  ApiStationQueueItem,
  ApiTrackListSpec,
} from "@radioflow/shared";
import { cmdDisplayTitle, parseCmdQueueLabel, parsePlaylistCmdSpec } from "./playlist-cmd-spec";

export function isCommandPlaylistKind(kind: ApiPlaylistItem["kind"]): boolean {
  return (
    kind === "pause" ||
    kind === "marker" ||
    kind === "note" ||
    kind === "hour_marker" ||
    kind === "dtmf" ||
    kind === "time_announce" ||
    kind === "station_intro" ||
    kind === "jingle_auto" ||
    kind === "cmd" ||
    kind === "container"
  );
}

export function isTrackListKind(kind: ApiPlaylistItem["kind"]): boolean {
  return kind === "track_list";
}

function asTrackListSpec(spec: ApiPlaylistItem["trackListSpec"]): ApiTrackListSpec | null {
  if (!spec || !("source" in spec)) return null;
  return spec as ApiTrackListSpec;
}

export function trackListSummary(row: ApiPlaylistItem): string {
  const spec = asTrackListSpec(row.trackListSpec);
  if (!spec) return row.label?.trim() || "Lista de pistas";
  const src =
    spec.source === "genre" || spec.source === "category"
      ? `Género: ${spec.value}`
      : spec.source === "artist"
        ? `Artista: ${spec.value === "__none__" ? "Sin artista" : spec.value}`
        : `Carpeta: ${spec.value.split("/").filter(Boolean).pop() ?? spec.value}`;
  const max = spec.maxTracks ?? 1;
  const ord =
    spec.order === "series"
      ? "serie"
      : spec.order === "sequential" || spec.order === "title"
        ? "en orden"
        : "aleatorio";
  return `${src} · ${ord}${max > 1 ? ` · ×${max}` : ""}`;
}

export function queueEntryTitle(row: ApiPlaylistItem | ApiStationQueueItem): string {
  if (row.kind === "track_list") {
    return row.label?.trim() || trackListSummary(row as ApiPlaylistItem);
  }
  if (row.kind === "cmd") {
    const fromPl = parsePlaylistCmdSpec((row as ApiPlaylistItem).trackListSpec);
    if (fromPl) return cmdDisplayTitle(fromPl, row.label);
    const fromQueue = parseCmdQueueLabel(row.label);
    if (fromQueue) return cmdDisplayTitle(fromQueue, null);
    return row.label?.trim() || "Comando";
  }
  if (row.kind === "container") {
    return row.label?.trim() || "Container";
  }
  if (row.kind === "pause") return row.label?.trim() || `Pausa (${row.pauseSec ?? 0}s)`;
  if (row.kind === "marker") return row.label?.trim() || "Marcador";
  if (row.kind === "hour_marker") return row.label?.trim() || "Marcador de hora";
  if (row.kind === "time_announce") {
    const raw = row.label?.trim() ?? "";
    if (raw.startsWith("time_announce_slot:")) {
      const slot = raw.slice("time_announce_slot:".length);
      const hm = slot.includes("T") ? slot.split("T")[1] : slot;
      return hm ? `Locución horaria (${hm})` : "Locución horaria";
    }
    return raw || "Locución horaria";
  }
  if (row.kind === "station_intro") return row.label?.trim() || "Intro de emisora";
  if (row.kind === "jingle_auto") return row.label?.trim() || "Jingle automático";
  if (row.kind === "dtmf") return row.label?.trim() ? `DTMF ${row.label.trim()}` : "DTMF";
  if (row.kind === "note") return row.label?.trim() || "Nota";
  if (row.kind === "voicetrack") {
    if (row.label?.trim()) return row.label.trim();
    const a = row.asset;
    if (a) {
      const artist = a.artist?.trim();
      if (artist && artist !== "Voicetrack") return `${artist} · ${a.title}`;
      return a.title;
    }
    return "Voicetrack";
  }
  const a = row.asset;
  if (!a) return "—";
  const artist = a.artist?.trim();
  if (artist) return `${artist} · ${a.title}`;
  return a.title;
}

export function queueEntryKindLabel(kind: ApiPlaylistItem["kind"]): string {
  if (kind === "pause") return "Pausa";
  if (kind === "marker") return "Marcador";
  if (kind === "note") return "Nota";
  if (kind === "voicetrack") return "VT";
  if (kind === "track_list") return "Lista de pistas";
  if (kind === "hour_marker") return "Hora";
  if (kind === "time_announce") return "Locución";
  if (kind === "station_intro") return "Intro";
  if (kind === "jingle_auto") return "Jingle";
  if (kind === "dtmf") return "DTMF";
  if (kind === "cmd") return "Cmd";
  if (kind === "container") return "Container";
  return "Pista";
}

export function queueEntryDurationSec(row: ApiPlaylistItem | ApiStationQueueItem): number | null {
  if (row.kind === "track_list" || row.kind === "cmd" || row.kind === "container") return null;
  if (row.kind === "pause") return row.pauseSec;
  if ((row.kind === "track" || row.kind === "voicetrack") && row.asset) {
    const d = (row.asset as { durationSec?: number | null }).durationSec;
    return d ?? null;
  }
  return null;
}

export type { ApiPlaylistCmdSpec, ApiPlaylistContainerSpec };
