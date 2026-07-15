import type { PlayAction, Prisma } from "@prisma/client";
import { prisma } from "../db.js";

export async function writePlayLog(input: {
  action: PlayAction;
  stationId?: string;
  assetId?: string | null;
  userId?: string | null;
  details?: Record<string, unknown> | null;
}) {
  try {
    await prisma.playLog.create({
      data: {
        action: input.action,
        stationId: input.stationId ?? "main",
        assetId: input.assetId ?? undefined,
        userId: input.userId ?? undefined,
        details: input.details === undefined || input.details === null ? undefined : (input.details as Prisma.InputJsonValue),
      },
    });
  } catch (e) {
    console.error("[play-log]", e);
  }
}
