import type { ApiPublicListen } from "@radioflow/shared";
import { prisma } from "../db.js";
import { apiPathUrl } from "../lib/api-base-url.js";
import { buildListenUrl } from "../lib/icecast-status.js";
import { getOrCreateSettings } from "./app-settings.js";

function stationLogoUrlFromSettingsInline(origin: string, logoUrl: string | null): string | null {
  if (!logoUrl?.trim()) return null;
  const trimmed = logoUrl.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return apiPathUrl(origin, trimmed.startsWith("/") ? trimmed : `/${trimmed}`);
}

/** URL de escucha del destino activo (sin sondear Icecast). */
export async function resolveActiveListenUrl(): Promise<{ listenUrl: string | null; targetName: string | null }> {
  const settings = await getOrCreateSettings();
  if (!settings.activeStreamingTargetId) {
    return { listenUrl: null, targetName: null };
  }
  const target = await prisma.streamingTarget.findFirst({
    where: { id: settings.activeStreamingTargetId, enabled: true },
  });
  if (!target) {
    return { listenUrl: null, targetName: null };
  }
  if (target.protocol === "icecast" || target.protocol === "azuracast") {
    return {
      listenUrl: buildListenUrl(target.host, target.port, target.mountPath, target.tls, target.publicBaseUrl),
      targetName: target.name,
    };
  }
  const url = target.publicBaseUrl?.trim() || null;
  return { listenUrl: url, targetName: target.name };
}

export async function getPublicListen(origin: string): Promise<ApiPublicListen> {
  const [settings, stream] = await Promise.all([getOrCreateSettings(), resolveActiveListenUrl()]);
  const stationLogoUrl = stationLogoUrlFromSettingsInline(origin, settings.logoUrl);

  return {
    stationName: settings.stationName,
    tagline: settings.tagline,
    primaryColor: settings.primaryColor,
    stationLogoUrl,
    listenUrl: stream.listenUrl,
    streamTargetName: stream.targetName,
    broadcastEnabled: settings.broadcastEnabled ?? false,
    nowPlayingUrl: apiPathUrl(origin, "/api/public/now-playing"),
  };
}
