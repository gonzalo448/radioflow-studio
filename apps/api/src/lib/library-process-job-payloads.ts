import { z } from "zod";

/** Campos comunes opcionales para políticas por job (timeouts, etc.). */
export const processJobPolicyBase = z.object({
  timeoutMsPerAsset: z.number().int().min(1000).max(600_000).optional(),
});

export const loudnessJobPolicySchema = processJobPolicyBase.extend({
  skipInaccessibleFiles: z.boolean().optional(),
});

export const bpmDetectJobPolicySchema = processJobPolicyBase.extend({
  /** Si true (default), lee TBPM / common.bpm antes del análisis de audio. */
  preferEmbeddedTags: z.boolean().optional(),
  /** Si true (default), analiza audio con ffmpeg cuando no hay tag BPM. */
  analyzeAudio: z.boolean().optional(),
});

export const trimSilenceJobPolicySchema = processJobPolicyBase.extend({
  noiseDb: z.number().min(-90).max(0).default(-50),
  minSilenceSec: z.number().min(0.1).max(30).default(0.5),
});

export const transcodeMp3JobPolicySchema = processJobPolicyBase.extend({
  bitrateKbps: z.number().int().min(64).max(320).default(192),
  preserveMetadata: z.boolean().default(true),
});

export const timeStretchJobPolicySchema = processJobPolicyBase.extend({
  /** 0.25–4.0 — >1 acelera (duración menor), <1 enlentece. */
  tempoRatio: z.number().min(0.25).max(4).default(1),
});

export const semanticEnrichJobPolicySchema = processJobPolicyBase.extend({
  /** Si true, omite pistas que ya tienen embeddingRef. */
  skipIfEmbedded: z.boolean().optional(),
  /** Si false, reutiliza semanticNote existente y solo recalcula embedding. */
  regenerateNote: z.boolean().optional(),
});

const assetIdsEnqueue = z.array(z.string()).min(1).max(200);

export const metadataSyncFiltersSchema = z.object({
  q: z.string().optional(),
  genre: z.string().optional(),
  artist: z.string().optional(),
  pathPrefix: z.string().optional(),
});

/** Cuerpo POST /library/process-jobs (unión por `kind`; sync_metadata usa además `mode`). */
export const enqueueLibraryProcessJobBody = z.union([
  z.object({
    kind: z.literal("loudness_batch"),
    assetIds: assetIdsEnqueue,
    targetLufs: z.number().min(-30).max(-5).default(-16),
    apply: z.boolean(),
    policy: loudnessJobPolicySchema.optional(),
  }),
  z.object({
    kind: z.literal("bpm_detect"),
    assetIds: assetIdsEnqueue,
    policy: bpmDetectJobPolicySchema.optional(),
  }),
  z.object({
    kind: z.literal("trim_silence"),
    assetIds: assetIdsEnqueue,
    apply: z.boolean().default(false),
    policy: trimSilenceJobPolicySchema.optional(),
  }),
  z.object({
    kind: z.literal("transcode_mp3"),
    assetIds: assetIdsEnqueue,
    apply: z.boolean().default(false),
    policy: transcodeMp3JobPolicySchema.optional(),
  }),
  z.object({
    kind: z.literal("time_stretch"),
    assetIds: assetIdsEnqueue,
    apply: z.boolean().default(false),
    policy: timeStretchJobPolicySchema.optional(),
  }),
  z.object({
    kind: z.literal("sync_metadata"),
    mode: z.literal("asset_ids"),
    assetIds: assetIdsEnqueue,
  }),
  z.object({
    kind: z.literal("sync_metadata"),
    mode: z.literal("library"),
    filters: metadataSyncFiltersSchema.optional(),
  }),
  z.object({
    kind: z.literal("semantic_enrich"),
    assetIds: assetIdsEnqueue,
    policy: semanticEnrichJobPolicySchema.optional(),
  }),
  z.object({
    kind: z.literal("pgvector_backfill"),
    assetIds: assetIdsEnqueue.optional(),
    limit: z.number().int().min(1).max(5000).optional(),
  }),
]);

/** Payload almacenado en DB para loudness (sin `kind` en JSON). */
export const loudnessJobPayloadSchema = z.object({
  assetIds: z.array(z.string()).min(1),
  targetLufs: z.number().min(-30).max(-5),
  apply: z.boolean(),
  policy: loudnessJobPolicySchema.optional(),
});

export const bpmDetectJobPayloadSchema = z.object({
  assetIds: z.array(z.string()).min(1),
  policy: bpmDetectJobPolicySchema.optional(),
});

export const trimSilenceJobPayloadSchema = z.object({
  assetIds: z.array(z.string()).min(1),
  apply: z.boolean().optional().default(false),
  policy: trimSilenceJobPolicySchema.optional(),
});

export const transcodeMp3JobPayloadSchema = z.object({
  assetIds: z.array(z.string()).min(1),
  apply: z.boolean().optional().default(false),
  policy: transcodeMp3JobPolicySchema.optional(),
});

export const timeStretchJobPayloadSchema = z.object({
  assetIds: z.array(z.string()).min(1),
  apply: z.boolean().optional().default(false),
  policy: timeStretchJobPolicySchema.optional(),
});

export const semanticEnrichJobPayloadSchema = z.object({
  assetIds: z.array(z.string()).min(1),
  policy: semanticEnrichJobPolicySchema.optional(),
});

export const pgvectorBackfillJobPayloadSchema = z.object({
  assetIds: z.array(z.string()).min(1).max(200).optional(),
  limit: z.number().int().min(1).max(5000).optional(),
});

export const syncMetadataJobPayloadSchema = z.object({
  mode: z.enum(["asset_ids", "library"]),
  assetIds: z.array(z.string()).min(1).max(200).optional(),
  filters: metadataSyncFiltersSchema.optional(),
});

export const playlistRenderJobPayloadSchema = z.object({
  playlistId: z.string().min(1),
  format: z.enum(["wav", "mp3"]),
});

export type EnqueueLibraryProcessJobBody = z.infer<typeof enqueueLibraryProcessJobBody>;
