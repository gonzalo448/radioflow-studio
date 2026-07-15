import { createReadStream, createWriteStream, existsSync, readdirSync } from "node:fs";
import { copyFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import type { FastifyPluginAsync } from "fastify";
import sanitize from "sanitize-filename";
import { z } from "zod";
import type {
  ApiError,
  ApiLibraryAsset,
  ApiLibraryAudioToolsStatus,
  ApiLibraryAutoUpdateConfig,
  ApiLibraryAutoUpdatePatchBody,
  ApiLibraryBulkDeleteResult,
  ApiLibraryCheckTracksResult,
  ApiLibraryCreateAssetBody,
  ApiLibraryCreateFolderBody,
  ApiLibraryCreateFolderResponse,
  ApiLibraryDeleteFolderResult,
  ApiLibraryBrowseResponse,
  ApiLibraryFoldersResponse,
  ApiLibraryImportM3uResult,
  ApiLibraryImportLocalFilesBody,
  ApiLibraryImportLocalFilesResult,
  ApiLibraryListQuery,
  ApiLibraryProcessJobDetail,
  ApiLibraryProcessJobEnqueueResult,
  ApiLibraryProcessTracksLoudnessResult,
  ApiLibraryRegisterStreamUrlBody,
  ApiLibraryStats,
  ApiLibrarySyncMetadataBulkResult,
  ApiLibrarySyncDurationBulkResult,
  ApiLibraryUploadResponse,
  ApiLibraryVerifyResult,
} from "@radioflow/shared";
import { parseM3uPlaylist } from "@radioflow/shared";
import type { Env } from "../config.js";
import { prisma } from "../db.js";
import { optionalAuth, requireRoles, ROLES_LIBRARY_WRITE } from "../lib/auth.js";
import { ensureMediaDirs, isPathInsideRoot, mediaRootAbs, relativeToMediaRoot, resolveAssetFilePath } from "../lib/media-path.js";
import { writePlayLog } from "../lib/play-log.js";
import { tryExtractCoverFromAudioFile } from "../lib/extract-cover.js";
import type { LibraryProcessJob } from "@prisma/client";
import { getFfmpegReachability } from "../lib/ffmpeg-health.js";
import { getClientIp } from "../lib/rate-limit.js";
import { consumeLibraryProcessEnqueueBudget } from "../lib/library-process-enqueue-rate-limit.js";
import { countAssetsForMetadataSync } from "../lib/library-metadata-sync-batch.js";
import { countAssetsForPgVectorBackfill } from "../lib/pgvector-backfill-batch.js";
import { enqueueLibraryProcessJobBody } from "../lib/library-process-job-payloads.js";
import { runLoudnessBatchForAssets } from "../lib/library-loudness-batch.js";
import { getFfprobeReachability } from "../lib/ffprobe-health.js";
import { enrichMediaAssetFromAudioFile, splitArtistTitleFromBasename } from "../lib/id3-enrich-asset.js";
import { writeMediaAssetId3ToFile } from "../lib/id3-write-asset.js";
import { isAppError } from "../lib/app-error.js";
import { isLibraryAudioFilename } from "../lib/library-audio-extensions.js";
import { createOrReuseStreamUrlAsset } from "../lib/create-stream-url-asset.js";
import { isRemoteStreamPath, normalizeRemoteStreamUrl } from "../lib/remote-stream-path.js";
import {
  absPathForMediaPrefix,
  ensureMediaSubdir,
  folderDisplayName,
  listUploadLibraryFolders,
  pathPrefixForFolderName,
  resolveUploadDirPrefix,
} from "../lib/library-folder-path.js";
import { checkLibraryTrack, readAudioDurationSeconds } from "../lib/library-check-tracks.js";
import { mediaAssetWhereFromLibraryFilters } from "../lib/library-list-filters.js";
import {
  loadLibraryAutoUpdateConfig,
  runLibraryAutoUpdateScan,
  saveLibraryAutoUpdateConfig,
} from "../services/library-auto-update.js";
import {
  assertRegisterIngestAllowed,
  assertStoredPathInVault,
} from "../lib/library-vault.js";
import { removeMediaAssetFiles, removeMediaAssetFilesBatch } from "../lib/library-delete-files.js";
import { scheduleAssetEnrich } from "../lib/library-enrich-queue.js";
import { makeSineWav } from "../lib/wav.js";

const createAsset = z.object({
  title: z.string().min(1),
  artist: z.string().optional(),
  path: z.string().min(1),
  durationSec: z.number().int().positive().optional(),
  mimeType: z.string().optional(),
  genre: z.string().min(1).max(80).optional(),
});

const patchAsset = z
  .object({
    title: z.string().min(1).optional(),
    artist: z.string().optional().nullable(),
    album: z.string().optional().nullable(),
    genre: z.string().optional().nullable(),
    semanticNote: z.string().optional().nullable(),
    playbackGainDb: z.number().min(-48).max(24).optional(),
    releaseYear: z.number().int().min(1900).max(2100).optional().nullable(),
    id3Comment: z.string().max(2000).optional().nullable(),
    customField1: z.string().max(500).optional().nullable(),
    customField2: z.string().max(500).optional().nullable(),
    customField3: z.string().max(500).optional().nullable(),
    customField4: z.string().max(500).optional().nullable(),
    customField5: z.string().max(500).optional().nullable(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Body vacío" });

const streamUrlBody = z.object({
  url: z.string().min(8).max(4096),
  title: z.string().min(1).max(500).optional(),
  artist: z.string().max(500).optional(),
  durationSec: z.number().int().positive().optional(),
});

const m3uImportBody = z.object({
  content: z.string().min(1).max(2_000_000),
});

const libraryListQuerySchema = z.object({
  q: z.string().optional(),
  genre: z.string().optional(),
  artist: z.string().optional(),
  album: z.string().optional(),
  pathPrefix: z.string().optional(),
  sort: z.enum(["title", "artist", "createdAt", "duration"]).optional(),
  order: z.enum(["asc", "desc"]).optional(),
  /** Por página; el cliente puede paginar con skip hasta agotar el catálogo. */
  take: z.coerce.number().int().min(1).max(10_000).optional(),
  skip: z.coerce.number().int().min(0).max(10_000_000).optional(),
});

const bulkDeleteBody = z.object({
  ids: z.array(z.string()).min(1).max(80),
});

const libraryVerifyBody = z.object({
  dryRun: z.boolean().optional(),
});

const checkTracksBody = z.object({
  assetIds: z.array(z.string()).max(800).optional(),
  maxInspect: z.coerce.number().int().min(1).max(3000).optional(),
  compareTitles: z.boolean().optional(),
  compareArtists: z.boolean().optional(),
  compareAlbums: z.boolean().optional(),
});

const syncDurationBulkBody = z.object({
  assetIds: z.array(z.string()).min(1).max(80),
});

const syncMetadataBulkBody = z.object({
  assetIds: z.array(z.string()).min(1).max(200),
});

const processTracksLoudnessBody = z.object({
  assetIds: z.array(z.string()).min(1).max(15),
  dryRun: z.boolean().default(true),
  targetLufs: z.number().min(-30).max(-5).default(-16),
});

function firstQueryString(v: unknown): string | undefined {
  if (Array.isArray(v)) return typeof v[0] === "string" ? v[0] : undefined;
  return typeof v === "string" ? v : undefined;
}

function serializeLibraryProcessJob(j: LibraryProcessJob): ApiLibraryProcessJobDetail {
  return {
    id: j.id,
    kind: j.kind,
    status: j.status,
    payload: j.payload as ApiLibraryProcessJobDetail["payload"],
    result: (j.result ?? null) as ApiLibraryProcessJobDetail["result"],
    error: j.error,
    progressCurrent: j.progressCurrent,
    progressTotal: j.progressTotal,
    createdAt: j.createdAt.toISOString(),
    startedAt: j.startedAt?.toISOString() ?? null,
    finishedAt: j.finishedAt?.toISOString() ?? null,
  };
}

function parseLibraryListQuery(request: { query: unknown }): z.infer<typeof libraryListQuerySchema> {
  const q = request.query as Record<string, unknown>;
  const raw = {
    q: firstQueryString(q.q),
    genre: firstQueryString(q.genre),
    artist: firstQueryString(q.artist),
    album: firstQueryString(q.album),
    pathPrefix: firstQueryString(q.pathPrefix),
    sort: firstQueryString(q.sort),
    order: firstQueryString(q.order),
    take: firstQueryString(q.take),
    skip: firstQueryString(q.skip),
  };
  const p = libraryListQuerySchema.safeParse(raw);
  return p.success ? p.data : {};
}

function guessMimeFromAudioFilename(filePath: string): string | undefined {
  const ext = path.extname(filePath).toLowerCase();
  const m: Record<string, string> = {
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".flac": "audio/flac",
    ".ogg": "audio/ogg",
    ".opus": "audio/opus",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".wma": "audio/x-ms-wma",
    ".aif": "audio/aiff",
    ".aiff": "audio/aiff",
  };
  return m[ext];
}

function resolveStreamMime(asset: { mimeType: string | null; path: string }, filePath: string): string {
  const stored = (asset.mimeType ?? "").trim();
  if (stored && stored !== "application/octet-stream" && stored.startsWith("audio/")) return stored;
  return guessMimeFromAudioFilename(filePath) ?? (stored || "audio/mpeg");
}

function titleFromResolvedFile(absPath: string, fallback?: string): string {
  const fromFile = path.basename(absPath, path.extname(absPath)).replace(/_/g, " ").trim();
  const t = (fallback ?? "").trim();
  if (t) return t;
  return fromFile || "Sin título";
}

/** Resuelve una línea de .m3u a ruta relativa normalizada bajo MEDIA_ROOT, o null si no aplica. */
function resolveM3uPathToStoredRel(line: string, env: Env): string | null {
  const norm = line.trim().replace(/\\/g, "/");
  if (!norm || norm.startsWith("#")) return null;
  if (/^https?:\/\//i.test(norm)) return null;
  const root = mediaRootAbs(env);
  const abs = path.isAbsolute(norm) ? path.normalize(norm) : path.resolve(root, norm);
  if (!isPathInsideRoot(abs, root)) return null;
  if (!existsSync(abs)) return null;
  return relativeToMediaRoot(abs, env).split(path.sep).join("/");
}

async function buildLibraryBrowse(env: Env): Promise<ApiLibraryBrowseResponse> {
  const [pathFolders, genreGroups, artistGroups, albumGroups] = await Promise.all([
    listUploadLibraryFolders(env),
    prisma.mediaAsset.groupBy({
      by: ["genre"],
      where: { genre: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { genre: "desc" } },
      take: 200,
    }),
    prisma.mediaAsset.groupBy({
      by: ["artist"],
      _count: { _all: true },
      orderBy: { _count: { artist: "desc" } },
      take: 300,
    }),
    prisma.mediaAsset.groupBy({
      by: ["album"],
      where: { album: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { album: "desc" } },
      take: 300,
    }),
  ]);

  const genres = genreGroups
    .map((g) => ({ name: (g.genre ?? "").trim(), count: g._count._all }))
    .filter((g) => g.name.length > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const artistMap = new Map<string, { name: string; count: number }>();
  for (const g of artistGroups) {
    const raw = (g.artist ?? "").trim();
    const key = raw.length ? raw : "__none__";
    const name = raw.length ? raw : "(Sin artista)";
    const prev = artistMap.get(key);
    artistMap.set(key, { name, count: (prev?.count ?? 0) + g._count._all });
  }
  const artists = [...artistMap.values()].sort((a, b) => {
    if (a.name === "(Sin artista)") return 1;
    if (b.name === "(Sin artista)") return -1;
    return b.count - a.count || a.name.localeCompare(b.name);
  });

  const albums = albumGroups
    .map((g) => ({ name: (g.album ?? "").trim(), count: g._count._all }))
    .filter((g) => g.name.length > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  return { pathFolders, genres, artists, albums };
}

export const libraryRoutes: FastifyPluginAsync<{ env: Env }> = async (app, opts) => {
  const env = opts.env;

  app.addHook("preHandler", async (request) => optionalAuth(request, env));

  app.get<{ Querystring: ApiLibraryListQuery; Reply: ApiLibraryAsset[] }>("/library/assets", async (request) => {
    const p = parseLibraryListQuery(request);
    const q = (p.q ?? "").trim();
    const genre = (p.genre ?? "").trim();
    const artist = (p.artist ?? "").trim();
    const album = (p.album ?? "").trim();
    const pathPrefix = (p.pathPrefix ?? "").trim().replace(/\\/g, "/");
    const dir: "asc" | "desc" = p.order === "desc" ? "desc" : "asc";
    const sort = p.sort ?? "title";
    const take = p.take ?? 150;
    const skip = p.skip ?? 0;

    const orderBy =
      sort === "artist"
        ? { artist: dir }
        : sort === "createdAt"
          ? { createdAt: dir }
          : sort === "duration"
            ? { durationSec: dir }
            : { title: dir };

    return prisma.mediaAsset.findMany({
      where: mediaAssetWhereFromLibraryFilters({ q, genre, artist, album, pathPrefix }),
      orderBy,
      take,
      skip,
    });
  });

  app.get<{ Querystring: ApiLibraryListQuery; Reply: { total: number } }>("/library/assets/count", async (request) => {
    const p = parseLibraryListQuery(request);
    const q = (p.q ?? "").trim();
    const genre = (p.genre ?? "").trim();
    const artist = (p.artist ?? "").trim();
    const album = (p.album ?? "").trim();
    const pathPrefix = (p.pathPrefix ?? "").trim().replace(/\\/g, "/");
    const total = await prisma.mediaAsset.count({
      where: mediaAssetWhereFromLibraryFilters({ q, genre, artist, album, pathPrefix }),
    });
    return { total };
  });

  app.get<{ Reply: { genres: string[] } }>("/library/genres", async () => {
    const rows = await prisma.mediaAsset.groupBy({
      by: ["genre"],
      where: { genre: { not: null } },
      _count: { _all: true },
    });
    const set = new Set<string>();
    for (const r of rows) {
      const g = (r.genre ?? "").trim();
      if (g) set.add(g);
    }
    return { genres: [...set].sort((a, b) => a.localeCompare(b)) };
  });

  app.get<{ Reply: ApiLibraryStats }>("/library/stats", async () => {
    const [totalTracks, sumAgg, genreGroups] = await Promise.all([
      prisma.mediaAsset.count(),
      prisma.mediaAsset.aggregate({ _sum: { durationSec: true } }),
      prisma.mediaAsset.groupBy({
        by: ["genre"],
        where: { genre: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { genre: "desc" } },
        take: 15,
      }),
    ]);
    const topGenres = genreGroups
      .map((g) => ({ genre: (g.genre ?? "").trim(), count: g._count._all }))
      .filter((g) => g.genre.length > 0);
    return {
      totalTracks,
      totalDurationSec: sumAgg._sum.durationSec ?? null,
      topGenres,
    };
  });

  app.get<{ Reply: ApiLibraryFoldersResponse }>("/library/folders", async () => {
    return { folders: await listUploadLibraryFolders(env) };
  });

  app.get("/library/browse", async () => buildLibraryBrowse(env));

  app.get<{ Reply: ApiLibraryAutoUpdateConfig | ApiError }>("/library/auto-update", async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_LIBRARY_WRITE)) return;
    return loadLibraryAutoUpdateConfig(env);
  });

  app.put<{ Body: ApiLibraryAutoUpdatePatchBody; Reply: ApiLibraryAutoUpdateConfig | ApiError }>(
    "/library/auto-update",
    async (request, reply) => {
      if (!requireRoles(request, reply, ROLES_LIBRARY_WRITE)) return;
      const body = z
        .object({
          enabled: z.boolean().optional(),
          intervalMinutes: z.number().int().min(5).max(24 * 60).optional(),
          folderPrefixes: z.array(z.string()).optional(),
        })
        .parse(request.body ?? {});
      return saveLibraryAutoUpdateConfig(env, body);
    },
  );

  app.post<{ Reply: ApiLibraryAutoUpdateConfig | ApiError }>("/library/auto-update/run", async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_LIBRARY_WRITE)) return;
    const { config } = await runLibraryAutoUpdateScan(env);
    return config;
  });

  const createFolderBody = z.object({
    name: z.string().min(1).max(48),
  });

  app.post<{ Body: ApiLibraryCreateFolderBody; Reply: ApiLibraryCreateFolderResponse | ApiError }>(
    "/library/folders",
    async (request, reply) => {
      if (!requireRoles(request, reply, ROLES_LIBRARY_WRITE)) return;
      const body = createFolderBody.safeParse(request.body);
      if (!body.success) return reply.status(400).send({ error: "Nombre de carpeta inválido (1–48 caracteres)." });
      const pathPrefix = pathPrefixForFolderName(body.data.name);
      if (!pathPrefix) return reply.status(400).send({ error: "Nombre de carpeta no permitido." });
      await ensureMediaDirs(env);
      await ensureMediaSubdir(env, pathPrefix);
      return {
        pathPrefix,
        displayName: folderDisplayName(pathPrefix),
      };
    },
  );

  app.delete<{ Querystring: { pathPrefix?: string }; Reply: ApiLibraryDeleteFolderResult | ApiError }>(
    "/library/folders",
    async (request, reply) => {
      if (!requireRoles(request, reply, ROLES_LIBRARY_WRITE)) return;
      const raw = (request.query.pathPrefix ?? "").trim().replace(/\\/g, "/");
      if (!raw || (!raw.startsWith("uploads/") && raw !== "uploads")) {
        return reply.status(400).send({ error: "Indique una carpeta bajo uploads/." });
      }
      const norm = raw.replace(/\/+$/, "");

      let assets: { id: string; path: string; coverPath: string | null }[];
      if (norm === "uploads") {
        const rows = await prisma.mediaAsset.findMany({
          where: { path: { startsWith: "uploads/" } },
          select: { id: true, path: true, coverPath: true },
        });
        assets = rows.filter((a) => !a.path.replace(/\\/g, "/").slice("uploads/".length).includes("/"));
      } else {
        assets = await prisma.mediaAsset.findMany({
          where: { path: { startsWith: `${norm}/` } },
          select: { id: true, path: true, coverPath: true },
        });
      }

      const removedFiles = await removeMediaAssetFilesBatch(env, assets);

      const deleted = await prisma.mediaAsset.deleteMany({
        where: { id: { in: assets.map((a) => a.id) } },
      });

      if (norm === "uploads") {
        const uploadsRoot = absPathForMediaPrefix(env, "uploads");
        try {
          if (existsSync(uploadsRoot)) {
            for (const ent of readdirSync(uploadsRoot, { withFileTypes: true })) {
              if (ent.isFile()) {
                try {
                  await rm(path.join(uploadsRoot, ent.name), { force: true });
                } catch {
                  /* */
                }
              }
            }
          }
        } catch {
          /* */
        }
      } else {
        const absDir = absPathForMediaPrefix(env, norm);
        try {
          if (existsSync(absDir)) {
            await rm(absDir, { recursive: true, force: true });
          }
        } catch {
          /* carpeta con archivos huérfanos */
        }
      }

      return { deletedAssets: deleted.count, removedFiles };
    },
  );

  app.get<{ Querystring: { refresh?: string }; Reply: ApiLibraryAudioToolsStatus | ApiError }>(
    "/library/audio-tools",
    async (request, reply) => {
      const refreshRaw = firstQueryString((request.query as Record<string, unknown>).refresh);
      const wantsRefresh =
        refreshRaw === "1" ||
        refreshRaw === "true" ||
        refreshRaw === "yes" ||
        (refreshRaw != null && refreshRaw.toLowerCase() === "on");
      if (wantsRefresh) {
        if (!request.userId) {
          return reply
            .status(401)
            .send({ error: "Autenticación requerida para forzar recomprobación de ffprobe/ffmpeg" });
        }
        if (request.userRole !== "admin") {
          return reply
            .status(403)
            .send({ error: "Solo administradores pueden forzar recomprobación de ffprobe/ffmpeg" });
        }
      }
      const [reach, ffmpegReach] = await Promise.all([
        getFfprobeReachability(env, { bypassCache: wantsRefresh }),
        getFfmpegReachability(env, { bypassCache: wantsRefresh }),
      ]);
      return {
        ffprobeEnabled: env.AUDIO_FFPROBE_ENABLED,
        ffprobePath: env.FFPROBE_PATH,
        ffprobeReachable: reach.reachable,
        ffprobeDetail: reach.detail,
        ffmpegEnabled: env.AUDIO_FFMPEG_ENABLED,
        ffmpegPath: env.FFMPEG_PATH,
        ffmpegReachable: ffmpegReach.reachable,
        ffmpegDetail: ffmpegReach.detail,
      };
    },
  );

  app.post<{ Body: unknown; Reply: ApiLibraryVerifyResult | ApiError | void }>(
    "/library/verify",
    async (request, reply) => {
      if (!requireRoles(request, reply, ROLES_LIBRARY_WRITE)) return;
      const parsed = libraryVerifyBody.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: "JSON inválido: { dryRun?: boolean }" });
      }
      const dryRun = parsed.data.dryRun === true;
      const orphans: { id: string; path: string; title: string }[] = [];
      let inspected = 0;
      let cursor: { id: string } | undefined;
      for (;;) {
        const batch = await prisma.mediaAsset.findMany({
          take: 400,
          orderBy: { id: "asc" },
          ...(cursor ? { cursor, skip: 1 } : {}),
          select: { id: true, path: true, title: true },
        });
        if (batch.length === 0) break;
        inspected += batch.length;
        for (const a of batch) {
          const abs = resolveAssetFilePath(a.path, env);
          const ok = Boolean(abs && existsSync(abs));
          if (!ok) orphans.push({ id: a.id, path: a.path, title: a.title });
        }
        cursor = { id: batch[batch.length - 1]!.id };
        if (batch.length < 400) break;
      }
      let removed = 0;
      const ids = orphans.map((o) => o.id);
      if (!dryRun && ids.length > 0) {
        const r = await prisma.mediaAsset.deleteMany({ where: { id: { in: ids } } });
        removed = r.count;
      }
      void writePlayLog({
        action: "LIBRARY_UPLOAD",
        userId: request.userId ?? null,
        assetId: null,
        details: {
          kind: "library_verify",
          dryRun,
          inspected,
          orphanCount: orphans.length,
          removed,
        },
      });
      return {
        dryRun,
        inspected,
        orphanCount: orphans.length,
        removed,
        samples: orphans.slice(0, 80),
      };
    },
  );

  app.post<{ Body: unknown; Reply: ApiLibraryCheckTracksResult | ApiError | void }>(
    "/library/check-tracks",
    async (request, reply) => {
      if (!requireRoles(request, reply, ROLES_LIBRARY_WRITE)) return;
      const parsed = checkTracksBody.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .status(400)
          .send({
            error:
              "JSON inválido: { assetIds?: string[], maxInspect?: number, compareTitles?: boolean, compareArtists?: boolean, compareAlbums?: boolean }",
          });
      }
      const { assetIds, compareTitles, compareArtists, compareAlbums } = parsed.data;
      const maxInspect = parsed.data.maxInspect ?? 600;
      const rows =
        assetIds != null && assetIds.length > 0
          ? await prisma.mediaAsset.findMany({
              where: { id: { in: assetIds } },
              select: { id: true, path: true, title: true, artist: true, album: true, durationSec: true },
            })
          : await prisma.mediaAsset.findMany({
              orderBy: { id: "asc" },
              take: maxInspect,
              select: { id: true, path: true, title: true, artist: true, album: true, durationSec: true },
            });

      const issuesOut: ApiLibraryCheckTracksResult["issues"] = [];
      const chunkSize = 6;
      for (let i = 0; i < rows.length; i += chunkSize) {
        const slice = rows.slice(i, i + chunkSize);
        const part = await Promise.all(
          slice.map((r) =>
            checkLibraryTrack(r, env, {
              compareTitles: compareTitles !== false,
              compareArtists: compareArtists === true,
              compareAlbums: compareAlbums === true,
            }),
          ),
        );
        for (const p of part) {
          if (p) {
            issuesOut.push({
              assetId: p.assetId,
              path: p.path,
              title: p.title,
              issues: [...p.issues],
              fileMeta: p.fileMeta,
            });
          }
        }
      }

      const MAX_RETURN = 120;
      const truncated = issuesOut.length > MAX_RETURN;
      void writePlayLog({
        action: "LIBRARY_UPLOAD",
        userId: request.userId ?? null,
        assetId: null,
        details: {
          kind: "library_check_tracks",
          inspected: rows.length,
          withIssues: issuesOut.length,
          truncated,
          compareArtists: compareArtists === true,
          compareAlbums: compareAlbums === true,
        },
      });
      return {
        inspected: rows.length,
        withIssues: issuesOut.length,
        issues: issuesOut.slice(0, MAX_RETURN),
        truncated,
      };
    },
  );

  app.get<{ Reply: unknown | ApiError }>("/library/assets/:id/cover", async (request, reply) => {
    const { id } = request.params as { id: string };
    const asset = await prisma.mediaAsset.findUnique({ where: { id } });
    if (!asset?.coverPath) return reply.status(404).send({ error: "Sin carátula" });
    const filePath = resolveAssetFilePath(asset.coverPath, env);
    if (!filePath) return reply.status(404).send({ error: "Archivo de carátula no accesible" });
    const lower = asset.coverPath.toLowerCase();
    const mime = lower.endsWith(".png")
      ? "image/png"
      : lower.endsWith(".webp")
        ? "image/webp"
        : "image/jpeg";
    reply.header("Cache-Control", "public, max-age=86400");
    reply.header("Cross-Origin-Resource-Policy", "cross-origin");
    reply.type(mime);
    return reply.send(createReadStream(filePath));
  });

  app.get<{ Reply: unknown | ApiError }>("/library/assets/:id/stream", async (request, reply) => {
    const { id } = request.params as { id: string };
    const asset = await prisma.mediaAsset.findUnique({ where: { id } });
    if (!asset) return reply.status(404).send({ error: "No encontrado" });
    if (isRemoteStreamPath(asset.path)) {
      reply.header("Cache-Control", "no-store");
      return reply.redirect(normalizeRemoteStreamUrl(asset.path));
    }
    const filePath = resolveAssetFilePath(asset.path, env);
    if (!filePath) return reply.status(404).send({ error: "Archivo no accesible en el servidor" });
    const st = await stat(filePath);
    const size = st.size;
    reply.header("Accept-Ranges", "bytes");
    reply.type(resolveStreamMime(asset, filePath));

    const rawRange = request.headers.range;
    if (rawRange && typeof rawRange === "string") {
      const m = /^bytes=(\d*)-(\d*)$/i.exec(rawRange.trim());
      if (m) {
        let start = m[1] ? Number(m[1]) : 0;
        let end = m[2] ? Number(m[2]) : size - 1;
        if (Number.isNaN(start) || Number.isNaN(end)) {
          return reply
            .status(416)
            .header("Content-Range", `bytes */${size}`)
            .send({ error: "Rango inválido" });
        }
        if (m[1] === "" && m[2] !== "") {
          const suffix = Number(m[2]);
          if (!Number.isNaN(suffix) && suffix > 0) {
            start = Math.max(0, size - suffix);
            end = size - 1;
          }
        }
        if (start >= size) {
          return reply.status(416).header("Content-Range", `bytes */${size}`).send({ error: "Rango fuera de archivo" });
        }
        if (end >= size) end = size - 1;
        if (start > end) {
          return reply.status(416).header("Content-Range", `bytes */${size}`).send({ error: "Rango inválido" });
        }
        const chunk = end - start + 1;
        reply.code(206);
        reply.header("Content-Range", `bytes ${start}-${end}/${size}`);
        reply.header("Content-Length", chunk);
        return reply.send(createReadStream(filePath, { start, end }));
      }
    }

    reply.header("Content-Length", size);
    return reply.send(createReadStream(filePath));
  });

  app.post<{ Body: ApiLibraryCreateAssetBody; Reply: ApiLibraryAsset | ApiError | void }>(
    "/library/assets",
    async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_LIBRARY_WRITE)) return;
    assertRegisterIngestAllowed(env);
    const body = createAsset.parse(request.body);
    assertStoredPathInVault(body.path, env);
    let asset = await prisma.mediaAsset.create({ data: body });
    const audioPath = resolveAssetFilePath(asset.path, env);
    if (audioPath) {
      asset = await enrichMediaAssetFromAudioFile(prisma, env, asset);
    }
    void writePlayLog({
      action: "LIBRARY_UPLOAD",
      userId: request.userId ?? null,
      assetId: asset.id,
      details: { kind: "register_path", path: body.path },
    });
    return reply.status(201).send(asset);
    },
  );

  app.post<{ Body: ApiLibraryRegisterStreamUrlBody; Reply: ApiLibraryAsset | ApiError | void }>(
    "/library/assets/stream-url",
    async (request, reply) => {
      if (!requireRoles(request, reply, ROLES_LIBRARY_WRITE)) return;
      const body = streamUrlBody.parse(request.body);
      try {
        const asset = await createOrReuseStreamUrlAsset(body);
        void writePlayLog({
          action: "LIBRARY_UPLOAD",
          userId: request.userId ?? null,
          assetId: asset.id,
          details: { kind: "stream_url", url: asset.path },
        });
        return reply.status(201).send(asset);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "URL inválida";
        return reply.status(422).send({ error: msg });
      }
    },
  );

  app.patch<{ Reply: ApiLibraryAsset | ApiError | void }>("/library/assets/:id", async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_LIBRARY_WRITE)) return;
    const { id } = request.params as { id: string };
    const body = patchAsset.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: "Body inválido" });
    try {
      const updated = await prisma.mediaAsset.update({
        where: { id },
        data: {
          ...(body.data.title ? { title: body.data.title } : {}),
          ...(body.data.artist !== undefined ? { artist: body.data.artist ?? null } : {}),
          ...(body.data.album !== undefined ? { album: body.data.album ?? null } : {}),
          ...(body.data.genre !== undefined ? { genre: body.data.genre ?? null } : {}),
          ...(body.data.semanticNote !== undefined ? { semanticNote: body.data.semanticNote ?? null } : {}),
          ...(body.data.playbackGainDb !== undefined ? { playbackGainDb: body.data.playbackGainDb } : {}),
          ...(body.data.releaseYear !== undefined ? { releaseYear: body.data.releaseYear ?? null } : {}),
          ...(body.data.id3Comment !== undefined ? { id3Comment: body.data.id3Comment ?? null } : {}),
          ...(body.data.customField1 !== undefined ? { customField1: body.data.customField1 ?? null } : {}),
          ...(body.data.customField2 !== undefined ? { customField2: body.data.customField2 ?? null } : {}),
          ...(body.data.customField3 !== undefined ? { customField3: body.data.customField3 ?? null } : {}),
          ...(body.data.customField4 !== undefined ? { customField4: body.data.customField4 ?? null } : {}),
          ...(body.data.customField5 !== undefined ? { customField5: body.data.customField5 ?? null } : {}),
        },
      });
      return updated;
    } catch {
      return reply.status(404).send({ error: "No encontrado" });
    }
  });

  app.post<{ Reply: ApiLibraryAsset | ApiError | void }>(
    "/library/assets/:id/sync-from-file",
    async (request, reply) => {
      if (!requireRoles(request, reply, ROLES_LIBRARY_WRITE)) return;
      const { id } = request.params as { id: string };
      const asset = await prisma.mediaAsset.findUnique({ where: { id } });
      if (!asset) return reply.status(404).send({ error: "No encontrado" });
      const abs = resolveAssetFilePath(asset.path, env);
      if (!abs || !existsSync(abs)) {
        return reply.status(400).send({ error: "Archivo no accesible en el servidor" });
      }
      const updated = await enrichMediaAssetFromAudioFile(prisma, env, asset);
      void writePlayLog({
        action: "LIBRARY_UPLOAD",
        userId: request.userId ?? null,
        assetId: id,
        details: { kind: "sync_metadata_from_file" },
      });
      return updated;
    },
  );

  /** C4: escribe tags ID3 (DB → archivo MP3) y relee para verificar round-trip. */
  app.post<{ Reply: ApiLibraryAsset | ApiError | void }>(
    "/library/assets/:id/write-to-file",
    async (request, reply) => {
      if (!requireRoles(request, reply, ROLES_LIBRARY_WRITE)) return;
      const { id } = request.params as { id: string };
      const asset = await prisma.mediaAsset.findUnique({ where: { id } });
      if (!asset) return reply.status(404).send({ error: "No encontrado" });
      try {
        const updated = await writeMediaAssetId3ToFile(prisma, env, asset);
        void writePlayLog({
          action: "LIBRARY_UPLOAD",
          userId: request.userId ?? null,
          assetId: id,
          details: { kind: "write_id3_to_file" },
        });
        return updated;
      } catch (err) {
        if (isAppError(err)) {
          return reply.status(err.statusCode).send({ error: err.message });
        }
        const msg = err instanceof Error ? err.message : "Error al escribir ID3";
        return reply.status(422).send({ error: msg });
      }
    },
  );

  app.post<{ Reply: ApiLibraryAsset | ApiError | void }>("/library/assets/:id/sync-duration", async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_LIBRARY_WRITE)) return;
    const { id } = request.params as { id: string };
    const asset = await prisma.mediaAsset.findUnique({ where: { id } });
    if (!asset) return reply.status(404).send({ error: "No encontrado" });
    const abs = resolveAssetFilePath(asset.path, env);
    if (!abs || !existsSync(abs)) {
      return reply.status(400).send({ error: "Archivo no accesible en el servidor" });
    }
    const seconds = await readAudioDurationSeconds(abs, env);
    if (seconds == null) {
      return reply.status(422).send({ error: "No se pudo leer la duración del archivo" });
    }
    const updated = await prisma.mediaAsset.update({
      where: { id },
      data: { durationSec: seconds },
    });
    void writePlayLog({
      action: "LIBRARY_UPLOAD",
      userId: request.userId ?? null,
      assetId: id,
      details: { kind: "sync_duration_from_file", durationSec: seconds },
    });
    return updated;
  });

  app.post<{ Body: unknown; Reply: ApiLibrarySyncDurationBulkResult | ApiError | void }>(
    "/library/sync-duration-bulk",
    async (request, reply) => {
      if (!requireRoles(request, reply, ROLES_LIBRARY_WRITE)) return;
      const body = syncDurationBulkBody.safeParse(request.body);
      if (!body.success) {
        return reply.status(400).send({ error: "JSON inválido: { assetIds: string[] } (1–80)" });
      }
      const failures: { id: string; error: string }[] = [];
      let updated = 0;
      for (const id of body.data.assetIds) {
        const asset = await prisma.mediaAsset.findUnique({ where: { id } });
        if (!asset) {
          failures.push({ id, error: "No encontrado" });
          continue;
        }
        const abs = resolveAssetFilePath(asset.path, env);
        if (!abs || !existsSync(abs)) {
          failures.push({ id, error: "Archivo no accesible" });
          continue;
        }
        const seconds = await readAudioDurationSeconds(abs, env);
        if (seconds == null) {
          failures.push({ id, error: "Sin duración en metadatos" });
          continue;
        }
        await prisma.mediaAsset.update({ where: { id }, data: { durationSec: seconds } });
        updated += 1;
      }
      void writePlayLog({
        action: "LIBRARY_UPLOAD",
        userId: request.userId ?? null,
        assetId: null,
        details: {
          kind: "sync_duration_bulk",
          updated,
          failureCount: failures.length,
          ids: body.data.assetIds,
        },
      });
      return { updated, failures };
    },
  );

  app.post<{ Body: unknown; Reply: ApiLibrarySyncMetadataBulkResult | ApiError | void }>(
    "/library/sync-metadata-bulk",
    async (request, reply) => {
      if (!requireRoles(request, reply, ROLES_LIBRARY_WRITE)) return;
      const body = syncMetadataBulkBody.safeParse(request.body);
      if (!body.success) {
        return reply.status(400).send({ error: "JSON inválido: { assetIds: string[] } (1–200)" });
      }
      const failures: { id: string; error: string }[] = [];
      let updated = 0;
      for (const id of body.data.assetIds) {
        const asset = await prisma.mediaAsset.findUnique({ where: { id } });
        if (!asset) {
          failures.push({ id, error: "No encontrado" });
          continue;
        }
        const abs = resolveAssetFilePath(asset.path, env);
        if (!abs || !existsSync(abs)) {
          failures.push({ id, error: "Archivo no accesible" });
          continue;
        }
        try {
          await enrichMediaAssetFromAudioFile(prisma, env, asset);
          updated += 1;
        } catch {
          failures.push({ id, error: "Error al leer metadatos del archivo" });
        }
      }
      void writePlayLog({
        action: "LIBRARY_UPLOAD",
        userId: request.userId ?? null,
        assetId: null,
        details: {
          kind: "sync_metadata_bulk",
          updated,
          failureCount: failures.length,
          ids: body.data.assetIds,
        },
      });
      return { updated, failures };
    },
  );

  app.post<{ Body: unknown; Reply: ApiLibraryProcessTracksLoudnessResult | ApiError | void }>(
    "/library/process-tracks/loudness",
    async (request, reply) => {
      if (!requireRoles(request, reply, ROLES_LIBRARY_WRITE)) return;
      if (!env.AUDIO_FFMPEG_ENABLED) {
        return reply
          .status(503)
          .send({ error: "AUDIO_FFMPEG_ENABLED=0 — active ffmpeg en .env para medición loudness (Process tracks)." });
      }
      const ffmpegOk = await getFfmpegReachability(env);
      if (ffmpegOk.reachable !== true) {
        return reply.status(503).send({
          error:
            ffmpegOk.detail ??
            "ffmpeg no respondió. Revise FFMPEG_PATH o GET /api/library/audio-tools (estado en caché ~1 min).",
        });
      }
      const parsed = processTracksLoudnessBody.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({
          error: "JSON inválido: { assetIds: string[] (1–15), dryRun?: boolean, targetLufs?: number (-30…-5) }",
        });
      }
      const { assetIds, dryRun, targetLufs } = parsed.data;
      const result = await runLoudnessBatchForAssets(prisma, env, {
        assetIds,
        targetLufs,
        dryRun,
      });
      void writePlayLog({
        action: "LIBRARY_UPLOAD",
        userId: request.userId ?? null,
        assetId: null,
        details: {
          kind: "library_process_tracks_loudness",
          dryRun,
          targetLufs,
          rowCount: result.rows.length,
          updated: result.updated,
        },
      });
      return result;
    },
  );

  app.get<{ Querystring: { take?: string; status?: string }; Reply: ApiLibraryProcessJobDetail[] | ApiError }>(
    "/library/process-jobs",
    async (request, reply) => {
      if (!requireRoles(request, reply, ROLES_LIBRARY_WRITE)) return;
      const q = request.query as Record<string, unknown>;
      const takeRaw = firstQueryString(q.take);
      const take = Math.min(50, Math.max(1, Number.isFinite(Number(takeRaw)) ? Number(takeRaw) : 20));
      const status = firstQueryString(q.status);
      const allowed = new Set(["pending", "running", "completed", "failed", "cancelled"]);
      const where =
        status && allowed.has(status)
          ? { status: status as "pending" | "running" | "completed" | "failed" | "cancelled" }
          : {};
      const rows = await prisma.libraryProcessJob.findMany({
        where,
        take,
        orderBy: { createdAt: "desc" },
      });
      return rows.map(serializeLibraryProcessJob);
    },
  );

  app.get<{ Params: { id: string }; Reply: ApiLibraryProcessJobDetail | ApiError }>(
    "/library/process-jobs/:id",
    async (request, reply) => {
      if (!requireRoles(request, reply, ROLES_LIBRARY_WRITE)) return;
      const { id } = request.params as { id: string };
      const j = await prisma.libraryProcessJob.findUnique({ where: { id } });
      if (!j) return reply.status(404).send({ error: "Job no encontrado" });
      return serializeLibraryProcessJob(j);
    },
  );

  app.post<{ Body: unknown; Reply: ApiLibraryProcessJobEnqueueResult | ApiError | void }>(
    "/library/process-jobs",
    async (request, reply) => {
      if (!requireRoles(request, reply, ROLES_LIBRARY_WRITE)) return;
      const parsed = enqueueLibraryProcessJobBody.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({
          error:
            'JSON inválido: kind en loudness_batch | bpm_detect | trim_silence | transcode_mp3 | time_stretch | sync_metadata | semantic_enrich | pgvector_backfill; assetIds según kind; policy opcional.',
        });
      }
      const body = parsed.data;
      const rl = await consumeLibraryProcessEnqueueBudget(
        env,
        request.userId ?? "anon",
        getClientIp(request),
        body.kind,
      );
      if (!rl.ok) {
        void reply.header("Retry-After", String(rl.retryAfterSec));
        return reply.status(429).send({
          error: `Demasiados jobs encolados en poco tiempo. Reintente en ${rl.retryAfterSec}s.`,
        });
      }
      const { kind, ...payloadRest } = body;
      let progressTotal = 0;
      let payload: Record<string, unknown>;
      if (body.kind === "sync_metadata") {
        if (body.mode === "asset_ids") {
          progressTotal = body.assetIds!.length;
          payload = { mode: "asset_ids", assetIds: body.assetIds };
        } else {
          const filters = body.filters ?? {};
          progressTotal = await countAssetsForMetadataSync(prisma, filters);
          payload = { mode: "library", filters };
        }
      } else if (body.kind === "pgvector_backfill") {
        if (body.assetIds?.length) {
          progressTotal = body.assetIds.length;
          payload = { assetIds: body.assetIds, limit: body.limit };
        } else {
          progressTotal = await countAssetsForPgVectorBackfill(prisma);
          payload = { limit: body.limit ?? 500 };
        }
      } else if ("assetIds" in body && body.assetIds) {
        progressTotal = body.assetIds.length;
        payload = payloadRest as Record<string, unknown>;
      } else {
        return reply.status(400).send({ error: "assetIds requerido para este kind" });
      }
      const job = await prisma.libraryProcessJob.create({
        data: {
          kind,
          status: "pending",
          payload: payload as object,
          progressTotal,
          progressCurrent: 0,
          createdByUserId: request.userId ?? undefined,
        },
      });
      void writePlayLog({
        action: "LIBRARY_UPLOAD",
        userId: request.userId ?? null,
        assetId: null,
        details: { kind: "library_process_job_enqueue", jobId: job.id, jobKind: job.kind },
      });
      return { jobId: job.id };
    },
  );

  app.post<{ Body: unknown; Reply: ApiLibraryBulkDeleteResult | ApiError | void }>(
    "/library/assets/bulk-delete",
    async (request, reply) => {
      if (!requireRoles(request, reply, ROLES_LIBRARY_WRITE)) return;
      const body = bulkDeleteBody.safeParse(request.body);
      if (!body.success) return reply.status(400).send({ error: "JSON inválido: { ids: string[] } (máx. 80)" });
      const assets = await prisma.mediaAsset.findMany({
        where: { id: { in: body.data.ids } },
        select: { id: true, path: true, coverPath: true },
      });
      const removedFiles = await removeMediaAssetFilesBatch(env, assets);
      const r = await prisma.mediaAsset.deleteMany({ where: { id: { in: body.data.ids } } });
      return { deleted: r.count, removedFiles };
    },
  );

  app.delete<{ Reply: void | ApiError }>("/library/assets/:id", async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_LIBRARY_WRITE)) return;
    const { id } = request.params as { id: string };
    const asset = await prisma.mediaAsset.findUnique({
      where: { id },
      select: { id: true, path: true, coverPath: true },
    });
    if (!asset) return reply.status(404).send({ error: "No encontrado" });
    await removeMediaAssetFiles(env, asset);
    try {
      await prisma.mediaAsset.delete({ where: { id } });
      return reply.status(204).send();
    } catch {
      return reply.status(404).send({ error: "No encontrado" });
    }
  });

  app.post<{ Reply: ApiLibraryUploadResponse | ApiError | void }>(
    "/library/upload",
    async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_LIBRARY_WRITE)) return;
    await ensureMediaDirs(env);
    const file = await request.file();
    if (!file) return reply.status(400).send({ error: "Falta archivo (multipart field: file)" });

    const folderField = file.fields?.folder;
    const folderRaw =
      folderField && typeof folderField === "object" && "value" in folderField
        ? String(folderField.value)
        : undefined;
    const uploadDir = resolveUploadDirPrefix(folderRaw);
    await ensureMediaSubdir(env, uploadDir);

    const safeName = sanitize(file.filename || "audio.bin");
    const ext = path.extname(safeName) || "";
    const base = path.basename(safeName, ext);
    const storedName = `${base}-${randomUUID()}${ext}`;
    const absDest = path.join(mediaRootAbs(env), uploadDir.replace(/\//g, path.sep), storedName);
    await pipeline(file.file, createWriteStream(absDest));

    const mime =
      file.mimetype && file.mimetype !== "application/octet-stream"
        ? file.mimetype
        : guessMimeFromAudioFilename(safeName) ?? "audio/mpeg";
    const relPath = relativeToMediaRoot(absDest, env);
    const split = splitArtistTitleFromBasename(base);
    let asset = await prisma.mediaAsset.create({
      data: {
        title: split.title,
        artist: split.artist,
        path: relPath,
        mimeType: mime,
      },
    });
    scheduleAssetEnrich(env, asset.id);
    void writePlayLog({
      action: "LIBRARY_UPLOAD",
      userId: request.userId ?? null,
      assetId: asset.id,
      details: { kind: "multipart", filename: safeName, folder: uploadDir },
    });
    return reply.status(201).send(asset);
    },
  );

  const importLocalFilesBody = z.object({
    paths: z.array(z.string().min(1)).min(1).max(500),
    folder: z.string().optional(),
  });

  app.post<{ Body: ApiLibraryImportLocalFilesBody; Reply: ApiLibraryImportLocalFilesResult | ApiError }>(
    "/library/import-local-files",
    async (request, reply) => {
      if (!requireRoles(request, reply, ROLES_LIBRARY_WRITE)) return;
      if (!env.EMBEDDED_STANDALONE) {
        return reply.status(403).send({
          error: "Importación por ruta local solo está disponible en la aplicación instalada.",
        });
      }
      const body = importLocalFilesBody.parse(request.body ?? {});
      const uploadDir = resolveUploadDirPrefix(body.folder);
      await ensureMediaSubdir(env, uploadDir);

      const ids: string[] = [];
      const errors: string[] = [];
      let skipped = 0;

      for (const rawPath of body.paths) {
        try {
          const normalized = path.normalize(rawPath.trim());
          if (!path.isAbsolute(normalized)) {
            skipped += 1;
            continue;
          }
          const st = await stat(normalized);
          if (!st.isFile()) {
            skipped += 1;
            continue;
          }
          const baseName = path.basename(normalized);
          if (!isLibraryAudioFilename(baseName)) {
            skipped += 1;
            continue;
          }

          const safeName = sanitize(baseName);
          const ext = path.extname(safeName) || "";
          const base = path.basename(safeName, ext);
          const storedName = `${base}-${randomUUID()}${ext}`;
          const absDest = path.join(mediaRootAbs(env), uploadDir.replace(/\//g, path.sep), storedName);
          await copyFile(normalized, absDest);

          const relPath = relativeToMediaRoot(absDest, env);
          const split = splitArtistTitleFromBasename(base);
          const mime = guessMimeFromAudioFilename(safeName) ?? "audio/mpeg";
          const asset = await prisma.mediaAsset.create({
            data: {
              title: split.title,
              artist: split.artist,
              path: relPath,
              mimeType: mime,
            },
          });
          scheduleAssetEnrich(env, asset.id);
          ids.push(asset.id);
          void writePlayLog({
            action: "LIBRARY_UPLOAD",
            userId: request.userId ?? null,
            assetId: asset.id,
            details: { kind: "local_path_copy", src: normalized, folder: uploadDir },
          });
        } catch (err) {
          errors.push(err instanceof Error ? err.message : String(err));
        }
      }

      return {
        imported: ids.length,
        ids,
        skipped,
        errors: errors.slice(0, 20),
      };
    },
  );

  app.post<{ Body: unknown; Reply: ApiLibraryImportM3uResult | ApiError | void }>(
    "/library/import/m3u",
    async (request, reply) => {
      if (!requireRoles(request, reply, ROLES_LIBRARY_WRITE)) return;
      assertRegisterIngestAllowed(env);
      const parsed = m3uImportBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "JSON inválido: se espera { content: string }" });
      }
      const entries = parseM3uPlaylist(parsed.data.content);
      const result: ApiLibraryImportM3uResult = {
        created: 0,
        skippedExisting: 0,
        skippedMissing: 0,
        skippedRemote: 0,
      };
      for (const en of entries) {
        const rawPath = en.path;
        if (/^https?:\/\//i.test(rawPath.trim())) {
          try {
            const path = normalizeRemoteStreamUrl(rawPath);
            const existing = await prisma.mediaAsset.findFirst({ where: { path } });
            if (existing) {
              result.skippedExisting += 1;
              continue;
            }
            const asset = await createOrReuseStreamUrlAsset({
              url: path,
              title: en.title,
              durationSec: en.durationSec ?? undefined,
            });
            void writePlayLog({
              action: "LIBRARY_UPLOAD",
              userId: request.userId ?? null,
              assetId: asset.id,
              details: { kind: "m3u_stream_url", url: path },
            });
            result.created += 1;
          } catch {
            result.skippedRemote += 1;
          }
          continue;
        }
        const storedRel = resolveM3uPathToStoredRel(rawPath, env);
        if (!storedRel) {
          result.skippedMissing += 1;
          continue;
        }
        const existing = await prisma.mediaAsset.findFirst({ where: { path: storedRel } });
        if (existing) {
          result.skippedExisting += 1;
          continue;
        }
        const absPath = path.join(mediaRootAbs(env), ...storedRel.split("/"));
        const title = titleFromResolvedFile(absPath, en.title);
        const mime = guessMimeFromAudioFilename(absPath);
        let asset = await prisma.mediaAsset.create({
          data: {
            title,
            path: storedRel,
            mimeType: mime,
            ...(en.durationSec != null && en.durationSec > 0 ? { durationSec: en.durationSec } : {}),
          },
        });
        asset = await enrichMediaAssetFromAudioFile(prisma, env, asset);
        void writePlayLog({
          action: "LIBRARY_UPLOAD",
          userId: request.userId ?? null,
          assetId: asset.id,
          details: { kind: "m3u_register", path: storedRel },
        });
        result.created += 1;
      }
      return result;
    },
  );

  app.post<{ Reply: ApiLibraryAsset | ApiError | void }>(
    "/library/assets/:id/extract-cover",
    async (request, reply) => {
      if (!requireRoles(request, reply, ROLES_LIBRARY_WRITE)) return;
      const { id } = request.params as { id: string };
      const asset = await prisma.mediaAsset.findUnique({ where: { id } });
      if (!asset) return reply.status(404).send({ error: "No encontrado" });
      const audioPath = resolveAssetFilePath(asset.path, env);
      if (!audioPath) return reply.status(400).send({ error: "Audio no accesible en el servidor" });
      const coverPath = await tryExtractCoverFromAudioFile(audioPath, asset.id, env);
      if (!coverPath) return reply.status(422).send({ error: "No se encontró imagen embebida en el archivo" });
      const updated = await prisma.mediaAsset.update({ where: { id }, data: { coverPath } });
      return updated;
    },
  );

  app.post<{ Reply: { created: number } | ApiError | void }>("/library/demo/seed", async (request, reply) => {
    if (!requireRoles(request, reply, ["admin"])) return;
    await ensureMediaDirs(env);

    const existing = await prisma.mediaAsset.count();
    if (existing > 0) {
      return reply.status(409).send({ error: "La librería no está vacía (seed demo cancelado)." });
    }

    const demos = [
      { title: "Rock demo", genre: "Rock", freqHz: 110 },
      { title: "Pop demo", genre: "Pop", freqHz: 220 },
      { title: "Electrónica demo", genre: "Electrónica", freqHz: 330 },
      { title: "Jazz demo", genre: "Jazz", freqHz: 440 },
    ] as const;

    let created = 0;
    for (const d of demos) {
      const wav = makeSineWav({ sampleRateHz: 44100, durationSec: 2.5, freqHz: d.freqHz, volume: 0.6 });
      const storedName = `demo-${d.genre.toLowerCase().replace(/\s+/g, "-")}-${randomUUID()}.wav`;
      const absDest = path.join(mediaRootAbs(env), "uploads", storedName);
      await pipeline([wav], createWriteStream(absDest));
      const relPath = relativeToMediaRoot(absDest, env);
      await prisma.mediaAsset.create({
        data: { title: d.title, artist: "RadioFlow", path: relPath, mimeType: "audio/wav", genre: d.genre, durationSec: 2 },
      });
      created += 1;
    }
    return { created };
  });

  app.post<{ Reply: ApiLibraryProcessJobEnqueueResult | ApiError | void }>(
    "/library/process-jobs/vault-transcode-mp3",
    async (request, reply) => {
      if (!requireRoles(request, reply, ROLES_LIBRARY_WRITE)) return;
      const assets = await prisma.mediaAsset.findMany({ select: { id: true }, take: 5000 });
      if (assets.length === 0) {
        return reply.status(422).send({ error: "No hay pistas en el catálogo" });
      }
      const rl = await consumeLibraryProcessEnqueueBudget(
        env,
        request.userId ?? "anon",
        getClientIp(request),
        "transcode_mp3",
      );
      if (!rl.ok) {
        void reply.header("Retry-After", String(rl.retryAfterSec));
        return reply.status(429).send({ error: `Demasiados jobs. Reintente en ${rl.retryAfterSec}s.` });
      }
      const chunkSize = 200;
      let firstJobId: string | null = null;
      for (let i = 0; i < assets.length; i += chunkSize) {
        const assetIds = assets.slice(i, i + chunkSize).map((a) => a.id);
        const job = await prisma.libraryProcessJob.create({
          data: {
            kind: "transcode_mp3",
            status: "pending",
            progressTotal: assetIds.length,
            progressCurrent: 0,
            createdByUserId: request.userId ?? undefined,
            payload: { assetIds, apply: false, policy: { bitrateKbps: 192, preserveMetadata: true } },
          },
        });
        if (!firstJobId) firstJobId = job.id;
      }
      return { jobId: firstJobId! };
    },
  );
};
