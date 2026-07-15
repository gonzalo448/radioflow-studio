import { useStationAirPlayback } from "./StationAirPlaybackContext";
import { useAirQualityMonitor } from "./useAirQualityMonitor";

/** Banner de alertas de silencio/clipping (no bloquea la cabina). */
export function AirQualityBanner() {
  const { airAssetId, airPlayback } = useStationAirPlayback();
  const playing = airPlayback.duration > 0 && airPlayback.current < airPlayback.duration - 0.5;
  const { alert, clearAlert } = useAirQualityMonitor(playing, airAssetId);

  if (!alert) return null;

  return (
    <div className={`air-quality-banner air-quality-banner--${alert.kind}`} role="alert">
      <span>{alert.message}</span>
      <button type="button" className="btn btn-compact ghost" onClick={clearAlert}>
        Cerrar
      </button>
    </div>
  );
}
