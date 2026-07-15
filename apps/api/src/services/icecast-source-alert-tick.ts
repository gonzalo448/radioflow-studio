/**
 * A7 — Alerta si la fuente Icecast (o el encoder) está caído más de N minutos
 * mientras `broadcastEnabled` está activo. No requiere Cabina abierta.
 */
import type { Env } from "../config.js";
import { prisma } from "../db.js";
import { logAutomation } from "../lib/automation-log.js";
import { probeIcecastStatus } from "../lib/icecast-status.js";
import { getEncoderHeartbeat } from "./encoder-status-store.js";
import { getOrCreateSettings } from "./app-settings.js";

export type IcecastSourceAlertStatus = {
  monitoring: boolean;
  active: boolean;
  downSince: string | null;
  downForMs: number;
  thresholdMs: number;
  lastAlertAt: string | null;
  lastRecoveredAt: string | null;
  reason: string | null;
  targetId: string | null;
  targetName: string | null;
};

let downSinceMs: number | null = null;
let lastAlertAtMs: number | null = null;
let lastRecoveredAtMs: number | null = null;
let lastReason: string | null = null;
let lastTargetId: string | null = null;
let lastTargetName: string | null = null;
let alertedThisIncident = false;

function isSourceHealthy(probe: {
  sourceConnected: boolean | null;
  error: string | null;
}): { ok: boolean; reason: string | null } {
  if (probe.error) return { ok: false, reason: `probe_error:${probe.error}` };
  if (probe.sourceConnected === false) return { ok: false, reason: "source_disconnected" };
  if (probe.sourceConnected == null) return { ok: false, reason: "source_unknown" };
  return { ok: true, reason: null };
}

async function postWebhook(url: string, body: Record<string, unknown>): Promise<void> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8_000);
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "RadioFlow-Studio/icecast-source-alert" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

export function readIcecastSourceAlertStatus(env: Env): IcecastSourceAlertStatus {
  const thresholdMs = env.ICECAST_SOURCE_ALERT_AFTER_MS;
  const now = Date.now();
  const downForMs = downSinceMs != null ? Math.max(0, now - downSinceMs) : 0;
  return {
    monitoring: env.ICECAST_SOURCE_ALERT_POLL_MS > 0,
    active: alertedThisIncident && downSinceMs != null && downForMs >= thresholdMs,
    downSince: downSinceMs != null ? new Date(downSinceMs).toISOString() : null,
    downForMs,
    thresholdMs,
    lastAlertAt: lastAlertAtMs != null ? new Date(lastAlertAtMs).toISOString() : null,
    lastRecoveredAt: lastRecoveredAtMs != null ? new Date(lastRecoveredAtMs).toISOString() : null,
    reason: lastReason,
    targetId: lastTargetId,
    targetName: lastTargetName,
  };
}

export async function runIcecastSourceAlertTick(env: Env): Promise<void> {
  if (env.ICECAST_SOURCE_ALERT_POLL_MS <= 0) return;

  const settings = await getOrCreateSettings();
  const broadcastOn = settings.broadcastEnabled === true;
  const targetId = settings.activeStreamingTargetId ?? null;

  if (!broadcastOn || !targetId) {
    // Sin emisión esperada: no alertar; limpia estado de caída.
    downSinceMs = null;
    lastReason = null;
    lastTargetId = null;
    lastTargetName = null;
    alertedThisIncident = false;
    return;
  }

  const target = await prisma.streamingTarget.findUnique({ where: { id: targetId } });
  if (!target?.enabled) {
    downSinceMs = null;
    lastReason = null;
    alertedThisIncident = false;
    return;
  }

  lastTargetId = target.id;
  lastTargetName = target.name;

  let unhealthyReason: string | null = null;

  if (target.protocol === "icecast" || target.protocol === "azuracast") {
    const probe = await probeIcecastStatus({
      host: target.host,
      port: target.port,
      mountPath: target.mountPath,
      tls: target.tls,
      publicBaseUrl: target.publicBaseUrl,
    });
    const src = isSourceHealthy(probe);
    if (!src.ok) unhealthyReason = src.reason;
  } else {
    // Shoutcast u otros sin status-json: heartbeat del encoder.
    const enc = getEncoderHeartbeat(env.ENCODER_HEARTBEAT_STALE_MS);
    if (!enc || enc.stale) unhealthyReason = "encoder_stale";
    else if (!enc.ffmpegActive) unhealthyReason = "encoder_inactive";
  }

  const now = Date.now();
  if (!unhealthyReason) {
    if (downSinceMs != null && alertedThisIncident) {
      lastRecoveredAtMs = now;
      logAutomation("icecast_source_recovered", {
        targetId: target.id,
        targetName: target.name,
        downForMs: now - downSinceMs,
        previousReason: lastReason,
      });
      const webhook = env.ICECAST_SOURCE_ALERT_WEBHOOK_URL;
      if (webhook) {
        void postWebhook(webhook, {
          event: "icecast_source_recovered",
          targetId: target.id,
          targetName: target.name,
          downForMs: now - downSinceMs,
          at: new Date(now).toISOString(),
        }).catch(() => {});
      }
    }
    downSinceMs = null;
    lastReason = null;
    alertedThisIncident = false;
    return;
  }

  lastReason = unhealthyReason;
  if (downSinceMs == null) downSinceMs = now;

  const downForMs = now - downSinceMs;
  const threshold = env.ICECAST_SOURCE_ALERT_AFTER_MS;
  if (downForMs < threshold) return;

  const cooldown = env.ICECAST_SOURCE_ALERT_COOLDOWN_MS;
  if (alertedThisIncident && lastAlertAtMs != null && now - lastAlertAtMs < cooldown) return;

  lastAlertAtMs = now;
  alertedThisIncident = true;
  logAutomation("icecast_source_down", {
    targetId: target.id,
    targetName: target.name,
    reason: unhealthyReason,
    downForMs,
    thresholdMs: threshold,
    host: target.host,
    port: target.port,
    mountPath: target.mountPath,
  });

  const webhook = env.ICECAST_SOURCE_ALERT_WEBHOOK_URL;
  if (webhook) {
    void postWebhook(webhook, {
      event: "icecast_source_down",
      targetId: target.id,
      targetName: target.name,
      reason: unhealthyReason,
      downForMs,
      thresholdMs: threshold,
      listenHint: `${target.host}:${target.port}${target.mountPath}`,
      at: new Date(now).toISOString(),
    }).catch(() => {});
  }
}
