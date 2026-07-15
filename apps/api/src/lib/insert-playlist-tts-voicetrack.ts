import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { Env } from "../config.js";
import { prisma } from "../db.js";
import { ensureMediaSubdir } from "./library-folder-path.js";
import { enrichMediaAssetFromAudioFile } from "./id3-enrich-asset.js";
import { insertPlaylistVoicetrackItem } from "./insert-playlist-voicetrack.js";
import { mediaRootAbs, relativeToMediaRoot } from "./media-path.js";
import { synthesizeSpeechToWav, ttsStoredFileName } from "./tts-synthesize.js";

const TTS_FOLDER = "uploads/voicetracks";

export async function insertPlaylistTtsVoicetrackItem(
  opts: {
    playlistId: string;
    text: string;
    label?: string;
    title?: string;
    insertAfterItemId?: string | null;
    lang?: string;
    rate?: number;
    engine?: "auto" | "sapi" | "espeak" | "edge-tts" | "piper";
    voice?: string;
  },
  env: Env,
) {
  const wav = await synthesizeSpeechToWav(
    opts.text,
    { lang: opts.lang, rate: opts.rate, engine: opts.engine, voice: opts.voice },
    env,
  );
  await ensureMediaSubdir(env, TTS_FOLDER);
  const storedName = ttsStoredFileName();
  const absDest = path.join(mediaRootAbs(env), "uploads", "voicetracks", storedName);
  await writeFile(absDest, wav);
  const relPath = relativeToMediaRoot(absDest, env);

  const displayTitle =
    opts.title?.trim() ||
    (opts.text.trim().length > 48 ? `${opts.text.trim().slice(0, 45)}…` : opts.text.trim());

  let asset = await prisma.mediaAsset.create({
    data: {
      title: displayTitle,
      artist: "TTS",
      path: relPath,
      mimeType: "audio/wav",
    },
  });
  asset = await enrichMediaAssetFromAudioFile(prisma, env, asset);

  return insertPlaylistVoicetrackItem(
    {
      playlistId: opts.playlistId,
      assetId: asset.id,
      label: opts.label,
      title: displayTitle,
      insertAfterItemId: opts.insertAfterItemId ?? null,
    },
    env,
  );
}
