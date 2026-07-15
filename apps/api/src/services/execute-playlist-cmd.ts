import type { Env } from "../config.js";
import { prisma } from "../db.js";
import { parseCmdQueueLabel } from "../lib/playlist-cmd-spec.js";
import { broadcastStationState } from "../realtime/station-hub.js";
import { syncQueueFromPlaylist } from "./queue-from-playlist.js";
import { MAIN_STATION_ID } from "./station-state.js";

export type PlaylistCmdExecResult = {
  /** Si true, el caller debe hacer skipStation para salir del ítem cmd. */
  shouldSkip: boolean;
};

/**
 * Ejecuta un ítem `cmd` de la cola (label máquina: play|stop|next|clear|load:…).
 * play/stop en headless no tienen motor de audio: solo avanzan.
 */
export async function executePlaylistCmdLabel(
  label: string | null | undefined,
  env: Env,
): Promise<PlaylistCmdExecResult> {
  const spec = parseCmdQueueLabel(label);
  if (!spec) return { shouldSkip: true };

  if (spec.action === "clear") {
    await prisma.playQueueItem.deleteMany({ where: { stationId: MAIN_STATION_ID } });
    await prisma.station.update({ where: { id: MAIN_STATION_ID }, data: { currentPosition: 0 } });
    void broadcastStationState();
    return { shouldSkip: false };
  }

  if (spec.action === "load_playlist" && spec.playlistId) {
    const replace = spec.replace !== false;
    await syncQueueFromPlaylist({
      playlistId: spec.playlistId,
      replace,
      scheduleBlockId: null,
      userId: null,
      env,
    });
    // replace ya regeneró la cola; append deja el cmd al aire → hay que saltarlo.
    return { shouldSkip: !replace };
  }

  // play | stop | next → avanzar al siguiente ítem
  return { shouldSkip: true };
}
