import type { AppSettings } from "@prisma/client";
import { parseExtraStreamingTargetIds, serializeExtraStreamingTargetIds } from "./extra-streaming-targets.js";

export function failoverBackupIdsFromSettings(
  settings: Pick<AppSettings, "streamingFailoverBackupTargetIdsJson" | "streamingFailoverBackupTargetId">,
): string[] {
  const fromJson = parseExtraStreamingTargetIds(settings.streamingFailoverBackupTargetIdsJson);
  if (fromJson.length > 0) return fromJson.slice(0, 5);
  const legacy = settings.streamingFailoverBackupTargetId?.trim();
  return legacy ? [legacy] : [];
}

export function serializeFailoverBackupIds(ids: string[]): string | null {
  return serializeExtraStreamingTargetIds(ids.slice(0, 5));
}
