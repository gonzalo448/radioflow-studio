import type { ApiPlaylistCmdSpec, ApiPlaylistContainerSpec, PlaylistCmdAction } from "@radioflow/shared";

const CMD_ACTIONS: PlaylistCmdAction[] = ["play", "stop", "next", "clear", "load_playlist"];

export function parsePlaylistCmdSpec(raw: unknown): ApiPlaylistCmdSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.type !== "cmd") return null;
  const action = String(o.action ?? "") as PlaylistCmdAction;
  if (!CMD_ACTIONS.includes(action)) return null;
  const playlistId = typeof o.playlistId === "string" && o.playlistId.trim() ? o.playlistId.trim() : undefined;
  if (action === "load_playlist" && !playlistId) return null;
  return {
    type: "cmd",
    action,
    playlistId,
    replace: o.replace === true,
  };
}

export function parsePlaylistContainerSpec(raw: unknown): ApiPlaylistContainerSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.type !== "container") return null;
  const playlistId = typeof o.playlistId === "string" ? o.playlistId.trim() : "";
  if (!playlistId) return null;
  return { type: "container", playlistId };
}

/** Codifica el comando en `PlayQueueItem.label` (sin columna JSON en cola). */
export function encodeCmdQueueLabel(spec: ApiPlaylistCmdSpec): string {
  if (spec.action === "load_playlist") {
    const id = spec.playlistId ?? "";
    return spec.replace ? `load!:${id}` : `load:${id}`;
  }
  return spec.action;
}

export function parseCmdQueueLabel(label: string | null | undefined): ApiPlaylistCmdSpec | null {
  if (!label) return null;
  const t = label.trim();
  if (t === "play" || t === "stop" || t === "next" || t === "clear") {
    return { type: "cmd", action: t };
  }
  const m = /^load(!?):(.+)$/.exec(t);
  if (m?.[2]) {
    return { type: "cmd", action: "load_playlist", playlistId: m[2], replace: m[1] === "!" };
  }
  return null;
}

export function cmdActionLabel(action: PlaylistCmdAction): string {
  switch (action) {
    case "play":
      return "Play";
    case "stop":
      return "Stop";
    case "next":
      return "Next";
    case "clear":
      return "Clear queue";
    case "load_playlist":
      return "Load playlist";
    default:
      return action;
  }
}

export function cmdDisplayTitle(spec: ApiPlaylistCmdSpec, humanLabel?: string | null): string {
  const base = humanLabel?.trim() || cmdActionLabel(spec.action);
  if (spec.action === "load_playlist") {
    return spec.replace ? `${base} (reemplazar)` : `${base} (añadir)`;
  }
  return base;
}
