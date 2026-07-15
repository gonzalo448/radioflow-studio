import { existsSync } from "node:fs";
import path from "node:path";
import type { MediaAsset, PrismaClient } from "@prisma/client";
import NodeID3 from "node-id3";
import type { Env } from "../config.js";
import { AppError } from "./app-error.js";
import { enrichMediaAssetFromAudioFile } from "./id3-enrich-asset.js";
import { resolveAssetFilePath } from "./media-path.js";
import { isRemoteStreamPath } from "./remote-stream-path.js";

/** Campos ID3 que RadioFlow escribe en MP3 (C4). */
export type Id3WriteFields = {
  title: string;
  artist?: string | null;
  album?: string | null;
  genre?: string | null;
  releaseYear?: number | null;
  id3Comment?: string | null;
};

const ID3_WRITABLE_EXT = new Set([".mp3"]);

export function isId3WritableExt(filePathOrName: string): boolean {
  return ID3_WRITABLE_EXT.has(path.extname(filePathOrName).toLowerCase());
}

export function id3WriteFieldsFromAsset(asset: MediaAsset): Id3WriteFields {
  return {
    title: asset.title,
    artist: asset.artist,
    album: asset.album,
    genre: asset.genre,
    releaseYear: asset.releaseYear,
    id3Comment: asset.id3Comment,
  };
}

/** Construye tags node-id3 a partir de campos de biblioteca. */
export function buildNodeId3Tags(fields: Id3WriteFields): NodeID3.Tags {
  const tags: NodeID3.Tags = {
    title: fields.title.trim() || "Sin título",
  };
  if (fields.artist != null && fields.artist.trim()) tags.artist = fields.artist.trim();
  else tags.artist = "";
  if (fields.album != null && fields.album.trim()) tags.album = fields.album.trim();
  else tags.album = "";
  if (fields.genre != null && fields.genre.trim()) tags.genre = fields.genre.trim();
  else tags.genre = "";
  if (fields.releaseYear != null && fields.releaseYear >= 1900 && fields.releaseYear <= 2100) {
    tags.year = String(fields.releaseYear);
  } else {
    tags.year = "";
  }
  const comment = fields.id3Comment?.trim() ?? "";
  tags.comment = { language: "spa", text: comment };
  return tags;
}

/**
 * Escribe tags ID3v2 en un archivo MP3 existente (in-place).
 * No reescribe audio; solo frames de metadatos.
 */
export function writeId3TagsToMp3File(absPath: string, fields: Id3WriteFields): void {
  if (!isId3WritableExt(absPath)) {
    throw new AppError("Solo se pueden escribir tags ID3 en archivos .mp3", {
      statusCode: 422,
      code: "ID3_WRITE_UNSUPPORTED",
    });
  }
  if (!existsSync(absPath)) {
    throw new AppError("Archivo no accesible en el servidor", {
      statusCode: 400,
      code: "ID3_WRITE_MISSING_FILE",
    });
  }
  const tags = buildNodeId3Tags(fields);
  const result = NodeID3.update(tags, absPath);
  if (result instanceof Error) {
    throw new AppError(`No se pudieron escribir tags ID3: ${result.message}`, {
      statusCode: 422,
      code: "ID3_WRITE_FAILED",
      cause: result,
    });
  }
  if (result !== true) {
    throw new AppError("No se pudieron escribir tags ID3", {
      statusCode: 422,
      code: "ID3_WRITE_FAILED",
    });
  }
}

/**
 * Escribe metadatos de la fila MediaAsset al archivo MP3 y relee el archivo → DB (round-trip).
 */
export async function writeMediaAssetId3ToFile(
  prisma: PrismaClient,
  env: Env,
  asset: MediaAsset,
  fields?: Partial<Id3WriteFields>,
): Promise<MediaAsset> {
  if (isRemoteStreamPath(asset.path)) {
    throw new AppError("No se pueden escribir tags en un stream remoto", {
      statusCode: 422,
      code: "ID3_WRITE_REMOTE",
    });
  }
  const abs = resolveAssetFilePath(asset.path, env);
  if (!abs) {
    throw new AppError("Archivo no accesible en el servidor", {
      statusCode: 400,
      code: "ID3_WRITE_MISSING_FILE",
    });
  }
  if (!isId3WritableExt(abs)) {
    throw new AppError("Solo MP3 soporta escritura ID3 (C4). Use relectura para otros formatos.", {
      statusCode: 422,
      code: "ID3_WRITE_UNSUPPORTED",
      details: { ext: path.extname(abs).toLowerCase() },
    });
  }

  const merged: Id3WriteFields = {
    ...id3WriteFieldsFromAsset(asset),
    ...fields,
    title: (fields?.title ?? asset.title).trim() || asset.title,
  };
  writeId3TagsToMp3File(abs, merged);
  return enrichMediaAssetFromAudioFile(prisma, env, asset);
}
