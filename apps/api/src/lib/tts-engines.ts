import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import type { Env } from "../config.js";

const execFileAsync = promisify(execFile);

export type TtsEngine = "auto" | "sapi" | "espeak" | "edge-tts" | "piper";

export type TtsSynthesizeOpts = {
  lang?: string;
  /** 0.5–2.0 — velocidad relativa (1 = normal). */
  rate?: number;
  voice?: string;
  engine?: TtsEngine;
};

function clampRate(rate: number | undefined): number {
  const r = rate ?? 1;
  return Math.min(2, Math.max(0.5, r));
}

function sapiRateFromRatio(ratio: number): number {
  return Math.round(Math.min(10, Math.max(-10, (ratio - 1) * 10)));
}

function espeakVoiceFromLang(lang: string | undefined): string {
  const l = (lang ?? "es").toLowerCase();
  if (l.startsWith("en")) return "en";
  if (l.startsWith("pt")) return "pt";
  if (l.startsWith("fr")) return "fr";
  return "es";
}

function resolveEngine(requested: TtsEngine | undefined, env: Env): Exclude<TtsEngine, "auto"> {
  const cfg = env.TTS_ENGINE;
  const pick = requested && requested !== "auto" ? requested : cfg === "auto" ? null : cfg;
  if (pick) return pick;
  if (process.platform === "win32") return "sapi";
  return "espeak";
}

async function synthesizeSapi(textFile: string, outWav: string, rate: number): Promise<void> {
  const sapiRate = sapiRateFromRatio(rate);
  const ps = [
    "Add-Type -AssemblyName System.Speech",
    "$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer",
    `$synth.Rate = ${sapiRate}`,
    `$text = Get-Content -LiteralPath '${textFile.replace(/'/g, "''")}' -Raw -Encoding UTF8`,
    `$synth.SetOutputToWaveFile('${outWav.replace(/\\/g, "\\\\")}')`,
    "$synth.Speak($text)",
    "$synth.Dispose()",
  ].join("; ");
  await execFileAsync("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps], {
    timeout: 120_000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  });
}

async function synthesizeEspeak(textFile: string, outWav: string, lang: string | undefined, rate: number): Promise<void> {
  const voice = espeakVoiceFromLang(lang);
  const wpm = Math.round(175 * rate);
  const args = ["-w", outWav, "-v", voice, "-s", String(wpm), "-f", textFile];
  try {
    await execFileAsync("espeak-ng", args, { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
  } catch {
    await execFileAsync("espeak", args, { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
  }
}

async function synthesizeEdgeTts(text: string, outWav: string, env: Env, opts: TtsSynthesizeOpts): Promise<void> {
  const voice = opts.voice?.trim() || env.TTS_EDGE_VOICE;
  const ratePct = Math.round((clampRate(opts.rate) - 1) * 100);
  const rateArg = ratePct >= 0 ? `+${ratePct}%` : `${ratePct}%`;
  const tmpMp3 = outWav.replace(/\.wav$/i, ".mp3");
  try {
    await execFileAsync(
      "edge-tts",
      ["--voice", voice, "--rate", rateArg, "--text", text, "--write-media", tmpMp3],
      { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 },
    );
    await execFileAsync(
      env.FFMPEG_PATH,
      ["-hide_banner", "-y", "-i", tmpMp3, "-acodec", "pcm_s16le", "-ar", "22050", outWav],
      { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 },
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`edge-tts no disponible (pip install edge-tts): ${detail}`);
  }
}

async function synthesizePiper(text: string, outWav: string, env: Env): Promise<void> {
  const bin = env.TTS_PIPER_PATH;
  const model = env.TTS_PIPER_MODEL;
  if (!model) throw new Error("TTS_PIPER_MODEL no configurado");
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(bin, ["--model", model, "--output_file", outWav], { windowsHide: true });
    const t = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error("Piper timeout"));
    }, 120_000);
    proc.on("error", (err) => {
      clearTimeout(t);
      reject(err);
    });
    proc.on("exit", (code) => {
      clearTimeout(t);
      if (code === 0) resolve();
      else reject(new Error(`Piper salió con código ${code ?? "?"}`));
    });
    proc.stdin.write(text);
    proc.stdin.end();
  });
}

export async function runTtsEngine(
  engine: Exclude<TtsEngine, "auto">,
  text: string,
  textFile: string,
  outWav: string,
  env: Env,
  opts: TtsSynthesizeOpts,
): Promise<void> {
  const rate = clampRate(opts.rate);
  switch (engine) {
    case "sapi":
      if (process.platform !== "win32") throw new Error("SAPI solo en Windows");
      await synthesizeSapi(textFile, outWav, rate);
      return;
    case "espeak":
      await synthesizeEspeak(textFile, outWav, opts.lang, rate);
      return;
    case "edge-tts":
      await synthesizeEdgeTts(text, outWav, env, opts);
      return;
    case "piper":
      await synthesizePiper(text, outWav, env);
      return;
    default:
      throw new Error(`Motor TTS desconocido: ${engine}`);
  }
}

export function resolveTtsEngine(opts: TtsSynthesizeOpts | undefined, env: Env): Exclude<TtsEngine, "auto"> {
  return resolveEngine(opts?.engine, env);
}
