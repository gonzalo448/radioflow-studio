import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL: z.string().default("30d"),
  /**
   * Orígenes CORS permitidos (separados por coma). En producción es RECOMENDADO definirlo explícitamente.
   * Vacío / "none" desactiva CORS.
   */
  CORS_ORIGIN: z
    .string()
    .optional()
    .transform((s) => {
      const v = (s ?? "").trim();
      if (!v || v.toLowerCase() === "none") return "";
      return v;
    })
    .default("http://localhost:5173,http://127.0.0.1:5173,null"),
  /** Límite global de body JSON (bytes). */
  BODY_LIMIT_BYTES: z.coerce.number().int().min(1024).default(1_048_576),
  /** Habilita credentials en CORS. */
  CORS_CREDENTIALS: z.coerce.boolean().default(true),
  OLLAMA_BASE_URL: z
    .string()
    .optional()
    .transform((s) => (s && s.length > 0 ? s : undefined)),
  OLLAMA_MODEL: z.string().default("llama3.2"),
  /** Modelo Ollama para embeddings (ej. nomic-embed-text). */
  OLLAMA_EMBEDDING_MODEL: z.string().default("nomic-embed-text"),
  MEDIA_ROOT: z.string().default("data/media"),
  /**
   * Política de ingesta a la bóveda:
   * - `copy`: solo upload multipart (default; desktop con BOOTSTRAP_LOCAL_ADMIN siempre copy).
   * - `register`: permite POST /library/assets y M3U “registrar” si el archivo ya está bajo MEDIA_ROOT.
   */
  LIBRARY_INGEST_MODE: z.enum(["copy", "register"]).default("copy"),
  /** Poll (ms) del escaneo automático de biblioteca; 0 = solo manual vía API. */
  LIBRARY_AUTO_UPDATE_POLL_MS: z.coerce.number().int().min(0).default(60_000),
  /**
   * Si true, cuando music-metadata no entrega duración se intenta leer con ffprobe (`FFPROBE_PATH`).
   * Útil en servidores sin job ffmpeg pesado; solo sonda duración.
   */
  AUDIO_FFPROBE_ENABLED: z.coerce.boolean().default(false),
  /** Ejecutable ffprobe (por defecto se busca `ffprobe` en el PATH). */
  FFPROBE_PATH: z
    .string()
    .optional()
    .transform((s) => (s != null && String(s).trim() ? String(s).trim() : "ffprobe")),
  /**
   * Si true, habilita operaciones de procesado con ffmpeg en la API (p. ej. medición loudnorm).
   * Los jobs pesados en cola llegarán en una fase posterior.
   */
  AUDIO_FFMPEG_ENABLED: z.coerce.boolean().default(false),
  /** Ejecutable ffmpeg (por defecto `ffmpeg` en el PATH). */
  FFMPEG_PATH: z
    .string()
    .optional()
    .transform((s) => (s != null && String(s).trim() ? String(s).trim() : "ffmpeg")),
  /**
   * Tareas en segundo plano dentro del proceso API (no HTTP):
   * - `http-only`: ninguna (producción con workers externos).
   * - `maintenance`: limpieza tokens + jobs biblioteca.
   * - `automation`: parrilla interna + scheduler de eventos (según poll ms).
   * - `full`: mantenimiento + automatización (desarrollo / todo-en-uno).
   */
  API_BACKGROUND_MODE: z.enum(["http-only", "maintenance", "automation", "full"]).default("full"),
  /** Espera tras `app.close()` antes de `process.exit` (ms); da tiempo a callbacks pendientes. */
  SHUTDOWN_GRACE_MS: z.coerce.number().int().min(0).max(60_000).default(2000),
  /** >0 activa parrilla automática dentro del proceso API (no usar junto con schedule-worker). */
  INTERNAL_SCHEDULE_POLL_MS: z.coerce.number().int().min(0).default(0),
  /**
   * C3: quién aplica `ScheduleBlock` → cola.
   * - `auto`: internal si INTERNAL_SCHEDULE_POLL_MS>0; si SCHEDULE_WORKER_EXPECTED=1 → worker.
   * - `internal`: tick en API (poll > 0).
   * - `worker`: poll interno forzado a 0 (usa @radioflow/schedule-worker).
   * - `off`: sin aplicador automático.
   */
  SCHEDULE_APPLY_MODE: z.enum(["auto", "internal", "worker", "off"]).default("auto"),
  /**
   * C3: declara que corre schedule-worker externo.
   * Con INTERNAL_SCHEDULE_POLL_MS>0 fuerza apagar el tick interno (evita doble apply).
   */
  SCHEDULE_WORKER_EXPECTED: z
    .string()
    .optional()
    .transform((v) => v === "1" || v?.toLowerCase() === "true"),
  /** Igual que en schedule-worker: `0` = append; por defecto reemplaza cola al cambiar bloque. */
  SCHEDULE_REPLACE_QUEUE: z
    .string()
    .optional()
    .transform((v) => v !== "0"),
  /** Conexión Redis (opcional). Sin URL, rate-limit de login registro usa memoria en el proceso. */
  REDIS_URL: z
    .string()
    .optional()
    .transform((s) => (s && s.length ? s : undefined)),
  /** Máx. intentos de login/register por ventana (por IP). */
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().min(1).default(30),
  /** Ventana en segundos para rate-limit auth. */
  RATE_LIMIT_AUTH_WINDOW_SEC: z.coerce.number().int().min(1).default(300),
  /** Máx. pedidos de canción (POST /requests) por IP y ventana. */
  SONG_REQUEST_MAX_PER_WINDOW: z.coerce.number().int().min(1).max(100).default(5),
  /** Ventana en segundos para rate-limit de pedidos públicos. */
  SONG_REQUEST_WINDOW_SEC: z.coerce.number().int().min(60).max(86_400).default(900),
  /** Sin heartbeat del encoder en este intervalo (ms), `stale: true` en GET /streaming/broadcast-status. */
  ENCODER_HEARTBEAT_STALE_MS: z.coerce.number().int().min(5000).max(600_000).default(45_000),
  /** Máx. encolados por usuario y ventana para kinds “pesados” (loudness, trim, transcode). */
  LIBRARY_PROCESS_ENQUEUE_MAX_PER_MIN: z.coerce.number().int().min(1).max(5000).default(30),
  /** Máx. encolados por usuario y ventana solo para `bpm_detect` (barato, sin ffmpeg). */
  LIBRARY_PROCESS_ENQUEUE_LIGHT_KIND_MAX_PER_MIN: z.coerce.number().int().min(1).max(20_000).default(80),
  /** Máx. encolados por IP (todos los kinds) por ventana; suma a la cuota por usuario. */
  LIBRARY_PROCESS_ENQUEUE_IP_MAX_PER_MIN: z.coerce.number().int().min(1).max(20_000).default(120),
  /** Ventana en segundos para el tope de encolado de process-jobs. */
  LIBRARY_PROCESS_ENQUEUE_WINDOW_SEC: z.coerce.number().int().min(5).max(3600).default(60),
  /** Timeout por archivo en jobs ffmpeg (trim / transcode), salvo policy.timeoutMsPerAsset. */
  LIBRARY_PROCESS_FFMPEG_TIMEOUT_MS: z.coerce.number().int().min(10_000).max(3_600_000).default(180_000),
  /** Días que se conservan jobs terminados (`completed` / `failed` / `cancelled`). 0 = no borrar por edad. */
  LIBRARY_PROCESS_JOB_RETENTION_DAYS: z.coerce.number().int().min(0).max(365).default(30),
  /** Intervalo (min) para borrar jobs viejos; 0 desactiva el timer en la API. */
  LIBRARY_PROCESS_JOB_CLEANUP_INTERVAL_MIN: z.coerce.number().int().min(0).default(1440),
  /** Máx. filas borradas por corrida de limpieza de jobs de biblioteca. */
  LIBRARY_PROCESS_JOB_CLEANUP_MAX_DELETE: z.coerce.number().int().min(1).max(10_000).default(500),
  /** Intervalo (ms) del procesador de cola de biblioteca dentro de la API (modos maintenance/full). */
  LIBRARY_PROCESS_WORKER_POLL_MS: z.coerce.number().int().min(500).max(60_000).default(2500),
  /**
   * Backfill automático de Cue Start/End para pistas ya importadas (sin cues).
   * 0 desactiva; por defecto activo cada 8 s (lotes pequeños, apto para 10k+ pistas).
   */
  CUE_DETECT_BACKFILL_POLL_MS: z.coerce.number().int().min(0).max(600_000).default(6000),
  /** Pistas por lote del backfill de cues (1–25). */
  CUE_DETECT_BACKFILL_BATCH_SIZE: z.coerce.number().int().min(1).max(25).default(5),
  /** Si false, no corre el backfill periódico (las nuevas importaciones sí detectan cues). */
  CUE_DETECT_BACKFILL_ENABLED: z.coerce.boolean().default(true),
  /** Limpieza de refresh tokens en segundo plano (min). 0 desactiva. */
  REFRESH_TOKEN_CLEANUP_INTERVAL_MIN: z.coerce.number().int().min(0).default(30),
  /** Retención (días) para tokens revocados antes de borrar. */
  REFRESH_TOKEN_REVOKED_RETENTION_DAYS: z.coerce.number().int().min(0).default(14),
  /** Retención (días) para tokens expirados antes de borrar. */
  REFRESH_TOKEN_EXPIRED_RETENTION_DAYS: z.coerce.number().int().min(0).default(3),
  /** Máx. filas a borrar por corrida de limpieza. */
  REFRESH_TOKEN_CLEANUP_MAX_DELETE: z.coerce.number().int().min(1).max(10_000).default(2000),
  /** >0 activa el scheduler de eventos dentro de la API (ms). */
  SCHEDULER_EVENTS_POLL_MS: z.coerce.number().int().min(0).default(2000),
  /** Si 1, el scheduler ejecuta eventos en boot inmediatamente. */
  SCHEDULER_EVENTS_RUN_ON_BOOT: z.coerce.boolean().default(true),
  /** >0 activa el planificador automático de publicidad (ms). 0 = solo manual/eventos. */
  ADS_SCHEDULER_POLL_MS: z.coerce.number().int().min(0).default(30_000),
  /**
   * Si true, al arrancar la API crea un admin si no existe `BOOTSTRAP_ADMIN_EMAIL`.
   * Pensado para instalación en una PC (app de escritorio + API local). Desactivar en producción expuesta a Internet.
   */
  BOOTSTRAP_LOCAL_ADMIN: z.coerce.boolean().default(false),
  BOOTSTRAP_ADMIN_EMAIL: z
    .string()
    .optional()
    .transform((s) => (s && s.trim() ? s.trim() : undefined)),
  BOOTSTRAP_ADMIN_PASSWORD: z
    .string()
    .optional()
    .transform((s) => (s && s.length ? s : undefined)),
  /**
   * App instalada en un solo PC (Electron + SQLite): un operador local, acceso total sin jerarquía admin.
   * Desactiva bootstrap automático; el usuario se crea en el asistente de bienvenida.
   */
  EMBEDDED_STANDALONE: z.coerce.boolean().default(false),
  /** Si false, no se registran `/api/docs` ni el esquema OpenAPI. */
  OPENAPI_ENABLED: z.coerce.boolean().default(true),
  /**
   * URL base pública de la API para "Try it out" en Swagger (sin barra final).
   * Ej.: https://studio.tudominio.com si Nginx sirve panel y `/api` en el mismo host.
   * Por defecto: `http://127.0.0.1:<PORT>`.
   */
  OPENAPI_SERVER_URL: z
    .string()
    .optional()
    .transform((s) => {
      const v = (s ?? "").trim().replace(/\/$/, "");
      return v || undefined;
    }),
  /**
   * Origen público para URLs absolutas (carátulas, Now Playing). Sin barra final.
   * Si vacío: `OPENAPI_SERVER_URL` o cabeceras del request / `http://127.0.0.1:<PORT>`.
   */
  PUBLIC_API_BASE_URL: z
    .string()
    .optional()
    .transform((s) => {
      const v = (s ?? "").trim().replace(/\/$/, "");
      return v || undefined;
    }),
  /** Export sidecar nowplaying.json + current-cover.jpg al cambiar pista (E1.3). */
  NOW_PLAYING_EXPORT_ENABLED: z.coerce.boolean().default(true),
  /** Carpeta de export (absoluta o relativa al cwd). Vacío → `{MEDIA_ROOT}/nowplaying`. */
  NOW_PLAYING_EXPORT_DIR: z
    .string()
    .optional()
    .transform((s) => {
      const v = (s ?? "").trim();
      return v || undefined;
    }),
  /**
   * Motor de playout sin UI (24/7): avanza la cola en modo AUTO cuando no hay heartbeat del cliente (ms).
   * 0 = desactivado. Recomendado ≥1000 con encoder + API_BACKGROUND_MODE full/automation.
   */
  HEADLESS_PLAYOUT_POLL_MS: z.coerce.number().int().min(0).default(1000),
  /** Sin heartbeat del cliente en este intervalo (ms), el servidor asume control del avance. */
  HEADLESS_PLAYOUT_CLIENT_STALE_MS: z.coerce.number().int().min(2000).max(120_000).default(12_000),
  /** Muestreo periódico de oyentes Icecast (RB-133). 0 = desactivado. */
  LISTENER_SAMPLE_POLL_MS: z.coerce.number().int().min(0).default(300_000),
  /** Días de retención del historial de oyentes. 0 = sin limpieza automática. */
  LISTENER_SAMPLE_RETENTION_DAYS: z.coerce.number().int().min(0).max(365).default(30),
  /**
   * A7: alerta si la fuente Icecast está caída mientras broadcastEnabled.
   * Intervalo del tick (ms). 0 = desactivado.
   */
  ICECAST_SOURCE_ALERT_POLL_MS: z.coerce.number().int().min(0).default(60_000),
  /** A7: umbral de caída continua antes de alertar (ms). Default 3 min. */
  ICECAST_SOURCE_ALERT_AFTER_MS: z.coerce.number().int().min(15_000).max(3_600_000).default(180_000),
  /** A7: no re-alertar el mismo incidente antes de este cooldown (ms). Default 15 min. */
  ICECAST_SOURCE_ALERT_COOLDOWN_MS: z.coerce.number().int().min(60_000).max(86_400_000).default(900_000),
  /** A7: webhook opcional (POST JSON) al alertar / recuperar. */
  ICECAST_SOURCE_ALERT_WEBHOOK_URL: z
    .string()
    .optional()
    .transform((s) => (s != null && String(s).trim() ? String(s).trim() : undefined)),
  /** Regenera M3U para Liquidsoap (legacy). 0 = desactivado (default A2: path = encoder→Icecast). */
  LIQUIDSOAP_M3U_POLL_MS: z.coerce.number().int().min(0).default(0),
  /**
   * Motor TTS: auto (SAPI en Windows, espeak en Unix), sapi, espeak, edge-tts, piper.
   */
  TTS_ENGINE: z.enum(["auto", "sapi", "espeak", "edge-tts", "piper"]).default("auto"),
  /** Voz edge-tts (ej. es-ES-ElviraNeural, en-US-JennyNeural). */
  TTS_EDGE_VOICE: z.string().default("es-ES-ElviraNeural"),
  /** Ejecutable Piper (por defecto `piper` en PATH). */
  TTS_PIPER_PATH: z
    .string()
    .optional()
    .transform((s) => (s != null && String(s).trim() ? String(s).trim() : "piper")),
  /** Ruta al modelo Piper `.onnx` (requerido si TTS_ENGINE=piper). */
  TTS_PIPER_MODEL: z
    .string()
    .optional()
    .transform((s) => (s != null && String(s).trim() ? String(s).trim() : undefined)),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Variables de entorno inválidas:", parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  if (parsed.data.NODE_ENV === "production" && parsed.data.JWT_SECRET.length < 32) {
    console.error("JWT_SECRET debe tener al menos 32 caracteres en NODE_ENV=production");
    process.exit(1);
  }
  const env = parsed.data;
  // Desktop embebido: la cabina/UI gobierna el avance. Headless solo para API sin UI.
  if (env.EMBEDDED_STANDALONE && process.env.HEADLESS_PLAYOUT_POLL_MS === undefined) {
    return { ...env, HEADLESS_PLAYOUT_POLL_MS: 0 };
  }
  return env;
}
