import type { Env } from "../config.js";
import { prisma } from "../db.js";
import { probeIcecastStatus } from "../lib/icecast-status.js";
import { getOrCreateSettings } from "./app-settings.js";

/** Toma una muestra de oyentes del destino activo y limpia registros antiguos. */
export async function runListenerSampleTick(env: Env): Promise<void> {
  const settings = await getOrCreateSettings();
  if (!settings.activeStreamingTargetId) return;

  const target = await prisma.streamingTarget.findUnique({
    where: { id: settings.activeStreamingTargetId },
  });
  if (!target || (target.protocol !== "icecast" && target.protocol !== "azuracast")) return;

  const st = await probeIcecastStatus({
    host: target.host,
    port: target.port,
    mountPath: target.mountPath,
    tls: target.tls,
    publicBaseUrl: target.publicBaseUrl,
  });

  await prisma.listenerSample.create({
    data: {
      listeners: st.listeners,
      streamTitle: st.streamTitle,
      sourceConnected: st.sourceConnected,
      streamingTargetId: target.id,
      targetName: target.name,
    },
  });

  const retentionDays = env.LISTENER_SAMPLE_RETENTION_DAYS;
  if (retentionDays > 0) {
    const cutoff = new Date(Date.now() - retentionDays * 86_400_000);
    await prisma.listenerSample.deleteMany({ where: { recordedAt: { lt: cutoff } } });
  }
}
