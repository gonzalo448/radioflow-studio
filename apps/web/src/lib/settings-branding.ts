export const SETTINGS_BRANDING_EVENT = "radioflow:settings-branding";

export type SettingsBrandingDetail = {
  stationName?: string | null;
  logoUrl?: string | null;
};

export function dispatchSettingsBranding(detail: SettingsBrandingDetail): void {
  window.dispatchEvent(new CustomEvent(SETTINGS_BRANDING_EVENT, { detail }));
}

export function applyStationTitle(stationName: string | null | undefined): void {
  const trimmed = stationName?.trim();
  if (trimmed) document.title = trimmed;
}
