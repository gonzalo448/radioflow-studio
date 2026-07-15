import { getOrCreateSettings } from "../services/app-settings.js";

export type RdsContext = {
  title?: string | null;
  artist?: string | null;
  stationName?: string | null;
};

/** Sustituye {title}, {artist}, {station} en plantilla RDS. */
export function formatRdsText(template: string, ctx: RdsContext): string {
  return template
    .replace(/\{title\}/gi, (ctx.title ?? "").trim() || "RadioFlow")
    .replace(/\{artist\}/gi, (ctx.artist ?? "").trim())
    .replace(/\{station\}/gi, (ctx.stationName ?? "").trim() || "RadioFlow Studio")
    .trim();
}

export async function resolveRdsLine(ctx: RdsContext): Promise<string | null> {
  const settings = await getOrCreateSettings();
  if (!settings.rdsEnabled || !settings.rdsText?.trim()) return null;
  return formatRdsText(settings.rdsText, ctx);
}
