import { z } from "zod";

const categoryFiltersSchema = z
  .object({
    yearMin: z.number().int().min(1900).max(2100).optional(),
    yearMax: z.number().int().min(1900).max(2100).optional(),
    durationMinSec: z.number().int().min(1).max(3600).optional(),
    durationMaxSec: z.number().int().min(1).max(3600).optional(),
  })
  .optional();

export const categoryRuleSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  name: z.string().min(1).max(120).optional(),
  kind: z.enum(["genre", "folder", "artist"]),
  value: z.string().min(1),
  weight: z.number().int().min(1).max(100).optional(),
  picksPerCycle: z.number().int().min(1).max(20).optional(),
  ignoreRepeatProtection: z.boolean().optional(),
  preferFewerPlays: z.boolean().optional(),
  filters: categoryFiltersSchema,
});

export const playlistGenerateBodySchema = z
  .object({
    name: z.string().min(1).optional(),
    targetDurationSec: z.number().int().min(60).max(86_400).optional(),
    genres: z.array(z.string().min(1)).optional(),
    pathPrefixes: z.array(z.string().min(1)).optional(),
    categoryRules: z.array(categoryRuleSchema).min(1).max(48).optional(),
    rotation: z.array(z.string().min(1)).max(200).optional(),
    order: z.enum(["random", "title"]).optional(),
    minArtistGap: z.number().int().min(0).max(20).optional(),
    maxTracks: z.number().int().min(1).max(500).optional(),
  })
  .refine(
    (v) =>
      (v.genres?.length ?? 0) > 0 ||
      (v.pathPrefixes?.length ?? 0) > 0 ||
      (v.categoryRules?.length ?? 0) > 0,
    { message: "Indique géneros, carpetas o reglas de rotación por categoría" },
  );

export type ParsedPlaylistGenerateBody = z.infer<typeof playlistGenerateBodySchema>;

export const schedulerGeneratePayloadSchema = z.object({
  generate: playlistGenerateBodySchema,
  replaceQueue: z.boolean().optional(),
});
