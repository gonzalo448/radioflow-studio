import { useEffect, useState } from "react";
import { apiUrl } from "../lib/api-base";
import {
  SETTINGS_BRANDING_EVENT,
  applyStationTitle,
  type SettingsBrandingDetail,
} from "../lib/settings-branding";

function normalizeStationName(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed || null;
}

/** Marca visible: nombre y logo de emisora (se actualiza al editar en Ajustes). */
export function useAppSettingsBranding() {
  const [stationName, setStationName] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoVersion, setLogoVersion] = useState(0);

  useEffect(() => {
    const ac = new AbortController();
    void fetch(apiUrl("/api/settings"), { signal: ac.signal })
      .then(async (r) => {
        if (!r.ok || ac.signal.aborted) return;
        const s = (await r.json()) as { stationName?: string; logoUrl?: string | null };
        if (!ac.signal.aborted) {
          setStationName(normalizeStationName(s.stationName));
          setLogoUrl(s.logoUrl?.trim() || null);
          applyStationTitle(s.stationName);
        }
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
      });
    return () => ac.abort();
  }, []);

  useEffect(() => {
    const onUpdate = (event: Event) => {
      const detail = (event as CustomEvent<SettingsBrandingDetail>).detail;
      if (detail.stationName !== undefined) {
        const name = normalizeStationName(detail.stationName);
        setStationName(name);
        applyStationTitle(name);
      }
      if (detail.logoUrl !== undefined) {
        setLogoUrl(detail.logoUrl?.trim() || null);
        setLogoVersion((v) => v + 1);
      }
    };
    window.addEventListener(SETTINGS_BRANDING_EVENT, onUpdate);
    return () => window.removeEventListener(SETTINGS_BRANDING_EVENT, onUpdate);
  }, []);

  return { stationName, logoUrl, logoVersion };
}
