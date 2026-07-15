import { useStationAirPlayback } from "../../station/StationAirPlaybackContext";
import { formatPauseRemaining, pauseCountdownProgress } from "../../station/pause-countdown";
import { libraryCoverUrl } from "../../lib/library-cover-url";

type AssetMeta = {
  id: string;
  title: string;
  artist?: string | null;
  album?: string | null;
  genre?: string | null;
  durationSec?: number | null;
  coverPath?: string | null;
};

function fmtDur(sec: number | null | undefined): string {
  if (sec == null || sec <= 0) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Barra inferior : metadatos de la pista al aire. */
export function ShellNowPlayingBar() {
  const { onAirDisplay, airPlayback, pauseCountdown } = useStationAirPlayback();
  const air = onAirDisplay.onAir as AssetMeta | null;
  const pauseActive = Boolean(pauseCountdown && onAirDisplay.commandEntry?.kind === "pause");

  if (pauseActive && pauseCountdown) {
    const pct = pauseCountdownProgress(pauseCountdown);
    return (
      <div className="shell-now-playing shell-now-playing--pause" role="status" aria-live="polite">
        <span className="shell-now-playing-cover-ph shell-now-playing-cover-ph--pause" aria-hidden>
          ⏸
        </span>
        <div className="shell-now-playing-text">
          <strong className="shell-now-playing-title">{pauseCountdown.label}</strong>
          <span className="shell-now-playing-artist">Pausa programada</span>
        </div>
        <div className="shell-now-playing-time mono small">
          {formatPauseRemaining(pauseCountdown.remainingSec)} / {formatPauseRemaining(pauseCountdown.totalSec)}
          <div className="shell-now-playing-bar shell-now-playing-bar--pause" aria-hidden>
            <div className="shell-now-playing-bar-fill shell-now-playing-bar-fill--pause" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>
    );
  }

  if (!air) {
    return (
      <span className="shell-now-playing shell-now-playing--empty muted">
        Sin pista al aire · abra una lista y pulse «Reproducir lista» (o doble clic en una pista)
      </span>
    );
  }

  const dur =
    airPlayback.duration > 0 ? airPlayback.duration : air.durationSec && air.durationSec > 0 ? air.durationSec : null;
  const pct = dur ? Math.min(100, (airPlayback.current / dur) * 100) : 0;

  return (
    <div className="shell-now-playing" role="status" aria-live="polite">
      {libraryCoverUrl(air.id, air.coverPath) ? (
        <img className="shell-now-playing-cover" src={libraryCoverUrl(air.id, air.coverPath)!} alt="" />
      ) : (
        <span className="shell-now-playing-cover-ph" aria-hidden>
          ♪
        </span>
      )}
      <div className="shell-now-playing-text">
        <strong className="shell-now-playing-title">{air.title}</strong>
        <span className="shell-now-playing-artist">{air.artist?.trim() || "—"}</span>
        {air.album ? <span className="shell-now-playing-album muted small"> · {air.album}</span> : null}
        {air.genre ? <span className="shell-now-playing-genre muted small"> · {air.genre}</span> : null}
      </div>
      {dur ? (
        <div className="shell-now-playing-time mono small">
          {fmtDur(airPlayback.current)} / {fmtDur(dur)}
          <div className="shell-now-playing-bar" aria-hidden>
            <div className="shell-now-playing-bar-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
