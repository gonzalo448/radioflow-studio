import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Env } from "../config.js";
import { loadEnv } from "../config.js";
import { resolveTtsEngine, runTtsEngine, type TtsSynthesizeOpts } from "./tts-engines.js";

export type { TtsSynthesizeOpts } from "./tts-engines.js";

/**
 * Sintetiza texto a WAV según motor configurado (SAPI, espeak, edge-tts, Piper).
 * @throws Error si no hay motor TTS disponible.
 */
export async function synthesizeSpeechToWav(
  text: string,
  opts?: TtsSynthesizeOpts,
  env?: Env,
): Promise<Buffer> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Texto vacío");
  if (trimmed.length > 4000) throw new Error("Texto demasiado largo (máx. 4000 caracteres)");

  const runtimeEnv = env ?? loadEnv();
  const engine = resolveTtsEngine(opts, runtimeEnv);

  const dir = await mkdtemp(path.join(tmpdir(), "rf-tts-"));
  const outWav = path.join(dir, "out.wav");
  const textFile = path.join(dir, "text.txt");

  try {
    await writeFile(textFile, trimmed, "utf8");
    await runTtsEngine(engine, trimmed, textFile, outWav, runtimeEnv, opts ?? {});
    return await readFile(outWav);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`TTS (${engine}) no disponible: ${detail}`);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Nombre de archivo seguro para WAV TTS en bóveda. */
export function ttsStoredFileName(): string {
  return `tts-${randomBytes(6).toString("hex")}.wav`;
}
