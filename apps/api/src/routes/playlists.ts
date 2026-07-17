import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type {
  ApiError,
  ApiPlaylistInsertVoicetrackBody,
  ApiPlaylistInsertStreamUrlBody,
  ApiPlaylistInsertTrackListBody,
  ApiPlaylistAddCommandBody,
  ApiPlaylistAddItemBody,
  ApiPlaylist,
  ApiPlaylistBatchItemsBody,
  ApiPlaylistCreateBody,
  ApiPlaylistDetail,
  ApiPlaylistFromLibraryViewBody,
  ApiPlaylistFillFromGenreBody,
  ApiPlaylistFillFromArtistBody,
  ApiPlaylistFillFromFolderBody,
  ApiPlaylistMergeFromPlaylistBody,
  ApiPlaylistTransferItemsBody,
  ApiPlaylistGenerateBody,
  ApiPlaylistGenerateResult,
  ApiPlaylistItem,
  ApiPlaylistListItem,
  ApiPlaylistReorderBody,
  ApiPlaylistInterleaveJinglesBody,
  ApiPlaylistRenameBody,
  ApiPlaylistRestoreItemsBody,
  ApiPlaylistDuplicateBody,
  ApiPlaylistImportFileBody,
  ApiPlaylistImportFileResult,
  ApiPlaylistInsertTtsBody,
  ApiPlaylistAutoIntroBody,
  ApiPlaylistAutoIntroResult,
  ApiPlaylistRenderBody,
  ApiPlaylistRenderEnqueueResult,
} from "@radioflow/shared";
import type { Env } from "../config.js";
import { prisma } from "../db.js";
import { optionalAuth, requireRoles, ROLES_SCHEDULE_WRITE } from "../lib/auth.js";
import { mediaAssetWhereFromLibraryFilters } from "../lib/library-list-filters.js";
import { equalsCi } from "../lib/prisma-string-filter.js";
import { assertAssetsPlayableInVault } from "../lib/library-vault.js";
import { listLibraryAssetIdsForFill, replacePlaylistItemsWithAssets } from "../lib/playlist-library-fill.js";
import { transferPlaylistItems } from "../lib/playlist-transfer-items.js";
import { generatePlaylistPro, parsedBodyToGeneratorInput } from "../services/playlist-generator.js";
import { playlistGenerateBodySchema } from "../lib/playlist-generator-body.js";
import { insertPlaylistCommandItem } from "../lib/insert-playlist-command.js";
import { interleavePlaylistJingles } from "../lib/playlist-interleave-jingles.js";
import { insertPlaylistVoicetrackItem } from "../lib/insert-playlist-voicetrack.js";
import { logAutomation } from "../lib/automation-log.js";
import { insertPlaylistTtsVoicetrackItem } from "../lib/insert-playlist-tts-voicetrack.js";
import { runPlaylistAutoIntro } from "../lib/insert-playlist-auto-intro.js";
import { insertPlaylistTrackListItem } from "../lib/insert-playlist-track-list.js";
import { advanceTrackListSeries } from "../lib/expand-track-list.js";
import { insertPlaylistStreamUrlItem } from "../lib/insert-playlist-stream-url.js";
import { duplicatePlaylist } from "../lib/duplicate-playlist.js";
import { importPlaylistFile } from "../lib/import-playlist-file.js";
import { restorePlaylistSnapshot } from "../lib/restore-playlist-snapshot.js";
import { buildPlaylistM3uExport, buildPlaylistPlsExport } from "../lib/playlist-export.js";
import { mapPlaylistDetail, mapPlaylistItemRow } from "../lib/queue-entry-map.js";
import { buildPlaylistDetailResponse } from "../lib/playlist-detail-response.js";

const createPlaylist = z.object({
  name: z.string().min(1),
});

const addItem = z.object({
  assetId: z.string().min(1),
});

const batchItems = z.object({
  assetIds: z.array(z.string().min(1)).min(1).max(250),
});

const rename = z
  .object({
    name: z.string().min(1).optional(),
    tabColor: z
      .union([z.string().regex(/^#[0-9A-Fa-f]{6}$/), z.null()])
      .optional(),
  })
  .refine((b) => b.name !== undefined || b.tabColor !== undefined, {
    message: "Indique name y/o tabColor",
  });

const reorderBody = z.object({
  orderedItemIds: z.array(z.string()),
});

const interleaveJinglesBody = z.object({
  everyN: z.number().int().min(1).max(50).default(3),
  mode: z.enum(["auto", "selected"]).optional(),
  jingleItemIds: z.array(z.string().min(1)).max(500).optional(),
});

const fromGenreBody = z.object({
  genre: z.string().min(1),
  name: z.string().min(1).optional(),
});

const fillFromGenreBody = z.object({
  genre: z.string().min(1),
  renameToGenre: z.boolean().optional(),
});

const fillFromArtistBody = z.object({
  artist: z.string().min(1),
  renameToArtist: z.boolean().optional(),
});

const fillFromFolderBody = z.object({
  pathPrefix: z.string().min(1),
  renameToFolder: z.boolean().optional(),
});

const mergeFromPlaylistBody = z.object({
  sourcePlaylistId: z.string().min(1),
  replace: z.boolean().optional(),
});

const transferItemsBody = z.object({
  sourcePlaylistId: z.string().min(1),
  itemIds: z.array(z.string().min(1)).min(1).max(200),
  mode: z.enum(["move", "copy"]),
});

const commandItemBody = z.object({
  kind: z.enum(["pause", "marker", "note", "hour_marker", "dtmf", "cmd", "container"]),
  label: z.string().max(500).optional(),
  pauseSec: z.number().int().min(0).max(3600).optional(),
  cmdSpec: z
    .object({
      action: z.enum(["play", "stop", "next", "clear", "load_playlist"]),
      playlistId: z.string().min(1).optional(),
      replace: z.boolean().optional(),
    })
    .optional(),
  containerPlaylistId: z.string().min(1).optional(),
  insertAfterItemId: z.string().min(1).nullable().optional(),
});

const duplicateBody = z.object({
  name: z.string().min(1).max(200),
});

const importFileBody = z.object({
  format: z.enum(["m3u", "pls"]),
  content: z.string().min(1).max(4_000_000),
  name: z.string().min(1).max(200).optional(),
  targetPlaylistId: z.string().min(1).nullable().optional(),
});

const voicetrackItemBody = z.object({
  assetId: z.string().min(1),
  label: z.string().max(500).optional(),
  title: z.string().min(1).max(200).optional(),
  insertAfterItemId: z.string().min(1).nullable().optional(),
});

const ttsItemBody = z.object({
  text: z.string().min(1).max(4000),
  label: z.string().max(500).optional(),
  title: z.string().min(1).max(200).optional(),
  insertAfterItemId: z.string().min(1).nullable().optional(),
  lang: z.string().max(16).optional(),
  rate: z.number().min(0.5).max(2).optional(),
  engine: z.enum(["auto", "sapi", "espeak", "edge-tts", "piper"]).optional(),
  voice: z.string().max(80).optional(),
});

const renderPlaylistBody = z.object({
  format: z.enum(["wav", "mp3"]),
});

const autoIntroBody = z.object({
  dryRun: z.boolean().optional(),
  folderPath: z.string().max(200).optional(),
});

const trackListItemBody = z.object({
  source: z.enum(["folder", "playlist", "genre", "artist", "category"]),
  value: z.string().min(1).max(500),
  maxTracks: z.number().int().min(1).max(100).optional(),
  order: z.enum(["title", "random", "sequential", "series"]).optional(),
  label: z.string().max(500).optional(),
  ignoreRepeatProtection: z.boolean().optional(),
  recurseSubfolders: z.boolean().optional(),
  insertAfterItemId: z.string().min(1).nullable().optional(),
});

const streamUrlItemBody = z.object({
  url: z.string().min(8).max(4096),
  title: z.string().min(1).max(500).optional(),
  artist: z.string().max(500).optional(),
  durationSec: z.number().int().positive().optional(),
  insertAfterItemId: z.string().min(1).nullable().optional(),
});

const restoreItemsBody = z.object({
  items: z.array(
    z.object({
      kind: z.enum([
        "track",
        "voicetrack",
        "pause",
        "marker",
        "note",
        "track_list",
        "hour_marker",
        "ad_break",
        "jingle",
      ]),
      assetId: z.string().nullable().optional(),
      label: z.string().nullable().optional(),
      pauseSec: z.number().int().nullable().optional(),
      trackListSpec: z.unknown().nullable().optional(),
    }),
  ),
});

async function fillPlaylistRoute(
  playlistId: string,
  filters: { genre?: string; artist?: string; pathPrefix?: string },
  renameTo: string | undefined,
  env: Env,
) {
  const { ids, count } = await listLibraryAssetIdsForFill(filters, env);
  if (count === 0) return null;
  return replacePlaylistItemsWithAssets(playlistId, ids, renameTo ?? null);
}

const fromLibraryViewBody = z.object({
  name: z.string().min(1).optional(),
  q: z.string().optional(),
  genre: z.string().optional(),
  artist: z.string().optional(),
  album: z.string().optional(),
  pathPrefix: z.string().optional(),
  assetIds: z.array(z.string().min(1)).min(1).max(50_000).optional(),
});

function suggestPlaylistNameFromFilters(filters: {
  pathPrefix?: string;
  genre?: string;
  artist?: string;
  album?: string;
  count: number;
}): string {
  const p = (filters.pathPrefix ?? "").trim();
  const g = (filters.genre ?? "").trim();
  const a = (filters.artist ?? "").trim();
  const al = (filters.album ?? "").trim();
  if (p) return p.split("/").pop() ?? p;
  if (g) return `Género: ${g}`;
  if (a === "__none__") return "Sin artista";
  if (a) return `Artista: ${a}`;
  if (al) return `Álbum: ${al}`;
  return `Biblioteca (${filters.count})`;
}

export const playlistRoutes: FastifyPluginAsync<{ env: Env }> = async (app, opts) => {
  app.addHook("preHandler", async (request) => optionalAuth(request, opts.env));

  app.get<{ Reply: ApiPlaylistListItem[] }>("/playlists", async () => {
    return prisma.playlist.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, tabColor: true, _count: { select: { items: true } } },
    });
  });

  app.get<{ Reply: ApiPlaylistDetail | ApiError }>("/playlists/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const pl = await prisma.playlist.findUnique({
      where: { id },
      include: {
        items: { orderBy: { position: "asc" }, include: { asset: true } },
      },
    });
    if (!pl) return reply.status(404).send({ error: "Playlist no encontrada" });
    return await buildPlaylistDetailResponse(pl);
  });

  app.get("/playlists/:id/export", async (request, reply) => {
    const { id } = request.params as { id: string };
    const format = String((request.query as { format?: string })?.format ?? "json").toLowerCase();
    const pl = await prisma.playlist.findUnique({
      where: { id },
      include: { items: { orderBy: { position: "asc" }, include: { asset: true } } },
    });
    if (!pl) return reply.status(404).send({ error: "Playlist no encontrada" });

    const safeName = pl.name.replace(/[^\w\-]+/g, "_") || "playlist";

    if (format === "m3u") {
      const body = buildPlaylistM3uExport(pl.items);
      return reply
        .header("Content-Disposition", `attachment; filename="${safeName}.m3u"`)
        .type("audio/x-mpegurl")
        .send(body);
    }
    if (format === "pls") {
      const body = buildPlaylistPlsExport(pl.items);
      return reply
        .header("Content-Disposition", `attachment; filename="${safeName}.pls"`)
        .type("audio/scpls")
        .send(body);
    }
    if (format === "json") {
      return await buildPlaylistDetailResponse(pl);
    }
    return reply.status(400).send({ error: "format debe ser json, m3u o pls" });
  });

  app.post<{ Body: ApiPlaylistRenderBody; Reply: ApiPlaylistRenderEnqueueResult | ApiError | void }>(
    "/playlists/:id/render",
    async (request, reply) => {
      if (!requireRoles(request, reply, ROLES_SCHEDULE_WRITE)) return;
      const { id } = request.params as { id: string };
      const body = renderPlaylistBody.parse(request.body ?? {});
      const pl = await prisma.playlist.findUnique({ where: { id }, select: { id: true } });
      if (!pl) return reply.status(404).send({ error: "Playlist no encontrada" });
      if (!opts.env.AUDIO_FFMPEG_ENABLED) {
        return reply.status(503).send({ error: "AUDIO_FFMPEG_ENABLED=0 — active ffmpeg para renderizar" });
      }
      const job = await prisma.libraryProcessJob.create({
        data: {
          kind: "playlist_render",
          payload: { playlistId: id, format: body.format },
          status: "pending",
          createdByUserId: request.userId ?? undefined,
        },
      });
      return reply.status(202).send({ jobId: job.id });
    },
  );

  app.post<{ Body: ApiPlaylistCreateBody; Reply: ApiPlaylist | ApiError | void }>(
    "/playlists",
    async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_SCHEDULE_WRITE)) return;
    const body = createPlaylist.parse(request.body);
    const pl = await prisma.playlist.create({ data: { name: body.name } });
    return reply.status(201).send(pl as unknown as ApiPlaylist);
    },
  );

  app.post<{ Reply: ApiPlaylistDetail | ApiError | void }>("/playlists/from-genre", async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_SCHEDULE_WRITE)) return;
    const body = fromGenreBody.parse(request.body);
    const genre = body.genre.trim();
    const assets = await prisma.mediaAsset.findMany({
      where: { genre: equalsCi(genre) },
      orderBy: { title: "asc" },
    });
    if (assets.length === 0) return reply.status(404).send({ error: "No hay medios con ese género" });
    const name = body.name?.trim() || `Género: ${genre}`;

    const pl = await prisma.$transaction(async (tx) => {
      const playlist = await tx.playlist.create({ data: { name } });
      await tx.playlistItem.createMany({
        data: assets.map((a, idx) => ({ playlistId: playlist.id, assetId: a.id, position: idx })),
      });
      const full = await tx.playlist.findUnique({
        where: { id: playlist.id },
        include: { items: { orderBy: { position: "asc" }, include: { asset: true } } },
      });
      return full;
    });
    if (!pl) return reply.status(500).send({ error: "No se pudo crear la playlist" });
    return reply.status(201).send(await buildPlaylistDetailResponse(pl));
  });

  app.post<{ Body: ApiPlaylistFillFromGenreBody; Reply: ApiPlaylistDetail | ApiError | void }>(
    "/playlists/:id/fill-from-genre",
    async (request, reply) => {
      if (!requireRoles(request, reply, ROLES_SCHEDULE_WRITE)) return;
      const { id } = request.params as { id: string };
      const body = fillFromGenreBody.parse(request.body);
      const genre = body.genre.trim();
      const pl = await prisma.playlist.findUnique({ where: { id } });
      if (!pl) return reply.status(404).send({ error: "Playlist no encontrada" });
      const full = await fillPlaylistRoute(
        id,
        { genre },
        body.renameToGenre !== false ? genre : undefined,
        opts.env,
      );
      if (!full) {
        return reply.status(404).send({ error: `No hay pistas con el género «${genre}» en la biblioteca` });
      }
      return await buildPlaylistDetailResponse(full);
    },
  );

  app.post<{ Body: ApiPlaylistFillFromArtistBody; Reply: ApiPlaylistDetail | ApiError | void }>(
    "/playlists/:id/fill-from-artist",
    async (request, reply) => {
      if (!requireRoles(request, reply, ROLES_SCHEDULE_WRITE)) return;
      const { id } = request.params as { id: string };
      const body = fillFromArtistBody.parse(request.body);
      const artist = body.artist.trim();
      const pl = await prisma.playlist.findUnique({ where: { id } });
      if (!pl) return reply.status(404).send({ error: "Playlist no encontrada" });
      const label = artist === "__none__" ? "Sin artista" : artist;
      const full = await fillPlaylistRoute(
        id,
        { artist },
        body.renameToArtist !== false ? label : undefined,
        opts.env,
      );
      if (!full) {
        return reply.status(404).send({ error: `No hay pistas del artista «${label}» en la biblioteca` });
      }
      return await buildPlaylistDetailResponse(full);
    },
  );

  app.post<{ Body: ApiPlaylistFillFromFolderBody; Reply: ApiPlaylistDetail | ApiError | void }>(
    "/playlists/:id/fill-from-folder",
    async (request, reply) => {
      if (!requireRoles(request, reply, ROLES_SCHEDULE_WRITE)) return;
      const { id } = request.params as { id: string };
      const body = fillFromFolderBody.parse(request.body);
      const pathPrefix = body.pathPrefix.trim().replace(/\\/g, "/");
      const pl = await prisma.playlist.findUnique({ where: { id } });
      if (!pl) return reply.status(404).send({ error: "Playlist no encontrada" });
      const folderLabel = pathPrefix.split("/").filter(Boolean).pop() ?? pathPrefix;
      const full = await fillPlaylistRoute(
        id,
        { pathPrefix },
        body.renameToFolder !== false ? folderLabel : undefined,
        opts.env,
      );
      if (!full) {
        return reply.status(404).send({ error: `No hay pistas en la carpeta «${pathPrefix}»` });
      }
      return await buildPlaylistDetailResponse(full);
    },
  );

  app.post<{ Body: ApiPlaylistMergeFromPlaylistBody; Reply: ApiPlaylistDetail | ApiError | void }>(
    "/playlists/:id/merge-from-playlist",
    async (request, reply) => {
      if (!requireRoles(request, reply, ROLES_SCHEDULE_WRITE)) return;
      const { id } = request.params as { id: string };
      const body = mergeFromPlaylistBody.parse(request.body);
      const target = await prisma.playlist.findUnique({ where: { id } });
      if (!target) return reply.status(404).send({ error: "Playlist no encontrada" });
      const source = await prisma.playlist.findUnique({
        where: { id: body.sourcePlaylistId },
        include: { items: { orderBy: { position: "asc" } } },
      });
      if (!source) return reply.status(404).send({ error: "Lista origen no encontrada" });
      if (source.items.length === 0) return reply.status(400).send({ error: "La lista origen está vacía" });
      const trackIds = source.items
        .filter((i) => (i.kind === "track" || i.kind === "voicetrack") && i.assetId)
        .map((i) => i.assetId!);
      if (trackIds.length > 0) await assertAssetsPlayableInVault(trackIds, opts.env);
      if (body.replace) {
        const full = await prisma.$transaction(async (tx) => {
          await tx.playlistItem.deleteMany({ where: { playlistId: id } });
          await tx.playlistItem.createMany({
            data: source.items.map((it, i) => ({
              playlistId: id,
              kind: it.kind,
              assetId: it.assetId,
              label: it.label,
              pauseSec: it.pauseSec,
              trackListSpec: it.trackListSpec ?? undefined,
              position: i,
            })),
          });
          return tx.playlist.findUnique({
            where: { id },
            include: { items: { orderBy: { position: "asc" }, include: { asset: true } } },
          });
        });
        if (!full) return reply.status(500).send({ error: "No se pudo fusionar" });
        return await buildPlaylistDetailResponse(full);
      }
      const last = await prisma.playlistItem.findFirst({
        where: { playlistId: id },
        orderBy: { position: "desc" },
      });
      let pos = (last?.position ?? -1) + 1;
      await prisma.playlistItem.createMany({
        data: source.items.map((it, i) => ({
          playlistId: id,
          kind: it.kind,
          assetId: it.assetId,
          label: it.label,
          pauseSec: it.pauseSec,
          trackListSpec: it.trackListSpec ?? undefined,
          position: pos + i,
        })),
      });
      const full = await prisma.playlist.findUnique({
        where: { id },
        include: { items: { orderBy: { position: "asc" }, include: { asset: true } } },
      });
      return full ? await buildPlaylistDetailResponse(full) : reply.status(500).send({ error: "No se pudo fusionar" });
    },
  );

  app.post<{ Body: ApiPlaylistTransferItemsBody; Reply: ApiPlaylistDetail | ApiError | void }>(
    "/playlists/:targetId/items/transfer",
    async (request, reply) => {
      if (!requireRoles(request, reply, ROLES_SCHEDULE_WRITE)) return;
      const { targetId } = request.params as { targetId: string };
      const body = transferItemsBody.parse(request.body);
      try {
        const full = await transferPlaylistItems({
          targetPlaylistId: targetId,
          sourcePlaylistId: body.sourcePlaylistId,
          itemIds: body.itemIds,
          mode: body.mode,
          env: opts.env,
        });
        if (!full) return reply.status(404).send({ error: "Lista destino no encontrada" });
        return await buildPlaylistDetailResponse(full);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "No se pudo transferir";
        return reply.status(400).send({ error: msg });
      }
    },
  );

  app.post<{ Body: ApiPlaylistFromLibraryViewBody; Reply: ApiPlaylistDetail | ApiError | void }>(
    "/playlists/from-library-view",
    async (request, reply) => {
      if (!requireRoles(request, reply, ROLES_SCHEDULE_WRITE)) return;
      const body = fromLibraryViewBody.parse(request.body);

      let assets: { id: string }[];
      if (body.assetIds?.length) {
        assets = await prisma.mediaAsset.findMany({
          where: { id: { in: body.assetIds } },
          select: { id: true },
          orderBy: { title: "asc" },
        });
      } else {
        const filters = {
          q: body.q,
          genre: body.genre,
          artist: body.artist,
          album: body.album,
          pathPrefix: body.pathPrefix,
        };
        const hasFilter = Object.values(filters).some((v) => (v ?? "").trim().length > 0);
        if (!hasFilter) {
          return reply.status(400).send({
            error: "Indique filtros de biblioteca (carpeta, género, artista, álbum) o assetIds.",
          });
        }
        assets = await prisma.mediaAsset.findMany({
          where: mediaAssetWhereFromLibraryFilters(filters),
          select: { id: true },
          orderBy: { title: "asc" },
        });
      }

      if (assets.length === 0) return reply.status(404).send({ error: "No hay pistas que coincidan con la vista" });

      const name =
        body.name?.trim() ||
        suggestPlaylistNameFromFilters({
          pathPrefix: body.pathPrefix,
          genre: body.genre,
          artist: body.artist,
          album: body.album,
          count: assets.length,
        });

      const pl = await prisma.$transaction(async (tx) => {
        const playlist = await tx.playlist.create({ data: { name } });
        await tx.playlistItem.createMany({
          data: assets.map((a, idx) => ({ playlistId: playlist.id, assetId: a.id, position: idx })),
        });
        return tx.playlist.findUnique({
          where: { id: playlist.id },
          include: { items: { orderBy: { position: "asc" }, include: { asset: true } } },
        });
      });
      if (!pl) return reply.status(500).send({ error: "No se pudo crear la playlist" });
      return reply.status(201).send(await buildPlaylistDetailResponse(pl));
    },
  );

  app.post<{ Body: ApiPlaylistGenerateBody; Reply: ApiPlaylistGenerateResult | ApiError | void }>(
    "/playlists/generate",
    async (request, reply) => {
      if (!requireRoles(request, reply, ROLES_SCHEDULE_WRITE)) return;
      const body = playlistGenerateBodySchema.parse(request.body ?? {});
      try {
        const result = await generatePlaylistPro(opts.env, parsedBodyToGeneratorInput(body));
        return reply.status(201).send(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "No se pudo generar la playlist";
        return reply.status(400).send({ error: msg });
      }
    },
  );

  app.patch<{ Body: ApiPlaylistRenameBody; Reply: ApiPlaylist | ApiError | void }>(
    "/playlists/:id",
    async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_SCHEDULE_WRITE)) return;
    const { id } = request.params as { id: string };
    const body = rename.parse(request.body);
    try {
      const data: { name?: string; tabColor?: string | null } = {};
      if (body.name !== undefined) data.name = body.name;
      if (body.tabColor !== undefined) data.tabColor = body.tabColor;
      return (await prisma.playlist.update({ where: { id }, data })) as unknown as ApiPlaylist;
    } catch {
      return reply.status(404).send({ error: "Playlist no encontrada" });
    }
    },
  );

  app.delete<{ Reply: void | ApiError }>("/playlists/:id", async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_SCHEDULE_WRITE)) return;
    const { id } = request.params as { id: string };
    try {
      await prisma.playlist.delete({ where: { id } });
      return reply.status(204).send();
    } catch {
      return reply.status(404).send({ error: "Playlist no encontrada" });
    }
  });

  app.post<{ Body: ApiPlaylistAddItemBody; Reply: ApiPlaylistItem | ApiError | void }>(
    "/playlists/:id/items",
    async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_SCHEDULE_WRITE)) return;
    const { id } = request.params as { id: string };
    const body = addItem.parse(request.body);
    const pl = await prisma.playlist.findUnique({ where: { id } });
    if (!pl) return reply.status(404).send({ error: "Playlist no encontrada" });
    const asset = await prisma.mediaAsset.findUnique({ where: { id: body.assetId } });
    if (!asset) return reply.status(404).send({ error: "Medio no encontrado" });
    const last = await prisma.playlistItem.findFirst({
      where: { playlistId: id },
      orderBy: { position: "desc" },
    });
    const position = (last?.position ?? -1) + 1;
    const item = await prisma.playlistItem.create({
      data: { playlistId: id, assetId: body.assetId, position },
      include: { asset: true },
    });
    return reply.status(201).send(mapPlaylistItemRow(item));
    },
  );

  app.post<{ Body: ApiPlaylistBatchItemsBody; Reply: ApiPlaylistDetail | ApiError | void }>(
    "/playlists/:id/items/batch",
    async (request, reply) => {
      if (!requireRoles(request, reply, ROLES_SCHEDULE_WRITE)) return;
      const { id } = request.params as { id: string };
      const body = batchItems.parse(request.body);
      const pl = await prisma.playlist.findUnique({ where: { id } });
      if (!pl) return reply.status(404).send({ error: "Playlist no encontrada" });
      const uniqueIds = [...new Set(body.assetIds)];
      const assets = await prisma.mediaAsset.findMany({
        where: { id: { in: uniqueIds } },
        select: { id: true },
      });
      if (assets.length !== uniqueIds.length) {
        return reply.status(400).send({ error: "Uno o más medios no existen" });
      }
      const last = await prisma.playlistItem.findFirst({
        where: { playlistId: id },
        orderBy: { position: "desc" },
      });
      let position = (last?.position ?? -1) + 1;
      await prisma.playlistItem.createMany({
        data: body.assetIds.map((assetId, i) => ({
          playlistId: id,
          assetId,
          position: position + i,
        })),
      });
      const full = await prisma.playlist.findUnique({
        where: { id },
        include: { items: { orderBy: { position: "asc" }, include: { asset: true } } },
      });
      if (!full) return reply.status(404).send({ error: "Playlist no encontrada" });
      return reply.status(201).send(await buildPlaylistDetailResponse(full));
    },
  );

  app.delete<{ Reply: void | ApiError }>("/playlists/:id/items/:itemId", async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_SCHEDULE_WRITE)) return;
    const { id, itemId } = request.params as { id: string; itemId: string };
    const existing = await prisma.playlistItem.findFirst({
      where: { id: itemId, playlistId: id },
    });
    if (!existing) return reply.status(404).send({ error: "Ítem no encontrado" });
    await prisma.$transaction(async (tx) => {
      await tx.playlistItem.delete({ where: { id: itemId } });
      const rest = await tx.playlistItem.findMany({
        where: { playlistId: id },
        orderBy: { position: "asc" },
      });
      for (let i = 0; i < rest.length; i++) {
        if (rest[i].position !== i) {
          await tx.playlistItem.update({ where: { id: rest[i].id }, data: { position: i } });
        }
      }
    });
    return reply.status(204).send();
  });

  app.put<{ Body: ApiPlaylistReorderBody; Reply: ApiPlaylistDetail | ApiError | void }>(
    "/playlists/:id/items/reorder",
    async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_SCHEDULE_WRITE)) return;
    const { id } = request.params as { id: string };
    const body = reorderBody.parse(request.body);
    const pl = await prisma.playlist.findUnique({ where: { id } });
    if (!pl) return reply.status(404).send({ error: "Playlist no encontrada" });
    const items = await prisma.playlistItem.findMany({ where: { playlistId: id } });
    if (items.length !== body.orderedItemIds.length) {
      return reply.status(400).send({ error: "Lista de ids incompleta" });
    }
    const set = new Set(items.map((i) => i.id));
    for (const oid of body.orderedItemIds) {
      if (!set.has(oid)) return reply.status(400).send({ error: "Id inválido en orden" });
    }
    await prisma.$transaction(
      body.orderedItemIds.map((itemId, index) =>
        prisma.playlistItem.update({
          where: { id: itemId },
          data: { position: index },
        }),
      ),
    );
    const full = await prisma.playlist.findUnique({
      where: { id },
      include: { items: { orderBy: { position: "asc" }, include: { asset: true } } },
    });
    if (!full) return reply.status(404).send({ error: "Playlist no encontrada" });
    return await buildPlaylistDetailResponse(full);
    },
  );

  app.post<{ Body: ApiPlaylistInterleaveJinglesBody; Reply: ApiPlaylistDetail | ApiError | void }>(
    "/playlists/:id/items/interleave-jingles",
    async (request, reply) => {
      if (!requireRoles(request, reply, ROLES_SCHEDULE_WRITE)) return;
      const { id } = request.params as { id: string };
      const body = interleaveJinglesBody.parse(request.body ?? {});
      try {
        const full = await interleavePlaylistJingles({
          playlistId: id,
          everyN: body.everyN,
          mode: body.mode ?? "auto",
          jingleItemIds: body.jingleItemIds,
        });
        if (!full) return reply.status(404).send({ error: "Playlist no encontrada" });
        return full;
      } catch (e) {
        return reply.status(400).send({ error: e instanceof Error ? e.message : "No se pudo intercalar" });
      }
    },
  );

  app.post<{ Body: ApiPlaylistAddCommandBody; Reply: ApiPlaylistDetail | ApiError | void }>(
    "/playlists/:id/items/command",
    async (request, reply) => {
      if (!requireRoles(request, reply, ROLES_SCHEDULE_WRITE)) return;
      const { id } = request.params as { id: string };
      const body = commandItemBody.parse(request.body);
      let full;
      try {
        full = await insertPlaylistCommandItem({
          playlistId: id,
          kind: body.kind,
          label: body.label,
          pauseSec: body.pauseSec,
          cmdSpec: body.cmdSpec,
          containerPlaylistId: body.containerPlaylistId,
          insertAfterItemId: body.insertAfterItemId ?? null,
        });
      } catch (e) {
        return reply.status(400).send({ error: e instanceof Error ? e.message : "Comando inválido" });
      }
      if (!full) return reply.status(404).send({ error: "Playlist no encontrada" });
      return reply.status(201).send(await buildPlaylistDetailResponse(full));
    },
  );

  app.post<{ Reply: ApiPlaylistDetail | ApiError | void }>(
    "/playlists/:id/reset-played-status",
    async (request, reply) => {
      if (!requireRoles(request, reply, ROLES_SCHEDULE_WRITE)) return;
      const { id } = request.params as { id: string };
      const pl = await prisma.playlist.findUnique({ where: { id } });
      if (!pl) return reply.status(404).send({ error: "Playlist no encontrada" });
      await prisma.playlist.update({ where: { id }, data: { rotationResetAt: new Date() } });
      const full = await prisma.playlist.findUnique({
        where: { id },
        include: { items: { orderBy: { position: "asc" }, include: { asset: true } } },
      });
      if (!full) return reply.status(404).send({ error: "Playlist no encontrada" });
      return await buildPlaylistDetailResponse(full);
    },
  );

  app.post<{ Body: ApiPlaylistInsertVoicetrackBody; Reply: ApiPlaylistDetail | ApiError | void }>(
    "/playlists/:id/items/voicetrack",
    async (request, reply) => {
      if (!requireRoles(request, reply, ROLES_SCHEDULE_WRITE)) return;
      const { id } = request.params as { id: string };
      const body = voicetrackItemBody.parse(request.body);
      try {
        const full = await insertPlaylistVoicetrackItem(
          {
            playlistId: id,
            assetId: body.assetId,
            label: body.label,
            title: body.title,
            insertAfterItemId: body.insertAfterItemId ?? null,
          },
          opts.env,
        );
        if (!full) return reply.status(404).send({ error: "Playlist o medio no encontrado" });
        const pl = await prisma.playlist.findUnique({
          where: { id },
          include: { items: { orderBy: { position: "asc" }, include: { asset: true } } },
        });
        if (!pl) return reply.status(404).send({ error: "Playlist no encontrada" });
        logAutomation("voicetrack_recorded", { playlistId: id, label: body.label ?? null }, body.assetId);
        return reply.status(201).send(await buildPlaylistDetailResponse(pl));
      } catch (err) {
        const msg = err instanceof Error ? err.message : "No se pudo insertar el voicetrack";
        return reply.status(400).send({ error: msg });
      }
    },
  );

  app.post<{ Body: ApiPlaylistInsertTtsBody; Reply: ApiPlaylistDetail | ApiError | void }>(
    "/playlists/:id/items/tts",
    async (request, reply) => {
      if (!requireRoles(request, reply, ROLES_SCHEDULE_WRITE)) return;
      const { id } = request.params as { id: string };
      const body = ttsItemBody.parse(request.body);
      try {
        const full = await insertPlaylistTtsVoicetrackItem(
          {
            playlistId: id,
            text: body.text,
            label: body.label,
            title: body.title,
            insertAfterItemId: body.insertAfterItemId ?? null,
            lang: body.lang,
            rate: body.rate,
            engine: body.engine,
            voice: body.voice,
          },
          opts.env,
        );
        if (!full) return reply.status(404).send({ error: "Playlist no encontrada" });
        const pl = await prisma.playlist.findUnique({
          where: { id },
          include: { items: { orderBy: { position: "asc" }, include: { asset: true } } },
        });
        if (!pl) return reply.status(404).send({ error: "Playlist no encontrada" });
        return reply.status(201).send(await buildPlaylistDetailResponse(pl));
      } catch (err) {
        const msg = err instanceof Error ? err.message : "No se pudo sintetizar la locución TTS";
        return reply.status(400).send({ error: msg });
      }
    },
  );

  app.post<{ Body: ApiPlaylistAutoIntroBody; Reply: ApiPlaylistAutoIntroResult | ApiError | void }>(
    "/playlists/:id/auto-intro",
    async (request, reply) => {
      if (!requireRoles(request, reply, ROLES_SCHEDULE_WRITE)) return;
      const { id } = request.params as { id: string };
      const body = autoIntroBody.parse(request.body ?? {});
      const result = await runPlaylistAutoIntro(
        {
          playlistId: id,
          folderPath: body.folderPath,
          dryRun: body.dryRun,
        },
        opts.env,
      );
      if (!result) return reply.status(404).send({ error: "Playlist no encontrada" });
      return result;
    },
  );

  app.post<{ Body: ApiPlaylistInsertTrackListBody; Reply: ApiPlaylistDetail | ApiError | void }>(
    "/playlists/:id/items/track-list",
    async (request, reply) => {
      if (!requireRoles(request, reply, ROLES_SCHEDULE_WRITE)) return;
      const { id } = request.params as { id: string };
      const body = trackListItemBody.parse(request.body);
      const order =
        body.order === "title" ? "sequential" : body.order === "sequential" || body.order === "series" || body.order === "random"
          ? body.order
          : "random";
      const spec = {
        source: body.source,
        value: body.value.trim(),
        maxTracks: body.maxTracks ?? 1,
        order,
        label: body.label,
        ignoreRepeatProtection: body.ignoreRepeatProtection ?? false,
        recurseSubfolders: body.recurseSubfolders ?? true,
        cursor: 0,
        stickyAssetId: null as string | null,
      };
      const full = await insertPlaylistTrackListItem({
        playlistId: id,
        spec,
        insertAfterItemId: body.insertAfterItemId ?? null,
      });
      if (!full) return reply.status(404).send({ error: "Playlist no encontrada" });
      return reply.status(201).send(full);
    },
  );

  app.post<{ Reply: ApiPlaylistDetail | ApiError | void }>(
    "/playlists/:id/items/:itemId/advance-track-list",
    async (request, reply) => {
      if (!requireRoles(request, reply, ROLES_SCHEDULE_WRITE)) return;
      const { id, itemId } = request.params as { id: string; itemId: string };
      const item = await prisma.playlistItem.findFirst({
        where: { id: itemId, playlistId: id },
      });
      if (!item || item.kind !== "track_list") {
        return reply.status(404).send({ error: "Ítem track list no encontrado" });
      }
      const next = await advanceTrackListSeries(itemId, opts.env);
      if (!next) return reply.status(400).send({ error: "No se pudo avanzar la track list" });
      const full = await prisma.playlist.findUnique({
        where: { id },
        include: { items: { orderBy: { position: "asc" }, include: { asset: true } } },
      });
      if (!full) return reply.status(404).send({ error: "Playlist no encontrada" });
      return mapPlaylistDetail(full);
    },
  );

  app.post<{ Body: ApiPlaylistInsertStreamUrlBody; Reply: ApiPlaylistDetail | ApiError | void }>(
    "/playlists/:id/items/stream-url",
    async (request, reply) => {
      if (!requireRoles(request, reply, ROLES_SCHEDULE_WRITE)) return;
      const { id } = request.params as { id: string };
      const body = streamUrlItemBody.parse(request.body);
      try {
        const full = await insertPlaylistStreamUrlItem({
          playlistId: id,
          url: body.url,
          title: body.title,
          artist: body.artist,
          durationSec: body.durationSec,
          insertAfterItemId: body.insertAfterItemId ?? null,
        });
        if (!full) return reply.status(404).send({ error: "Playlist no encontrada" });
        return reply.status(201).send(full);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "URL inválida";
        return reply.status(422).send({ error: msg });
      }
    },
  );

  app.put<{ Body: ApiPlaylistRestoreItemsBody; Reply: ApiPlaylistDetail | ApiError | void }>(
    "/playlists/:id/items/restore",
    async (request, reply) => {
      if (!requireRoles(request, reply, ROLES_SCHEDULE_WRITE)) return;
      const { id } = request.params as { id: string };
      const body = restoreItemsBody.parse(request.body);
      const full = await restorePlaylistSnapshot(id, body.items);
      if (!full) return reply.status(404).send({ error: "Playlist no encontrada" });
      return full;
    },
  );

  app.post<{ Body: ApiPlaylistDuplicateBody; Reply: ApiPlaylistDetail | ApiError | void }>(
    "/playlists/:id/duplicate",
    async (request, reply) => {
      if (!requireRoles(request, reply, ROLES_SCHEDULE_WRITE)) return;
      const { id } = request.params as { id: string };
      const body = duplicateBody.parse(request.body);
      const full = await duplicatePlaylist(id, body.name);
      if (!full) return reply.status(404).send({ error: "Playlist no encontrada" });
      return reply.status(201).send(full);
    },
  );

  app.post<{ Body: ApiPlaylistImportFileBody; Reply: ApiPlaylistImportFileResult | ApiError | void }>(
    "/playlists/import-file",
    async (request, reply) => {
      if (!requireRoles(request, reply, ROLES_SCHEDULE_WRITE)) return;
      const body = importFileBody.parse(request.body);
      const result = await importPlaylistFile(
        {
          format: body.format,
          content: body.content,
          name: body.name,
          targetPlaylistId: body.targetPlaylistId ?? null,
        },
        opts.env,
      );
      if (!result) {
        return reply.status(422).send({ error: "No se pudo importar: archivo vacío o rutas no resueltas" });
      }
      return reply.status(201).send(result);
    },
  );
};
