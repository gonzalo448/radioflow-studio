import { existsSync } from "node:fs";
import { parseFile } from "music-metadata";
import type { PrismaClient } from "@prisma/client";
import type { ApiLibraryProcessTracksBpmDetectResult, ApiLibraryProcessTracksBpmDetectRow } from "@radioflow/shared";
import type { Env } from "../config.js";
import { detectBpmFromAudioFile } from "./library-bpm-audio.js";
import { resolveAssetFilePath } from "./media-path.js";

export type BpmDetectBatchProgress = {
  done: number;
  total: number;
  rows: ApiLibraryProcessTracksBpmDetectRow[];
};

function pickBpmFromCommon(common: { bpm?: unknown }): number | null {
  const v = common.bpm;
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);
  if (Array.isArray(v)) {
    const first = v.find((x) => typeof x === "number" && Number.isFinite(x));
    return typeof first === "number" ? Math.round(first) : null;
  }
  return null;
}

async function readBpmFromTags(abs: string): Promise<number | null> {
  const mm = await parseFile(abs, { skipCovers: true, duration: false });
  return pickBpmFromCommon(mm.common);
}

/**
 * BPM desde TBPM embebido y, si falta, análisis de audio vía ffmpeg (autocorrelación).
 */
export async function runBpmDetectBatchForAssets(
  prisma: PrismaClient,
  env: Env,
  params: {
    assetIds: string[];
    preferEmbeddedTags: boolean;
    analyzeAudio: boolean;
    timeoutMsPerAsset: number;
    onProgress?: (p: BpmDetectBatchProgress) => Promise<void>;
  },
): Promise<ApiLibraryProcessTracksBpmDetectResult> {
  const { assetIds, preferEmbeddedTags, analyzeAudio, timeoutMsPerAsset, onProgress } = params;
  const rowsOut: ApiLibraryProcessTracksBpmDetectResult["rows"] = [];
  const total = assetIds.length;
  const assets = await prisma.mediaAsset.findMany({
    where: { id: { in: assetIds } },
    select: { id: true, path: true, title: true },
  });
  const byId = new Map(assets.map((a) => [a.id, a]));
  let done = 0;

  for (const id of assetIds) {
    const asset = byId.get(id);
    if (!asset) {
      rowsOut.push({
        assetId: id,
        title: "",
        path: "",
        bpmFromTags: null,
        bpmFromAudio: null,
        bpm: null,
        error: "No encontrado",
      });
      done += 1;
      if (onProgress) await onProgress({ done, total, rows: [...rowsOut] });
      continue;
    }

    const abs = resolveAssetFilePath(asset.path, env);
    if (!abs || !existsSync(abs)) {
      rowsOut.push({
        assetId: id,
        title: asset.title,
        path: asset.path,
        bpmFromTags: null,
        bpmFromAudio: null,
        bpm: null,
        error: "Archivo no accesible",
      });
      done += 1;
      if (onProgress) await onProgress({ done, total, rows: [...rowsOut] });
      continue;
    }

    let bpmFromTags: number | null = null;
    let bpmFromAudio: number | null = null;
    let note: string | null = null;
    let error: string | null = null;

    try {
      if (preferEmbeddedTags) {
        try {
          bpmFromTags = await readBpmFromTags(abs);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          error = msg.slice(0, 500);
        }
      }

      const needAudio = analyzeAudio && bpmFromTags == null;
      if (needAudio) {
        if (!env.AUDIO_FFMPEG_ENABLED) {
          note = bpmFromTags == null ? "Sin TBPM; AUDIO_FFMPEG_ENABLED=0" : null;
        } else {
          try {
            bpmFromAudio = await detectBpmFromAudioFile(abs, env, timeoutMsPerAsset);
            if (bpmFromAudio == null && bpmFromTags == null && !error) {
              note = "No se pudo estimar BPM por audio";
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (!error) error = msg.slice(0, 500);
          }
        }
      } else if (!preferEmbeddedTags && !analyzeAudio) {
        note = "Análisis desactivado en policy";
      } else if (bpmFromTags == null && !analyzeAudio) {
        note = "Sin TBPM / bpm en metadatos";
      }

      const bpm = bpmFromTags ?? bpmFromAudio;
      rowsOut.push({
        assetId: id,
        title: asset.title,
        path: asset.path,
        bpmFromTags,
        bpmFromAudio,
        bpm,
        note,
        error,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      rowsOut.push({
        assetId: id,
        title: asset.title,
        path: asset.path,
        bpmFromTags: null,
        bpmFromAudio: null,
        bpm: null,
        error: msg.slice(0, 500),
      });
    }

    done += 1;
    if (onProgress) await onProgress({ done, total, rows: [...rowsOut] });
  }

  return { kind: "bpm_detect", rows: rowsOut };
}
