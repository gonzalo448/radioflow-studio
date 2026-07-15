import { z } from "zod";

export const adBreakPayloadSchema = z.object({
  spotCount: z.number().int().min(1).max(10).optional(),
  pathPrefix: z.string().min(1).optional(),
});

export const adSchedulerConfigPatchSchema = z.object({
  enabled: z.boolean().optional(),
  pathPrefix: z.string().min(1).optional(),
  intervalMinutes: z.number().int().min(1).max(240).optional(),
  spotsPerBreak: z.number().int().min(1).max(10).optional(),
  maxSpotsPerHour: z.number().int().min(1).max(60).optional(),
  minGapMinutes: z.number().int().min(0).max(120).optional(),
  rotationMode: z.enum(["random", "sequential"]).optional(),
});
