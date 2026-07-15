import path from "node:path";
import type { Env } from "../config.js";
import { prisma } from "../db.js";
import { getOrCreateSettings } from "../services/app-settings.js";
import {
  introMatchKeyFromComment,
  normalizeIntroMatchKey,
} from "./intro-match-key.js";

export type AutoIntroMatchSource = "id3" | "folder";

export type AutoIntroMatch = {
  trackItemId: string;
  trackTitle: string;
  artist: string;
  introAssetId: string;
  introTitle: string;
  matchSource: AutoIntroMatchSource;
};

export type AutoIntroResult = {
  dryRun: boolean;
  folder: string;
  inserted: number;
  matches: AutoIntroMatch[];
};

function artistKeysForTrack(artist: string | null | undefined, title: string | null | undefined): string[] {
  const keys = new Set<string>();
  if (artist?.trim()) keys.add(normalizeIntroMatchKey(artist));
  if (title?.trim()) {
    const t = normalizeIntroMatchKey(title);
    if (t.length >= 3) keys.add(t);
  }
  return [...keys];
}

function introLookupKeys(asset: {
  title: string;
  artist: string | null;
  path: string;
  introMatchKey: string | null;
  id3Comment: string | null;
}): string[] {
  const keys = new Set<string>();
  if (asset.introMatchKey?.trim()) keys.add(normalizeIntroMatchKey(asset.introMatchKey));
  const fromComment = introMatchKeyFromComment(asset.id3Comment);
  if (fromComment) keys.add(fromComment);
  if (asset.artist?.trim()) keys.add(normalizeIntroMatchKey(asset.artist));
  keys.add(normalizeIntroMatchKey(asset.title));
  const base = path.basename(asset.path, path.extname(asset.path));
  keys.add(normalizeIntroMatchKey(base));
  const cleaned = base.replace(/^(intro|introm|vinheta)[\s\-_]+/i, "").trim();
  if (cleaned) keys.add(normalizeIntroMatchKey(cleaned));
  return [...keys].filter((k) => k.length >= 3);
}

function trackIntroKeys(asset: {
  artist: string | null;
  title: string;
  introMatchKey: string | null;
  id3Comment: string | null;
}): { keys: string[]; id3Key: string | null } {
  const id3Key =
    (asset.introMatchKey?.trim() ? normalizeIntroMatchKey(asset.introMatchKey) : null) ??
    introMatchKeyFromComment(asset.id3Comment);
  const keys: string[] = [];
  if (id3Key && id3Key.length >= 2) keys.push(id3Key);
  keys.push(...artistKeysForTrack(asset.artist, asset.title));
  return { keys: [...new Set(keys)], id3Key };
}

function folderPrefix(folder: string): string {
  const seg = folder.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!seg || seg.includes("..")) return "uploads/intros";
  return seg.startsWith("uploads/") ? seg : `uploads/${seg}`;
}

export async function runPlaylistAutoIntro(
  opts: {
    playlistId: string;
    folderPath?: string;
    dryRun?: boolean;
  },
  _env: Env,
): Promise<AutoIntroResult | null> {
  const settings = await getOrCreateSettings();
  const folder = folderPrefix(opts.folderPath ?? settings.autoIntroFolder ?? "intros");
  const prefix = `${folder}/`;

  const pl = await prisma.playlist.findUnique({
    where: { id: opts.playlistId },
    include: {
      items: {
        orderBy: { position: "asc" },
        include: { asset: true },
      },
    },
  });
  if (!pl) return null;

  const introAssets = await prisma.mediaAsset.findMany({
    where: { path: { startsWith: prefix } },
    select: {
      id: true,
      title: true,
      artist: true,
      path: true,
      introMatchKey: true,
      id3Comment: true,
    },
  });

  const introByKey = new Map<string, (typeof introAssets)[0]>();
  for (const intro of introAssets) {
    for (const key of introLookupKeys(intro)) {
      if (!introByKey.has(key)) introByKey.set(key, intro);
    }
  }

  const matches: AutoIntroMatch[] = [];
  const items = pl.items;

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (item.kind !== "track" || !item.asset) continue;
    const artist = item.asset.artist?.trim();
    if (!artist) continue;

    const { keys, id3Key } = trackIntroKeys(item.asset);
    let intro: (typeof introAssets)[0] | undefined;
    let matchSource: AutoIntroMatchSource = "folder";

    for (const key of keys) {
      const hit = introByKey.get(key);
      if (hit && hit.id !== item.asset.id) {
        intro = hit;
        matchSource = id3Key && key === id3Key ? "id3" : "folder";
        break;
      }
    }
    if (!intro) continue;

    const prev = items[i - 1];
    if (prev?.kind === "track" && prev.assetId === intro.id) continue;

    matches.push({
      trackItemId: item.id,
      trackTitle: item.asset.title,
      artist,
      introAssetId: intro.id,
      introTitle: intro.title,
      matchSource,
    });
  }

  if (opts.dryRun || matches.length === 0) {
    return { dryRun: Boolean(opts.dryRun), folder, inserted: 0, matches };
  }

  let inserted = 0;
  await prisma.$transaction(async (tx) => {
    const sorted = [...matches].sort((a, b) => {
      const pa = items.find((it) => it.id === a.trackItemId)?.position ?? 0;
      const pb = items.find((it) => it.id === b.trackItemId)?.position ?? 0;
      return pb - pa;
    });

    for (const m of sorted) {
      const currentItems = await tx.playlistItem.findMany({
        where: { playlistId: opts.playlistId },
        orderBy: { position: "asc" },
      });
      const track = currentItems.find((it) => it.id === m.trackItemId);
      if (!track) continue;
      const prev = currentItems.find((it) => it.position === track.position - 1);
      if (prev?.assetId === m.introAssetId) continue;

      const insertAt = track.position;
      const toShift = currentItems.filter((it) => it.position >= insertAt).sort((a, b) => b.position - a.position);
      for (const row of toShift) {
        await tx.playlistItem.update({
          where: { id: row.id },
          data: { position: row.position + 1 },
        });
      }
      await tx.playlistItem.create({
        data: {
          playlistId: opts.playlistId,
          kind: "track",
          assetId: m.introAssetId,
          label: `Auto intro · ${m.artist}${m.matchSource === "id3" ? " (ID3)" : ""}`,
          position: insertAt,
        },
      });
      inserted += 1;
    }
  });

  return { dryRun: false, folder, inserted, matches };
}
