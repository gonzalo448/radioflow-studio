import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { queueEntryTitle } from "../lib/queue-entry-display";
import { formatOnAirLabel, formatOnAirOrCommand } from "../station/on-air-display";
import { formatPauseRemaining } from "../station/pause-countdown";
import { useStationAirPlayback } from "../station/StationAirPlaybackContext";

function isStationPath(pathname: string): boolean {
  return pathname === "/station" || pathname.endsWith("/station");
}

function secondsUntilNextHour(): number {
  const now = new Date();
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  return Math.max(0, Math.round((next.getTime() - now.getTime()) / 1000));
}

function fmtCountdown(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function NowPlayingRibbon() {
  const location = useLocation();
  const { onAirDisplay, pauseCountdown } = useStationAirPlayback();
  const [hourCountdown, setHourCountdown] = useState(secondsUntilNextHour);

  useEffect(() => {
    const t = window.setInterval(() => setHourCountdown(secondsUntilNextHour()), 1000);
    return () => window.clearInterval(t);
  }, []);

  if (isStationPath(location.pathname)) {
    return null;
  }

  const pauseActive = Boolean(pauseCountdown && onAirDisplay.commandEntry?.kind === "pause");
  const { prev, nextRow } = onAirDisplay;
  const wallClock = new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <div className="now-playing-ribbon" role="region" aria-label="Pistas anterior, al aire y siguiente">
      <div className="now-playing-cell now-playing-cell--clock">
        <span className="now-playing-ribbon-label">Reloj</span>
        <span className="now-playing-ribbon-value mono">
          {wallClock} · top {fmtCountdown(hourCountdown)}
        </span>
      </div>
      <div className="now-playing-cell now-playing-cell--prev">
        <span className="now-playing-ribbon-label">Pista anterior</span>
        <span className="now-playing-ribbon-value">{formatOnAirLabel(prev)}</span>
      </div>
      <div className={`now-playing-cell now-playing-cell--air${pauseActive ? " now-playing-cell--pause" : ""}`}>
        <span className="now-playing-ribbon-label">En el aire</span>
        <span className="now-playing-ribbon-value">
          {pauseActive && pauseCountdown
            ? `${formatOnAirOrCommand(onAirDisplay)} · ${formatPauseRemaining(pauseCountdown.remainingSec)}`
            : formatOnAirOrCommand(onAirDisplay)}
        </span>
      </div>
      <div className="now-playing-cell now-playing-cell--next">
        <span className="now-playing-ribbon-label">Pista siguiente</span>
        <span className="now-playing-ribbon-value">{nextRow ? queueEntryTitle(nextRow) : "—"}</span>
      </div>
    </div>
  );
}
