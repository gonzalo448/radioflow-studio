import type { AppSettings } from "@prisma/client";

export function parseExtraStreamingTargetIds(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  try {
    const j = JSON.parse(raw) as unknown;
    if (!Array.isArray(j)) return [];
    return j.filter((id): id is string => typeof id === "string" && id.length > 0);
  } catch {
    return [];
  }
}

export function serializeExtraStreamingTargetIds(ids: string[]): string | null {
  const unique = [...new Set(ids.filter(Boolean))];
  return unique.length > 0 ? JSON.stringify(unique) : null;
}

export function extraIdsFromSettings(settings: Pick<AppSettings, "extraStreamingTargetIds">): string[] {
  return parseExtraStreamingTargetIds(settings.extraStreamingTargetIds);
}
