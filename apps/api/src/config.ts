import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  OLLAMA_BASE_URL: z
    .string()
    .optional()
    .transform((s) => (s && s.length > 0 ? s : undefined)),
  OLLAMA_MODEL: z.string().default("llama3.2"),
  MEDIA_ROOT: z.string().default("data/media"),
  /** >0 activa parrilla automática dentro del proceso API (no usar junto con schedule-worker). */
  INTERNAL_SCHEDULE_POLL_MS: z.coerce.number().int().min(0).default(0),
  /** Igual que en schedule-worker: `0` = append; por defecto reemplaza cola al cambiar bloque. */
  SCHEDULE_REPLACE_QUEUE: z
    .string()
    .optional()
    .transform((v) => v !== "0"),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Variables de entorno inválidas:", parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return parsed.data;
}
