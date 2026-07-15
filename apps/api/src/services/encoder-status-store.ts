export type EncoderHeartbeatPayload = {
  ffmpegActive: boolean;
  wsConnected: boolean;
  title: string | null;
  artist: string | null;
  album: string | null;
  assetId: string | null;
  coverUrl: string | null;
  stationLogoUrl: string | null;
  lastFfmpegExitCode: number | null;
};

let last: { at: Date; data: EncoderHeartbeatPayload } | null = null;

export function setEncoderHeartbeat(data: EncoderHeartbeatPayload): void {
  last = { at: new Date(), data };
}

export function getEncoderHeartbeat(staleAfterMs: number): {
  at: string;
  stale: boolean;
  ffmpegActive: boolean;
  wsConnected: boolean;
  title: string | null;
  artist: string | null;
  album: string | null;
  assetId: string | null;
  coverUrl: string | null;
  stationLogoUrl: string | null;
  lastFfmpegExitCode: number | null;
} | null {
  if (!last) return null;
  const age = Date.now() - last.at.getTime();
  return {
    at: last.at.toISOString(),
    stale: age > staleAfterMs,
    ...last.data,
  };
}
