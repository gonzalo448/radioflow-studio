import type { FastifyPluginAsync } from "fastify";
import type { Env } from "../config.js";
import { prisma } from "../db.js";
import { optionalAuth, requireRoles, ROLES_REPORTS_READ } from "../lib/auth.js";
import { probeIcecastStatus } from "../lib/icecast-status.js";
import { buildSimpleTextPdf, rowsToCsv } from "../lib/report-export.js";
import { getOrCreateSettings } from "../services/app-settings.js";

export const reportsRoutes: FastifyPluginAsync<{ env: Env }> = async (app, opts) => {
  app.addHook("preHandler", async (request) => optionalAuth(request, opts.env));

  app.get("/reports/play-log", async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_REPORTS_READ)) return;
    const limit = Math.min(
      500,
      Math.max(1, Number((request.query as { limit?: string })?.limit ?? "120")),
    );
    return prisma.playLog.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        user: { select: { id: true, email: true, displayName: true } },
        asset: { select: { id: true, title: true, artist: true } },
      },
    });
  });

  /** Resumen de actividad (RB-061): skips por hora del día + totales recientes. */
  app.get("/reports/playback-summary", async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_REPORTS_READ)) return;
    const days = Math.min(30, Math.max(1, Number((request.query as { days?: string })?.days ?? "7")));
    const since = new Date(Date.now() - days * 86_400_000);

    const rows = await prisma.playLog.findMany({
      where: {
        createdAt: { gte: since },
        action: {
          in: ["SKIP", "PLAYLIST_QUEUE_SYNC", "QUEUE_APPEND", "TRACK_PLAYED", "AUTOMATION"],
        },
      },
      select: { action: true, createdAt: true, assetId: true, details: true },
      orderBy: { createdAt: "desc" },
      take: 8000,
    });

    const byHour = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      skipCount: 0,
      syncCount: 0,
      playedCount: 0,
    }));
    let totalSkips = 0;
    let totalSyncs = 0;
    let totalQueueAppends = 0;
    let totalTracksPlayed = 0;
    let totalAutomation = 0;
    const skippedAssets = new Set<string>();
    const playedAssets = new Set<string>();
    const automationByKind = new Map<string, number>();

    for (const r of rows) {
      const h = r.createdAt.getHours();
      if (r.action === "SKIP") {
        byHour[h].skipCount += 1;
        totalSkips += 1;
        if (r.assetId) skippedAssets.add(r.assetId);
      } else if (r.action === "PLAYLIST_QUEUE_SYNC") {
        byHour[h].syncCount += 1;
        totalSyncs += 1;
      } else if (r.action === "QUEUE_APPEND") {
        totalQueueAppends += 1;
      } else if (r.action === "TRACK_PLAYED") {
        byHour[h].playedCount += 1;
        totalTracksPlayed += 1;
        if (r.assetId) playedAssets.add(r.assetId);
      } else if (r.action === "AUTOMATION") {
        totalAutomation += 1;
        const kind =
          r.details && typeof r.details === "object" && r.details !== null && "kind" in r.details
            ? String((r.details as { kind?: unknown }).kind ?? "unknown")
            : "unknown";
        automationByKind.set(kind, (automationByKind.get(kind) ?? 0) + 1);
      }
    }

    let broadcast: {
      listeners: number | null;
      streamTitle: string | null;
      sourceConnected: boolean | null;
      error: string | null;
    } | null = null;

    try {
      const settings = await getOrCreateSettings();
      if (settings.activeStreamingTargetId) {
        const target = await prisma.streamingTarget.findUnique({
          where: { id: settings.activeStreamingTargetId },
        });
        if (target && (target.protocol === "icecast" || target.protocol === "azuracast")) {
          const st = await probeIcecastStatus({
            host: target.host,
            port: target.port,
            mountPath: target.mountPath,
            tls: target.tls,
            publicBaseUrl: target.publicBaseUrl,
          });
          broadcast = {
            listeners: st.listeners,
            streamTitle: st.streamTitle,
            sourceConnected: st.sourceConnected,
            error: st.error,
          };
        }
      }
    } catch {
      broadcast = null;
    }

    return {
      days,
      since: since.toISOString(),
      totalSkips,
      totalSyncs,
      totalQueueAppends,
      totalTracksPlayed,
      totalAutomation,
      uniqueTracksPlayed: playedAssets.size,
      uniqueTracksSkipped: skippedAssets.size,
      automationByKind: Object.fromEntries(automationByKind),
      byHour,
      broadcast,
    };
  });

  /** Historial al aire: pistas reproducidas + automatización (auditoría). */
  app.get("/reports/air-history", async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_REPORTS_READ)) return;
    const q = request.query as { limit?: string; days?: string };
    const limit = Math.min(500, Math.max(1, Number(q.limit ?? "120")));
    const days = Math.min(30, Math.max(1, Number(q.days ?? "7")));
    const since = new Date(Date.now() - days * 86_400_000);

    return prisma.playLog.findMany({
      where: {
        createdAt: { gte: since },
        action: { in: ["TRACK_PLAYED", "AUTOMATION"] },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        asset: { select: { id: true, title: true, artist: true } },
      },
    });
  });

  /** Historial de oyentes Icecast (RB-133). */
  app.get("/reports/listener-history", async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_REPORTS_READ)) return;
    const hours = Math.min(168, Math.max(1, Number((request.query as { hours?: string })?.hours ?? "24")));
    const since = new Date(Date.now() - hours * 3_600_000);

    const samples = await prisma.listenerSample.findMany({
      where: { recordedAt: { gte: since } },
      orderBy: { recordedAt: "asc" },
      select: {
        recordedAt: true,
        listeners: true,
        streamTitle: true,
        sourceConnected: true,
        targetName: true,
      },
    });

    const values = samples.map((s) => s.listeners).filter((n): n is number => n != null);
    const peak = values.length ? Math.max(...values) : null;
    const avg = values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
    const latest = samples.at(-1) ?? null;

    return {
      hours,
      since: since.toISOString(),
      sampleCount: samples.length,
      peakListeners: peak,
      avgListeners: avg,
      latest: latest
        ? {
            recordedAt: latest.recordedAt.toISOString(),
            listeners: latest.listeners,
            streamTitle: latest.streamTitle,
            sourceConnected: latest.sourceConnected,
            targetName: latest.targetName,
          }
        : null,
      samples: samples.map((s) => ({
        recordedAt: s.recordedAt.toISOString(),
        listeners: s.listeners,
        streamTitle: s.streamTitle,
        sourceConnected: s.sourceConnected,
        targetName: s.targetName,
      })),
    };
  });

  app.get("/reports/play-log/export", async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_REPORTS_READ)) return;
    const q = request.query as { format?: string; limit?: string };
    const format = (q.format ?? "csv").toLowerCase();
    const limit = Math.min(5000, Math.max(1, Number(q.limit ?? "500")));
    const rows = await prisma.playLog.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        user: { select: { email: true, displayName: true } },
        asset: { select: { title: true, artist: true } },
      },
    });

    if (format === "pdf") {
      const lines = rows.slice(0, 40).map((r) => {
        const who = r.user?.email ?? "—";
        const track = r.asset ? `${r.asset.artist ?? ""} — ${r.asset.title}`.trim() : "—";
        return `${r.createdAt.toISOString().slice(0, 16)} · ${r.action} · ${who} · ${track}`;
      });
      const pdf = buildSimpleTextPdf(`Play-log (${rows.length} filas)`, lines);
      return reply
        .header("Content-Disposition", 'attachment; filename="play-log.pdf"')
        .type("application/pdf")
        .send(pdf);
    }

    const csvRows = rows.map((r) => ({
      fecha: r.createdAt.toISOString(),
      accion: r.action,
      usuario: r.user?.email ?? "",
      pista: r.asset?.title ?? "",
      artista: r.asset?.artist ?? "",
      assetId: r.assetId ?? "",
    }));
    const csv = rowsToCsv(["fecha", "accion", "usuario", "pista", "artista", "assetId"], csvRows);
    return reply
      .header("Content-Disposition", 'attachment; filename="play-log.csv"')
      .type("text/csv; charset=utf-8")
      .send(csv);
  });

  app.get("/reports/listener-history/export", async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_REPORTS_READ)) return;
    const q = request.query as { format?: string; hours?: string };
    const format = (q.format ?? "csv").toLowerCase();
    const hours = Math.min(168, Math.max(1, Number(q.hours ?? "24")));
    const since = new Date(Date.now() - hours * 3_600_000);
    const samples = await prisma.listenerSample.findMany({
      where: { recordedAt: { gte: since } },
      orderBy: { recordedAt: "asc" },
    });

    if (format === "pdf") {
      const lines = samples.slice(-40).map(
        (s) =>
          `${s.recordedAt.toISOString().slice(0, 16)} · oyentes ${s.listeners ?? "—"} · ${s.targetName ?? ""}`,
      );
      const pdf = buildSimpleTextPdf(`Oyentes (${hours}h)`, lines);
      return reply
        .header("Content-Disposition", 'attachment; filename="oyentes.pdf"')
        .type("application/pdf")
        .send(pdf);
    }

    const csvRows = samples.map((s) => ({
      fecha: s.recordedAt.toISOString(),
      oyentes: s.listeners ?? "",
      titulo: s.streamTitle ?? "",
      fuente: s.sourceConnected ? "si" : "no",
      destino: s.targetName ?? "",
    }));
    const csv = rowsToCsv(["fecha", "oyentes", "titulo", "fuente", "destino"], csvRows);
    return reply
      .header("Content-Disposition", 'attachment; filename="oyentes.csv"')
      .type("text/csv; charset=utf-8")
      .send(csv);
  });
};
