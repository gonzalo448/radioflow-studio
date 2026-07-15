import fs from "node:fs";
import type { FastifyPluginAsync } from "fastify";
import type { ApiError, ApiPublicListen, ApiPublicNowPlaying } from "@radioflow/shared";
import type { Env } from "../config.js";
import { resolvePublicApiOrigin } from "../lib/api-base-url.js";
import { getPublicNowPlaying } from "../services/now-playing.js";
import { getPublicListen } from "../services/public-listen.js";
import {
  CURRENT_COVER,
  nowPlayingExportPaths,
  NOWPLAYING_JSON,
  sidecarPublicUrls,
  writeNowPlayingSidecar,
} from "../services/now-playing-export.js";

export const publicRoutes: FastifyPluginAsync<{ env: Env }> = async (app, opts) => {
  app.get<{ Reply: ApiPublicListen | ApiError }>(
    "/public/listen",
    {
      schema: {
        description:
          "Reproductor web: nombre de estación, URL de escucha del destino activo y enlace al Now Playing público.",
        tags: ["public"],
      },
    },
    async (request, reply) => {
      reply.header("Cache-Control", "no-cache, no-store, must-revalidate");
      const origin = resolvePublicApiOrigin(request, opts.env);
      return getPublicListen(origin);
    },
  );

  app.get<{ Reply: ApiPublicNowPlaying | ApiError }>(
    "/public/now-playing",
    {
      schema: {
        description:
          "Now Playing público (sin autenticación): título, artista, álbum, URL de carátula y logo de estación.",
        tags: ["public"],
      },
    },
    async (request, reply) => {
      reply.header("Cache-Control", "no-cache, no-store, must-revalidate");
      const origin = resolvePublicApiOrigin(request, opts.env);
      const payload = await getPublicNowPlaying(origin);
      if (opts.env.NOW_PLAYING_EXPORT_ENABLED) {
        payload.sidecar = sidecarPublicUrls(origin);
      }
      return payload;
    },
  );

  app.get<{ Reply: ApiPublicNowPlaying | ApiError | string }>(
    "/public/nowplaying.json",
    {
      schema: {
        description: "Sidecar JSON (E1.3) compatible con widgets; se actualiza al cambiar pista.",
        tags: ["public"],
      },
    },
    async (request, reply) => {
      reply.header("Cache-Control", "no-cache, no-store, must-revalidate");
      const origin = resolvePublicApiOrigin(request, opts.env);
      const { jsonPath } = nowPlayingExportPaths(opts.env);

      if (opts.env.NOW_PLAYING_EXPORT_ENABLED && fs.existsSync(jsonPath)) {
        try {
          const raw = await fs.promises.readFile(jsonPath, "utf8");
          reply.type("application/json; charset=utf-8");
          return reply.send(raw);
        } catch {
          /* regenerar abajo */
        }
      }

      const payload = await getPublicNowPlaying(origin);
      if (opts.env.NOW_PLAYING_EXPORT_ENABLED) {
        await writeNowPlayingSidecar(opts.env, origin, payload);
      }
      return payload;
    },
  );

  app.get<{ Reply: unknown | ApiError }>(
    "/public/current-cover.jpg",
    {
      schema: {
        description: "Imagen de carátula exportada (E1.3); JPG/PNG según origen.",
        tags: ["public"],
      },
    },
    async (request, reply) => {
      reply.header("Cache-Control", "no-cache, no-store, must-revalidate");
      const { coverPath, jsonPath } = nowPlayingExportPaths(opts.env);
      if (!fs.existsSync(coverPath)) {
        if (fs.existsSync(jsonPath)) {
          return reply.status(404).send({ error: "Sin carátula exportada para la pista actual" });
        }
        const origin = resolvePublicApiOrigin(request, opts.env);
        const payload = await getPublicNowPlaying(origin);
        if (opts.env.NOW_PLAYING_EXPORT_ENABLED) {
          await writeNowPlayingSidecar(opts.env, origin, payload);
        }
        if (!fs.existsSync(coverPath)) {
          return reply.status(404).send({ error: "Sin carátula exportada para la pista actual" });
        }
      }
      const lower = coverPath.toLowerCase();
      const mime = lower.endsWith(".png") ? "image/png" : "image/jpeg";
      reply.type(mime);
      return reply.send(fs.createReadStream(coverPath));
    },
  );
};

export { NOWPLAYING_JSON, CURRENT_COVER };
