import type { ApiNowPlayingInfo, ApiPlaySegmentSpec, ApiPublicNowPlaying, ApiStationAsset } from "@radioflow/shared";
import { buildPlaySegmentSpec, buildVoiceTrackOverlaySpec } from "@radioflow/shared";
import { apiPathUrl } from "../lib/api-base-url.js";
import { logTrackPlayed } from "../lib/automation-log.js";
import { getOrCreateSettings } from "./app-settings.js";
import { getStationState } from "./station-state.js";

function voiceTrackAirOverlayEnabled(): boolean {
  const raw = (process.env.VOICE_TRACK_BRIDGE_AIR ?? "1").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off";
}

function voiceTrackAirDuckDb(): number {
  const n = Number(process.env.VOICE_TRACK_AIR_DUCK_DB ?? "12");
  return Number.isFinite(n) ? n : 12;
}

type NowPlayingAsset = {
  id: string;
  title: string;
  artist: string | null;
  album?: string | null;
  coverPath?: string | null;
  path?: string;
  cueStartSec?: number | null;
  cueEndSec?: number | null;
  durationSec?: number | null;
  playbackGainDb?: number;
};

let trackStartedAt: { assetId: string; startedAt: Date } | null = null;

/** Registra cuándo empezó la pista al aire (memoria; se actualiza al cambiar assetId). */
export function syncNowPlayingTracker(assetId: string | null, details?: Record<string, unknown>): void {
  if (!assetId) {
    trackStartedAt = null;
    return;
  }
  if (trackStartedAt?.assetId === assetId) return;
  trackStartedAt = { assetId, startedAt: new Date() };
  logTrackPlayed(assetId, details);
}

function coverUrlForAsset(origin: string, asset: NowPlayingAsset | null, stationLogoUrl: string | null): string | null {
  if (asset?.coverPath) {
    return apiPathUrl(origin, `/api/library/assets/${asset.id}/cover`);
  }
  return stationLogoUrl;
}

function stationLogoUrlFromSettings(origin: string, logoUrl: string | null): string | null {
  if (!logoUrl?.trim()) return null;
  const trimmed = logoUrl.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return apiPathUrl(origin, trimmed.startsWith("/") ? trimmed : `/${trimmed}`);
}

export function buildNowPlayingInfo(input: {
  origin: string;
  stationName: string;
  logoUrl: string | null;
  nowPlaying: NowPlayingAsset | null;
  startedAt?: string | null;
  playSegment?: ApiPlaySegmentSpec | null;
}): ApiNowPlayingInfo | null {
  const np = input.nowPlaying;
  if (!np) return null;

  const stationLogoUrl = stationLogoUrlFromSettings(input.origin, input.logoUrl);
  const coverUrl = coverUrlForAsset(input.origin, np, stationLogoUrl);

  return {
    assetId: np.id,
    title: np.title,
    artist: np.artist ?? null,
    album: np.album ?? null,
    coverUrl,
    stationLogoUrl,
    stationName: input.stationName,
    startedAt: input.startedAt ?? null,
    playSegment: input.playSegment ?? null,
  };
}

function playSegmentFromState(state: Awaited<ReturnType<typeof getStationState>>): ApiPlaySegmentSpec | null {
  const np = state.nowPlaying;
  if (!np?.path) return null;
  return buildPlaySegmentSpec(np as ApiStationAsset, {
    cabCrossfadeSec: state.station.cabCrossfadeSec,
    cabFadeInSec: state.station.cabFadeInSec,
    cabFadeOutSec: state.station.cabFadeOutSec,
    cabReferenceGainDb: state.station.cabReferenceGainDb,
  });
}

export async function getPublicNowPlaying(origin: string): Promise<ApiPublicNowPlaying> {
  const [state, settings] = await Promise.all([getStationState(), getOrCreateSettings()]);
  const assetId = state.nowPlaying?.id ?? null;
  syncNowPlayingTracker(assetId);

  const startedAt =
    assetId && trackStartedAt && trackStartedAt.assetId === assetId
      ? trackStartedAt.startedAt.toISOString()
      : null;

  const playSegment = playSegmentFromState(state);
  const now = buildNowPlayingInfo({
    origin,
    stationName: settings.stationName,
    logoUrl: settings.logoUrl,
    nowPlaying: state.nowPlaying,
    startedAt,
    playSegment,
  });

  return {
    playing: now !== null,
    now,
    fetchedAt: new Date().toISOString(),
  };
}

export async function enrichStationState(origin: string) {
  const [state, settings] = await Promise.all([getStationState(), getOrCreateSettings()]);
  const assetId = state.nowPlaying?.id ?? null;
  syncNowPlayingTracker(assetId);
  const startedAt =
    assetId && trackStartedAt && trackStartedAt.assetId === assetId
      ? trackStartedAt.startedAt.toISOString()
      : null;
  const playSegment = playSegmentFromState(state);
  const voiceTrackOverlay = buildVoiceTrackOverlaySpec(
    state.queue.map((q) => ({
      kind: q.kind,
      asset: q.asset
        ? {
            id: q.asset.id,
            path: q.asset.path,
            playbackGainDb: q.asset.playbackGainDb,
            cueStartSec: q.asset.cueStartSec,
            cueEndSec: q.asset.cueEndSec,
            durationSec: q.asset.durationSec,
          }
        : null,
    })),
    state.station.currentPosition,
    state.station.cabCrossfadeSec ?? 4,
    { enabled: voiceTrackAirOverlayEnabled(), duckDb: voiceTrackAirDuckDb() },
  );
  const nowPlayingInfo = buildNowPlayingInfo({
    origin,
    stationName: settings.stationName,
    logoUrl: settings.logoUrl,
    nowPlaying: state.nowPlaying,
    startedAt,
    playSegment,
  });
  return { ...state, nowPlayingInfo, playSegment, voiceTrackOverlay };
}
