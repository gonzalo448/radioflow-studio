import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import type { ApiPlaylistCmdSpec, QueueEntryKind } from "@radioflow/shared";
import {
  cmdDisplayTitle,
  encodeCmdQueueLabel,
  parsePlaylistCmdSpec,
} from "./playlist-cmd-spec.js";

function defaultHourMarkerLabel(): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

export async function insertPlaylistCommandItem(opts: {
  playlistId: string;
  kind: "pause" | "marker" | "note" | "hour_marker" | "dtmf" | "cmd" | "container";
  label?: string;
  pauseSec?: number;
  cmdSpec?: Omit<ApiPlaylistCmdSpec, "type"> & { action: ApiPlaylistCmdSpec["action"] };
  containerPlaylistId?: string;
  insertAfterItemId?: string | null;
}) {
  const pl = await prisma.playlist.findUnique({ where: { id: opts.playlistId } });
  if (!pl) return null;

  let label = opts.label?.trim() || null;
  let pauseSec: number | null = null;
  let trackListSpec: Prisma.InputJsonValue | undefined;

  if (opts.kind === "pause") {
    pauseSec = Math.max(0, Math.min(3600, opts.pauseSec ?? 5));
  }
  if (opts.kind === "hour_marker" && !label) {
    label = `Hora ${defaultHourMarkerLabel()}`;
  }
  if (opts.kind === "dtmf") {
    const digit = opts.label?.trim() ?? "";
    if (!/^[0-9*#]$/.test(digit)) {
      throw new Error("Tecla DTMF inválida (0–9, * o #)");
    }
    label = digit;
  }
  if (opts.kind === "cmd") {
    const raw = { type: "cmd" as const, ...(opts.cmdSpec ?? { action: "next" as const }) };
    const spec = parsePlaylistCmdSpec(raw);
    if (!spec) throw new Error("Comando inválido (action / playlistId)");
    if (spec.action === "load_playlist" && spec.playlistId) {
      const target = await prisma.playlist.findUnique({ where: { id: spec.playlistId } });
      if (!target) throw new Error("Playlist a cargar no encontrada");
      if (!label) label = `Cargar «${target.name}»`;
    } else if (!label) {
      label = cmdDisplayTitle(spec);
    }
    trackListSpec = spec as unknown as Prisma.InputJsonValue;
    // En cola el label máquina se escribe al sync; en playlist guardamos título humano + spec.
  }
  if (opts.kind === "container") {
    const nestedId = opts.containerPlaylistId?.trim() || "";
    if (!nestedId) throw new Error("containerPlaylistId requerido");
    if (nestedId === opts.playlistId) throw new Error("Un container no puede referenciarse a sí mismo");
    const nested = await prisma.playlist.findUnique({ where: { id: nestedId } });
    if (!nested) throw new Error("Playlist del container no encontrada");
    trackListSpec = { type: "container", playlistId: nestedId } as unknown as Prisma.InputJsonValue;
    if (!label) label = `Container «${nested.name}»`;
  }

  return prisma.$transaction(async (tx) => {
    const items = await tx.playlistItem.findMany({
      where: { playlistId: opts.playlistId },
      orderBy: { position: "asc" },
    });

    let insertAt = items.length;
    if (opts.insertAfterItemId) {
      const after = items.find((i) => i.id === opts.insertAfterItemId);
      if (after) insertAt = after.position + 1;
    }

    const toShift = items.filter((i) => i.position >= insertAt).sort((a, b) => b.position - a.position);
    for (const row of toShift) {
      await tx.playlistItem.update({
        where: { id: row.id },
        data: { position: row.position + 1 },
      });
    }

    await tx.playlistItem.create({
      data: {
        playlistId: opts.playlistId,
        kind: opts.kind as QueueEntryKind,
        label,
        pauseSec,
        ...(trackListSpec !== undefined ? { trackListSpec } : {}),
        position: insertAt,
      },
    });

    const full = await tx.playlist.findUnique({
      where: { id: opts.playlistId },
      include: { items: { orderBy: { position: "asc" }, include: { asset: true } } },
    });
    return full;
  });
}

/** Reexport para sync de cola. */
export { encodeCmdQueueLabel };
