import { absoluteApiUrl } from "./absolute-api-url";

const STATION_LOGO_API = "/api/settings/station-logo";

/** URL absoluta del logo de emisora para `<img src>`. */
export function resolveStationLogoSrc(logoUrl: string | null | undefined): string | null {
  const trimmed = logoUrl?.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed === STATION_LOGO_API || trimmed.endsWith(STATION_LOGO_API)) {
    return absoluteApiUrl(STATION_LOGO_API);
  }
  if (trimmed.startsWith("/")) return absoluteApiUrl(trimmed);
  return absoluteApiUrl(`/${trimmed}`);
}

export { STATION_LOGO_API };
