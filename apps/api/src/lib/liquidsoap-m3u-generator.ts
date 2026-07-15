import fs from "node:fs";
import path from "node:path";
import type { Env } from "../config.js";
import { loadEnv } from "../config.js";
import { prisma } from "../db.js";
import { resolveAssetFilePath } from "./media-path.js";
import { resolveLiquidsoapAudioPath } from "./resolve-liquidsoap-audio-path.js";
import { MAIN_STATION_ID } from "../services/station-state.js";

function toPosixPath(abs: string): string {
  return path.resolve(abs).split(path.sep).join("/");
}

function liquidsoapOutDir(env?: Env): string {
  const resolvedEnv = env ?? loadEnv();
  return process.env.LIQUIDSOAP_PLAYLIST_DIR?.trim() || path.join(process.cwd(), "playlists");
}

async function writeM3uFile(outDir: string, fileName: string, lines: string[]): Promise<string> {
  await fs.promises.mkdir(outDir, { recursive: true });
  const dest = path.join(outDir, fileName);
  const body = lines.length ? `${lines.join("\n")}\n` : "#EXTM3U\n";
  await fs.promises.writeFile(dest, body, "utf8");
  return dest;
}

export type GenerateLiquidsoapM3uResult = {
  written: number;
  outDir: string;
  files: string[];
  stationQueueTracks: number;
  eventoTracks: number;
};

/** Escribe M3U de la cola principal de cabina (desde posición actual). */
export async function generateStationQueueM3u(env?: Env): Promise<{ path: string; trackCount: number }> {
  const resolvedEnv = env ?? loadEnv();
  const outDir = liquidsoapOutDir(resolvedEnv);
  const station = await prisma.station.findUnique({ where: { id: MAIN_STATION_ID } });
  const pos = station?.currentPosition ?? 0;
  const rows = await prisma.playQueueItem.findMany({
    where: { stationId: MAIN_STATION_ID },
    orderBy: { position: "asc" },
    include: { asset: true },
  });

  const lines: string[] = ["#EXTM3U"];
  for (let i = pos; i < rows.length; i++) {
    const row = rows[i];
    if (row.kind !== "track" && row.kind !== "voicetrack") continue;
    if (!row.asset) continue;
    const abs = resolveAssetFilePath(row.asset.path, resolvedEnv);
    if (!abs) continue;
    const title = row.label?.trim() || row.asset.title;
    lines.push(`#EXTINF:-1,${title}`);
    lines.push(toPosixPath(abs));
  }

  const dest = await writeM3uFile(outDir, "station-queue.m3u", lines);
  const trackCount = Math.max(0, (lines.length - 1) / 2);
  return { path: dest, trackCount };
}

/** Manifest de eventos legacy del día (rutas resueltas bajo MEDIA_ROOT). */
export async function generateEventosDayM3u(env?: Env): Promise<{ path: string; trackCount: number }> {
  const resolvedEnv = env ?? loadEnv();
  const outDir = liquidsoapOutDir(resolvedEnv);
  const now = new Date();
  const diaSemana = now.toLocaleDateString("es-CO", { weekday: "long" }).toLowerCase();

  const rows = await prisma.evento.findMany({
    where: { dia: diaSemana },
    orderBy: [{ hora: "asc" }, { id: "asc" }],
  });

  const lines: string[] = ["#EXTM3U"];
  for (const e of rows) {
    const abs = resolveLiquidsoapAudioPath(e.rutaAudio, resolvedEnv);
    if (!abs) continue;
    const label = e.descripcion?.trim() || `Evento ${e.hora}`;
    lines.push(`#EXTINF:-1,${label}`);
    lines.push(abs);
  }

  const dest = await writeM3uFile(outDir, "eventos-hoy.m3u", lines);
  return { path: dest, trackCount: Math.max(0, lines.length - 1) / 2 };
}

/** Lee `programacion` + playlists y escribe un .m3u por bloque (rutas absolutas bajo MEDIA_ROOT). */
export async function generateLiquidsoapM3uPlaylists(env?: Env): Promise<{ written: number; outDir: string }> {
  const resolvedEnv = env ?? loadEnv();
  const outDir = liquidsoapOutDir(resolvedEnv);
  await fs.promises.mkdir(outDir, { recursive: true });

  let written = 0;
  const blocks = await prisma.programacionBlock.findMany({
    where: { playlistId: { not: null } },
    orderBy: [{ dia: "asc" }, { hora: "asc" }],
    include: {
      playlist: {
        include: {
          items: { orderBy: { position: "asc" }, include: { asset: true } },
        },
      },
    },
  });

  for (const bloque of blocks) {
    const pl = bloque.playlist;
    if (!pl || !bloque.playlistId) continue;

    const lines: string[] = ["#EXTM3U"];
    for (const it of pl.items) {
      if (it.kind !== "track" && it.kind !== "voicetrack") continue;
      if (!it.asset) continue;
      const abs = resolveAssetFilePath(it.asset.path, resolvedEnv);
      if (!abs) continue;
      lines.push(`#EXTINF:-1,${it.asset.title}`);
      lines.push(toPosixPath(abs));
    }

    const fileName = `programacion-${bloque.id}.m3u`;
    await writeM3uFile(outDir, fileName, lines);
    written += 1;
  }

  return { written, outDir };
}

/** Regenera todos los M3U consumidos por Liquidsoap (cola, eventos, parrilla). */
export async function regenerateAllLiquidsoapM3u(env?: Env): Promise<GenerateLiquidsoapM3uResult> {
  const resolvedEnv = env ?? loadEnv();
  const [prog, station, eventos] = await Promise.all([
    generateLiquidsoapM3uPlaylists(resolvedEnv),
    generateStationQueueM3u(resolvedEnv),
    generateEventosDayM3u(resolvedEnv),
  ]);

  const files = [
    path.basename(station.path),
    path.basename(eventos.path),
    ...Array.from({ length: prog.written }, (_, i) => `programacion-*.m3u`),
  ];

  return {
    written: prog.written + 2,
    outDir: prog.outDir,
    files,
    stationQueueTracks: station.trackCount,
    eventoTracks: eventos.trackCount,
  };
}

/** Construye cuerpo M3U en memoria para HTTP (cola actual). */
export async function buildStationQueueM3uBody(env?: Env): Promise<string> {
  const resolvedEnv = env ?? loadEnv();
  const station = await prisma.station.findUnique({ where: { id: MAIN_STATION_ID } });
  const pos = station?.currentPosition ?? 0;
  const rows = await prisma.playQueueItem.findMany({
    where: { stationId: MAIN_STATION_ID },
    orderBy: { position: "asc" },
    include: { asset: true },
  });

  const lines: string[] = ["#EXTM3U"];
  for (let i = pos; i < rows.length; i++) {
    const row = rows[i];
    if (row.kind !== "track" && row.kind !== "voicetrack") continue;
    if (!row.asset) continue;
    const abs = resolveAssetFilePath(row.asset.path, resolvedEnv);
    if (!abs) continue;
    lines.push(toPosixPath(abs));
  }
  return lines.length > 1 ? `${lines.join("\n")}\n` : "#EXTM3U\n";
}
