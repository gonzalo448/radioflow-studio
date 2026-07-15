import { Link } from "react-router-dom";
import { queueEntryTitle } from "../lib/queue-entry-display";
import { buildPlaybackUpcomingOrdered } from "../station/playback-upcoming-order";
import { useStationLive } from "../station/StationLiveContext";

export function ShellQueuePeek() {
  const { state } = useStationLive();
  const q = state?.queue ?? [];
  const pos = state?.station?.currentPosition ?? 0;
  const pq = state?.playbackQueue ?? [];
  const combined = buildPlaybackUpcomingOrdered(q, pos, pq);

  return (
    <div className="shell-rail-panel">
      <div className="shell-rail-head">
        <strong>Siguientes en cola</strong>
        <Link to="/station" className="shell-rail-link">
          Cabina
        </Link>
      </div>
      {combined.length === 0 ? (
        <p className="shell-rail-muted small">No hay pistas en cola de reproducción ni después de la posición actual.</p>
      ) : (
        <ol className="shell-rail-queue">
          {combined.map((item) => {
            const isPq = pq.some((e) => e.playQueueItemId === item.id);
            return (
              <li key={item.id}>
                {isPq ? <span className="shell-rail-q-pq">Cola reprod. · </span> : null}
                <span className="shell-rail-q-title">{queueEntryTitle(item)}</span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
