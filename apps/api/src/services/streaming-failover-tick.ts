import { prisma } from "../db.js";
import { logAutomation } from "../lib/automation-log.js";
import { probeIcecastStatus } from "../lib/icecast-status.js";
import { failoverBackupIdsFromSettings } from "../lib/streaming-failover-chain.js";
import { getOrCreateSettings } from "./app-settings.js";

let primaryFailStreak = 0;
let backupFailStreak = 0;
let lastSwitchAt: Date | null = null;

export type StreamingFailoverStatus = {
  enabled: boolean;
  onBackup: boolean;
  primaryTargetId: string | null;
  backupTargetId: string | null;
  backupChain: string[];
  activeBackupIndex: number;
  activeTargetId: string | null;
  primaryFailStreak: number;
  backupFailStreak: number;
  lastSwitchAt: string | null;
};

async function probeTarget(target: {
  host: string;
  port: number;
  mountPath: string;
  tls: boolean;
  publicBaseUrl: string | null;
  protocol: string;
}) {
  if (target.protocol !== "icecast" && target.protocol !== "azuracast") {
    return { sourceConnected: false as boolean | null, error: "protocol_not_supported" };
  }
  return probeIcecastStatus({
    host: target.host,
    port: target.port,
    mountPath: target.mountPath,
    tls: target.tls,
    publicBaseUrl: target.publicBaseUrl,
  });
}

async function loadTarget(id: string) {
  return prisma.streamingTarget.findUnique({ where: { id } });
}

/** Tick: cadena de respaldos ordenada (hasta 5) si el destino activo pierde fuente. */
export async function runStreamingFailoverTick(): Promise<void> {
  const settings = await getOrCreateSettings();
  const enabled = settings.streamingFailoverEnabled ?? false;
  const chain = failoverBackupIdsFromSettings(settings);
  const activeId = settings.activeStreamingTargetId ?? null;

  if (!enabled || chain.length === 0 || !activeId) {
    primaryFailStreak = 0;
    backupFailStreak = 0;
    return;
  }

  const storedPrimaryId = settings.streamingFailoverPrimaryTargetId ?? null;
  const backupIndex = settings.streamingFailoverActiveBackupIndex ?? -1;
  const onBackup = backupIndex >= 0 && storedPrimaryId != null;
  const primaryId = storedPrimaryId ?? activeId;

  if (onBackup) {
    const active = await loadTarget(activeId);
    if (!active?.enabled) return;

    const stActive = await probeTarget(active);
    const activeOk = stActive.sourceConnected === true && !stActive.error;

    if (!activeOk) {
      backupFailStreak += 1;
      if (backupFailStreak >= 2) {
        const nextIndex = backupIndex + 1;
        if (nextIndex < chain.length) {
          const nextId = chain[nextIndex]!;
          await prisma.appSettings.update({
            where: { id: "global" },
            data: {
              activeStreamingTargetId: nextId,
              streamingFailoverActiveBackupIndex: nextIndex,
            },
          });
          lastSwitchAt = new Date();
          backupFailStreak = 0;
          logAutomation("streaming_failover", {
            action: "advance_backup_chain",
            fromTargetId: activeId,
            toTargetId: nextId,
            backupIndex: nextIndex,
            reason: stActive.error ?? "source_disconnected",
          });
        }
      }
    } else {
      backupFailStreak = 0;
    }

    if (!(settings.streamingFailoverAutoRevert ?? true)) return;

    const primary = await loadTarget(primaryId);
    if (!primary?.enabled) return;
    const stPrimary = await probeTarget(primary);
    if (stPrimary.sourceConnected !== true || stPrimary.error) return;

    await prisma.appSettings.update({
      where: { id: "global" },
      data: {
        activeStreamingTargetId: primaryId,
        streamingFailoverPrimaryTargetId: null,
        streamingFailoverActiveBackupIndex: -1,
      },
    });
    lastSwitchAt = new Date();
    backupFailStreak = 0;
    logAutomation("streaming_failover", {
      action: "revert_to_primary",
      fromTargetId: activeId,
      toTargetId: primaryId,
    });
    return;
  }

  const primary = await loadTarget(primaryId);
  if (!primary?.enabled) return;

  const st = await probeTarget(primary);
  const sourceOk = st.sourceConnected === true && !st.error;
  if (sourceOk) {
    primaryFailStreak = 0;
    return;
  }

  primaryFailStreak += 1;
  if (primaryFailStreak < 2) return;

  const firstBackup = chain[0]!;
  const backup = await loadTarget(firstBackup);
  if (!backup?.enabled) return;

  await prisma.appSettings.update({
    where: { id: "global" },
    data: {
      activeStreamingTargetId: firstBackup,
      streamingFailoverPrimaryTargetId: primaryId,
      streamingFailoverActiveBackupIndex: 0,
    },
  });
  lastSwitchAt = new Date();
  primaryFailStreak = 0;
  backupFailStreak = 0;
  logAutomation("streaming_failover", {
    action: "switch_to_backup",
    fromTargetId: primaryId,
    toTargetId: firstBackup,
    backupIndex: 0,
    reason: st.error ?? "source_disconnected",
  });
}

export async function readStreamingFailoverStatus(): Promise<StreamingFailoverStatus> {
  const settings = await getOrCreateSettings();
  const chain = failoverBackupIdsFromSettings(settings);
  const storedPrimaryId = settings.streamingFailoverPrimaryTargetId ?? null;
  const activeId = settings.activeStreamingTargetId ?? null;
  const backupIndex = settings.streamingFailoverActiveBackupIndex ?? -1;
  const onBackup = backupIndex >= 0 && storedPrimaryId != null;
  return {
    enabled: settings.streamingFailoverEnabled ?? false,
    onBackup,
    primaryTargetId: storedPrimaryId ?? activeId,
    backupTargetId: chain[backupIndex] ?? chain[0] ?? null,
    backupChain: chain,
    activeBackupIndex: backupIndex,
    activeTargetId: activeId,
    primaryFailStreak,
    backupFailStreak,
    lastSwitchAt: lastSwitchAt?.toISOString() ?? null,
  };
}
