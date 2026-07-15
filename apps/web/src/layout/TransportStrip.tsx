import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { apiFetch } from "../lib/api";
import { useStationAirPlayback } from "../station/StationAirPlaybackContext";
import { formatPauseRemaining } from "../station/pause-countdown";
import { useStationLive } from "../station/StationLiveContext";

/** Controles compactos tipo barra de transporte (debajo del área de trabajo). */
export function TransportStrip() {
  const { token } = useAuth();
  const { state, wsStatus, refresh } = useStationLive();
  const { play, pause, getLeadAudio, airAssetId, pauseCountdown, onAirDisplay } = useStationAirPlayback();

  const qLen = state?.queue.length ?? 0;
  const mode = state?.station.mode ?? "—";
  const pauseActive = Boolean(pauseCountdown && onAirDisplay.commandEntry?.kind === "pause");

  async function skip() {
    if (!token) return;
    try {
      await apiFetch("/api/station/skip", { method: "POST", token });
      await refresh();
    } catch {
      /* */
    }
  }

  return (
    <div className="transport-strip" role="toolbar" aria-label="Transporte y estado">
      <span className="transport-meta mono small">
        Modo <strong>{mode}</strong> · cola <strong>{qLen}</strong>
        {pauseActive && pauseCountdown ? (
          <>
            {" "}
            · pausa <strong>{formatPauseRemaining(pauseCountdown.remainingSec)}</strong>
          </>
        ) : null}
      </span>
      <div className="transport-actions">
        <button
          type="button"
          className="btn btn-compact"
          disabled={!airAssetId}
          onClick={() => void play().catch(() => {})}
          title="Reproducir referencia al aire"
        >
          Reproducir
        </button>
        <button
          type="button"
          className="btn btn-compact"
          disabled={!airAssetId || getLeadAudio()?.paused !== false}
          onClick={() => pause()}
          title="Pausar referencia al aire"
        >
          Pausar
        </button>
        <button type="button" className="btn btn-compact" disabled={!token || !qLen} onClick={() => void skip()}>
          Siguiente
        </button>
        <Link to="/station" className="btn btn-compact ghost-link">
          Cabina completa
        </Link>
      </div>
      <span className={`transport-ws ws-${wsStatus}`} title="WebSocket estación">
        WS {wsStatus === "live" ? "●" : wsStatus === "connecting" ? "◐" : wsStatus === "error" ? "✕" : "○"}
      </span>
    </div>
  );
}
