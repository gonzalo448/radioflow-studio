import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type {
  ApiError,
  ApiTimeAnnounceFolderSummary,
  ApiTimeAnnouncePlayResult,
} from "@radioflow/shared";
import type { Env } from "../config.js";
import { optionalAuth, requireRoles, ROLES_SCHEDULE_WRITE } from "../lib/auth.js";
import { playTimeAnnounceNow, summarizeTimeAnnounceFolder } from "../lib/time-announce-play.js";
import { getOrCreateSettings } from "../services/app-settings.js";
import { prisma } from "../db.js";

const setFolderBody = z.object({
  folderAbs: z.string().min(1).max(1024).nullable(),
});

const playBody = z.object({
  /** Si false, añade al final de la cola; default true = tras la canción al aire. */
  afterCurrent: z.boolean().optional(),
  folderAbs: z.string().min(1).max(1024).optional(),
});

export const timeAnnounceRoutes: FastifyPluginAsync<{ env: Env }> = async (app, opts) => {
  app.addHook("preHandler", async (request) => optionalAuth(request, opts.env));

  app.get<{ Reply: ApiTimeAnnounceFolderSummary | ApiError }>(
    "/time-announce/status",
    async (request, reply) => {
      if (!requireRoles(request, reply, ROLES_SCHEDULE_WRITE)) return;
      const settings = await getOrCreateSettings();
      const folderAbs = (settings.timeAnnounceFolderAbs ?? "").trim();
      if (!folderAbs) {
        return {
          folderAbs: "",
          hourFiles: 0,
          hourExactFiles: 0,
          minuteFiles: 0,
          totalAudio: 0,
        };
      }
      return summarizeTimeAnnounceFolder(folderAbs);
    },
  );

  app.put<{ Body: unknown; Reply: ApiTimeAnnounceFolderSummary | ApiError }>(
    "/time-announce/folder",
    async (request, reply) => {
      if (!requireRoles(request, reply, ROLES_SCHEDULE_WRITE)) return;
      const parsed = setFolderBody.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: "Indique folderAbs (ruta absoluta) o null para quitar." });
      }
      const folderAbs = parsed.data.folderAbs?.trim() || null;
      await prisma.appSettings.upsert({
        where: { id: "global" },
        create: { id: "global", timeAnnounceFolderAbs: folderAbs },
        update: { timeAnnounceFolderAbs: folderAbs },
      });
      if (!folderAbs) {
        return { folderAbs: "", hourFiles: 0, hourExactFiles: 0, minuteFiles: 0, totalAudio: 0 };
      }
      return summarizeTimeAnnounceFolder(folderAbs);
    },
  );

  app.post<{ Body: unknown; Reply: ApiTimeAnnouncePlayResult | ApiError }>(
    "/time-announce/play",
    async (request, reply) => {
      if (!requireRoles(request, reply, ROLES_SCHEDULE_WRITE)) return;
      const parsed = playBody.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: "JSON inválido: { afterCurrent?: boolean, folderAbs?: string }" });
      }
      const result = await playTimeAnnounceNow(opts.env, {
        afterCurrent: parsed.data.afterCurrent !== false,
        folderAbs: parsed.data.folderAbs,
      });
      if (!result.ok) {
        return reply.status(400).send(result);
      }
      return result;
    },
  );
};
