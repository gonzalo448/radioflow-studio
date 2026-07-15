import type { Env } from "../config.js";
import { prisma } from "../db.js";
import { enrichMediaAssetFromAudioFile } from "./id3-enrich-asset.js";

const MAX_CONCURRENT = 2;
const pending: string[] = [];
const pendingSet = new Set<string>();
let active = 0;

async function drain(env: Env): Promise<void> {
  while (active < MAX_CONCURRENT && pending.length > 0) {
    const id = pending.shift();
    if (!id) break;
    pendingSet.delete(id);
    active += 1;
    void (async () => {
      try {
        const row = await prisma.mediaAsset.findUnique({ where: { id } });
        if (row) await enrichMediaAssetFromAudioFile(prisma, env, row);
      } catch (err) {
        console.warn("[library] enrich async failed", id, err);
      } finally {
        active -= 1;
        void drain(env);
      }
    })();
  }
}

/** Encola enriquecimiento ID3/carátula/cues sin disparar miles de lecturas en paralelo. */
export function scheduleAssetEnrich(env: Env, assetId: string): void {
  if (!assetId || pendingSet.has(assetId)) return;
  pendingSet.add(assetId);
  pending.push(assetId);
  void drain(env);
}
