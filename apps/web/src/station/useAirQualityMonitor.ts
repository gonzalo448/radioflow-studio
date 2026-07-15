import { useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { apiFetch } from "../lib/api";
import { useStationAirPlayback } from "./StationAirPlaybackContext";

const SILENCE_PEAK = 0.002;
const CLIP_PEAK = 0.98;
const SILENCE_SEC = 6;
const CLIP_HOLD_SEC = 1.5;
const ALERT_COOLDOWN_MS = 120_000;

export type AirQualityAlert = {
  kind: "air_silence" | "air_clipping";
  message: string;
  at: number;
};

/**
 * Monitoriza el bus de audio de cabina: silencio prolongado o clipping.
 * Registra alertas en el play-log (auditoría) con debounce.
 */
export function useAirQualityMonitor(playing: boolean, assetId: string | null) {
  const { token } = useAuth();
  const { subscribeMeterFrame } = useStationAirPlayback();
  const [alert, setAlert] = useState<AirQualityAlert | null>(null);
  const silenceSecRef = useRef(0);
  const clipSecRef = useRef(0);
  const lastAlertRef = useRef(0);
  const rafRef = useRef(0);
  const lastPeakRef = useRef(0);
  const lastTickRef = useRef(0);

  useEffect(() => {
    if (!playing || !assetId) {
      silenceSecRef.current = 0;
      clipSecRef.current = 0;
      return;
    }

    const unsub = subscribeMeterFrame((sample) => {
      lastPeakRef.current = sample.peak01;
    });

    const tick = (ts: number) => {
      rafRef.current = requestAnimationFrame(tick);
      if (!playing || !assetId) return;
      const prev = lastTickRef.current;
      lastTickRef.current = ts;
      if (!prev) return;
      const dt = Math.min(0.25, (ts - prev) / 1000);
      const peak = lastPeakRef.current;

      if (peak < SILENCE_PEAK) {
        silenceSecRef.current += dt;
        clipSecRef.current = 0;
      } else if (peak >= CLIP_PEAK) {
        clipSecRef.current += dt;
        silenceSecRef.current = 0;
      } else {
        silenceSecRef.current = Math.max(0, silenceSecRef.current - dt * 2);
        clipSecRef.current = Math.max(0, clipSecRef.current - dt * 2);
      }

      const now = Date.now();
      if (now - lastAlertRef.current < ALERT_COOLDOWN_MS) return;

      if (silenceSecRef.current >= SILENCE_SEC) {
        lastAlertRef.current = now;
        silenceSecRef.current = 0;
        const kind = "air_silence" as const;
        setAlert({
          kind,
          message: "Silencio prolongado detectado en el bus al aire",
          at: now,
        });
        if (token) {
          void apiFetch("/api/station/air-quality-alert", {
            method: "POST",
            token,
            body: JSON.stringify({ kind, peak01: peak, assetId }),
          }).catch(() => {});
        }
      } else if (clipSecRef.current >= CLIP_HOLD_SEC) {
        lastAlertRef.current = now;
        clipSecRef.current = 0;
        const kind = "air_clipping" as const;
        setAlert({
          kind,
          message: "Posible clipping en el bus al aire",
          at: now,
        });
        if (token) {
          void apiFetch("/api/station/air-quality-alert", {
            method: "POST",
            token,
            body: JSON.stringify({ kind, peak01: peak, assetId }),
          }).catch(() => {});
        }
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      unsub();
      cancelAnimationFrame(rafRef.current);
      lastTickRef.current = 0;
    };
  }, [playing, assetId, token, subscribeMeterFrame]);

  return { alert, clearAlert: () => setAlert(null) };
}
