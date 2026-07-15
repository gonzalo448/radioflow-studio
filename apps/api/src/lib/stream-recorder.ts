import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Env } from "../config.js";
import { prisma } from "../db.js";
import { ensureMediaSubdir } from "./library-folder-path.js";
import { probeIcecastStatus } from "./icecast-status.js";
import { mediaRootAbs } from "./media-path.js";
import { getOrCreateSettings } from "../services/app-settings.js";

export type StreamRecordingStatus = {
  active: boolean;
  startedAt: string | null;
  relPath: string | null;
  listenUrl: string | null;
  targetName: string | null;
  error: string | null;
};

type ActiveSession = {
  startedAt: Date;
  relPath: string;
  absPath: string;
  listenUrl: string;
  targetName: string;
  proc: ChildProcess;
};

let activeSession: ActiveSession | null = null;

function recordingFolderPrefix(folder: string): string {
  const seg = folder.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!seg || seg.includes("..")) return "uploads/recordings";
  return seg.startsWith("uploads/") ? seg : `uploads/${seg}`;
}

export function getStreamRecordingStatus(): StreamRecordingStatus {
  if (!activeSession) {
    return {
      active: false,
      startedAt: null,
      relPath: null,
      listenUrl: null,
      targetName: null,
      error: null,
    };
  }
  return {
    active: true,
    startedAt: activeSession.startedAt.toISOString(),
    relPath: activeSession.relPath,
    listenUrl: activeSession.listenUrl,
    targetName: activeSession.targetName,
    error: null,
  };
}

export async function startStreamRecording(env: Env): Promise<StreamRecordingStatus> {
  if (activeSession) {
    throw new Error("Ya hay una grabación en curso");
  }
  if (!env.AUDIO_FFMPEG_ENABLED) {
    throw new Error("AUDIO_FFMPEG_ENABLED=0 — active ffmpeg en .env para grabar el stream");
  }

  const settings = await getOrCreateSettings();
  if (!settings.activeStreamingTargetId) {
    throw new Error("Configure un destino activo en Marca antes de grabar");
  }
  const target = await prisma.streamingTarget.findUnique({
    where: { id: settings.activeStreamingTargetId },
  });
  if (!target || !target.enabled) {
    throw new Error("Destino de streaming activo no válido");
  }
  if (target.protocol !== "icecast" && target.protocol !== "azuracast") {
    throw new Error("La grabación MVP solo soporta Icecast/AzuraCast");
  }

  const ice = await probeIcecastStatus({
    host: target.host,
    port: target.port,
    mountPath: target.mountPath,
    tls: target.tls,
    publicBaseUrl: target.publicBaseUrl,
  });
  if (!ice.listenUrl) {
    throw new Error("No se pudo resolver la URL de escucha del stream");
  }
  if (ice.sourceConnected === false) {
    throw new Error("Icecast sin fuente conectada — encendé el encoder antes de grabar");
  }

  const folder = recordingFolderPrefix(settings.streamRecordingFolder ?? "recordings");
  await ensureMediaSubdir(env, folder);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const relPath = `${folder}/stream-${stamp}.mp3`;
  const absPath = path.join(mediaRootAbs(env), ...relPath.split("/"));

  const args = ["-hide_banner", "-nostats", "-y", "-i", ice.listenUrl, "-c", "copy", absPath];
  const proc = spawn(env.FFMPEG_PATH, args, { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });

  let spawnErr: string | null = null;
  proc.stderr?.on("data", (chunk: Buffer) => {
    const line = chunk.toString("utf8");
    if (/error/i.test(line) && line.length < 400) spawnErr = line.trim();
  });

  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => resolve(), 800);
    proc.once("error", (err) => {
      clearTimeout(t);
      reject(err);
    });
    proc.once("spawn", () => {
      clearTimeout(t);
      resolve();
    });
  });

  if (spawnErr) {
    proc.kill("SIGTERM");
    throw new Error(spawnErr);
  }

  activeSession = {
    startedAt: new Date(),
    relPath,
    absPath,
    listenUrl: ice.listenUrl,
    targetName: target.name,
    proc,
  };

  proc.on("exit", () => {
    if (activeSession?.proc === proc) activeSession = null;
  });

  return getStreamRecordingStatus();
}

export async function stopStreamRecording(_env: Env): Promise<{
  status: StreamRecordingStatus;
  relPath: string | null;
  durationSec: number | null;
  addedToLibrary: boolean;
  assetId: string | null;
}> {
  const session = activeSession;
  if (!session) {
    return {
      status: getStreamRecordingStatus(),
      relPath: null,
      durationSec: null,
      addedToLibrary: false,
      assetId: null,
    };
  }

  session.proc.kill("SIGINT");
  await new Promise<void>((resolve) => {
    const t = setTimeout(() => {
      try {
        session.proc.kill("SIGKILL");
      } catch {
        // ok
      }
      resolve();
    }, 5000);
    session.proc.once("exit", () => {
      clearTimeout(t);
      resolve();
    });
  });
  activeSession = null;

  const durationSec = Math.max(1, Math.round((Date.now() - session.startedAt.getTime()) / 1000));
  let assetId: string | null = null;
  let addedToLibrary = false;

  if (existsSync(session.absPath)) {
    const title = `Grabación ${session.startedAt.toLocaleString()}`;
    const asset = await prisma.mediaAsset.create({
      data: {
        title,
        artist: "Stream",
        path: session.relPath,
        mimeType: "audio/mpeg",
        durationSec,
      },
    });
    assetId = asset.id;
    addedToLibrary = true;
  }

  return {
    status: getStreamRecordingStatus(),
    relPath: session.relPath,
    durationSec,
    addedToLibrary,
    assetId,
  };
}
