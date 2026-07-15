export type UserRole = "admin" | "editor" | "dj" | "viewer" | "operador";

export {
  roleSatisfies,
  ROLES_STATION_WRITE,
  ROLES_SCHEDULE_WRITE,
  ROLES_PROGRAMACION_DELETE,
  ROLES_STREAMING_WRITE,
  ROLES_LIBRARY_WRITE,
  ROLES_REPORTS_READ,
  canWriteLibrary,
  canEditPlaylists,
  canEditSchedule,
  canReadReports,
  isAdminRole,
} from "./roles.js";

export type { ApiAuthSetupStatus } from "./auth-setup.js";
export { canWriteLibraryRole, canEditPlaylistsRole, canReadReportsRole } from "./auth-setup.js";

import type { ApiVoiceTrackOverlaySpec } from "./voice-track-bridge.js";
export {
  DEFAULT_SONG_INTRO_SEC,
  DEFAULT_SONG_OUTRO_SEC,
  DEFAULT_VOICE_TRACK_DUCK_DB,
  VOICE_TRACK_DUCK_DB_MAX,
  VOICE_TRACK_DUCK_DB_MIN,
  buildVoiceTrackOverlaySpec,
  estimateIntroWindowSec,
  estimateOutroWindowSec,
  planVoiceTrackBridge,
  voiceTrackOverlayTriggerAt,
  type ApiVoiceTrackOverlaySpec,
  type ClientTrackCuesLike,
  type VoiceTrackBridgeAsset,
  type VoiceTrackBridgeQueueItem,
} from "./voice-track-bridge.js";

export interface ApiHealth {
  status: "ok" | "degraded";
  version: string;
  uptimeSeconds: number;
}

/** Listo para recibir tráfico (p. ej. orquestadores / balanceadores). Incluye comprobación de BD. */
export interface ApiReadiness {
  ready: boolean;
  database: "ok" | "down";
  /**
   * Sin `REDIS_URL`: `disabled`. Si hay URL: resultado de `PING` en este momento.
   * No cambia `ready`: la API puede seguir en modo degradado (rate-limit en memoria).
   */
  redis: "disabled" | "ok" | "down";
  /**
   * `true` si `REDIS_URL` está definido pero Redis no responde al PING (rate-limit solo en memoria).
   * `ready` puede seguir siendo `true` si la base de datos está bien.
   */
  degraded: boolean;
  version: string;
}

/** Metadatos operativos (sin secretos) para panel / operaciones. */
export interface ApiHealthMeta {
  internalSchedulePollMs: number;
  internalSchedulerActive: boolean;
  scheduleReplaceQueue: boolean;
  redis: "disabled" | "connected" | "down";
  rateLimitAuth: { max: number; windowSec: number; memoryBuckets: number };
  /** Destino de streaming activo en Marca (solo ids/flags; sin contraseñas). */
  streamingEncoder?: {
    activeStreamingTargetId: string | null;
    activeTargetEnabled: boolean;
  };
  /** B2: tareas de biblioteca / background (sin secretos). */
  background?: {
    mode: "http-only" | "maintenance" | "automation" | "full";
    libraryProcessWorker: boolean;
    libraryProcessWorkerPollMs: number;
    cueDetectBackfill: boolean;
    audioFfmpeg: boolean;
    audioFfprobe: boolean;
    embeddedStandalone: boolean;
  };
  /** C3: un solo aplicador ScheduleBlock → cola. */
  schedule?: {
    applyMode: "internal" | "worker" | "manual" | "off";
    configuredApplyMode: "auto" | "internal" | "worker" | "off";
    internalPollMsEffective: number;
    internalPollMsConfigured: number;
    workerExpected: boolean;
    conflictResolved: boolean;
    liquidsoapM3uPollMs: number;
  };
}

export interface MediaAssetStub {
  id: string;
  title: string;
  durationSec?: number;
  path?: string;
}

export interface ApiOpsRateLimit {
  local: {
    backend: {
      redis: { allowed: number; blocked: number };
      memory: { allowed: number; blocked: number };
    };
    scopes: {
      login: { allowed: number; blocked: number };
      register: { allowed: number; blocked: number };
    };
    memoryBuckets: number;
  };
  global: null | {
    windowMinutes: number;
    totals: {
      login: {
        redis: { allowed: number; blocked: number };
        memory: { allowed: number; blocked: number };
      };
      register: {
        redis: { allowed: number; blocked: number };
        memory: { allowed: number; blocked: number };
      };
    };
  };
  combined: null | {
    windowMinutes: number;
    totals: {
      login: { allowed: number; blocked: number };
      register: { allowed: number; blocked: number };
      all: { allowed: number; blocked: number };
    };
  };
  requestedWindowMinutes: number | null;
  refreshReuseDetections: {
    local: number;
    global: null | { windowMinutes: number; total: number };
  };
  opsRevocations: {
    local: number;
    global: null | { windowMinutes: number; total: number };
  };
}

export interface ApiOpsAuthRefreshChains {
  windowMinutes: number | null;
  agg: {
    sampleSize: number;
    totalTokens: number;
    activeTokens: number;
    roots: number;
    maxDepth: number;
    avgDepth: number;
  };
}

export interface ApiOpsAuthRevokeRefreshChain {
  ok: true;
  rootId: string;
  revoked: number;
}

export interface ApiOpsAuthRefreshTokenSession {
  id: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  replacesId: string | null;
  replacedById: string | null;
}

export interface ApiOpsAuthUserSessions {
  user: {
    id: string;
    email: string;
    displayName: string | null;
    role: UserRole;
  };
  sessions: ApiOpsAuthRefreshTokenSession[];
}

export interface ApiOpsAuthRevokeRefreshToken {
  ok: true;
  refreshTokenId: string;
  revokedAt: string;
}

export interface ApiOpsAuthCleanupRefreshTokens {
  ok: true;
  deleted: number;
}

export interface ApiOpsMetrics {
  uptimeSeconds: number;
  counters: Record<string, number>;
  routes: Array<{
    key: string;
    requests: number;
    status: { "2xx": number; "3xx": number; "4xx": number; "5xx": number };
    latencyMs: { count: number; avg: number; min: number; p50: number; p95: number; max: number };
  }>;
}

// Scheduler (Entregable A)
export type SchedulerActionType =
  | "PLAY_PLAYLIST"
  | "PLAY_ASSET"
  | "RUN_COMMAND"
  | "GENERATE_AND_PLAY_PLAYLIST"
  | "PLAY_AD_BREAK"
  | "TIME_ANNOUNCE";
export type SchedulerCommand =
  | "STATION_SKIP"
  | "QUEUE_FROM_PLAYLIST_REPLACE"
  | "QUEUE_FROM_PLAYLIST_APPEND"
  | "STREAM_RECORD_START"
  | "STREAM_RECORD_STOP";

export interface ApiSchedulerEvent {
  id: string;
  name: string;
  enabled: boolean;
  actionType: SchedulerActionType;
  runAt: string | null; // ISO
  /** Próxima ejecución calculada por el sistema (ISO). */
  nextRunAt: string | null;
  /** 0 = una sola vez; >0 = repetir cada N minutos. */
  repeatIntervalMin: number;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ApiSchedulerEventCreateBody {
  name: string;
  enabled?: boolean;
  actionType: SchedulerActionType;
  runAt?: string | null;
  /** 0 = una sola vez; >0 = repetir cada N minutos. */
  repeatIntervalMin?: number;
  payload: Record<string, unknown>;
}

export type ApiSchedulerEventPatchBody = Partial<ApiSchedulerEventCreateBody>;

export interface ApiSchedulerRun {
  id: string;
  eventId: string;
  status: "success" | "error";
  startedAt: string;
  finishedAt: string;
  error: string | null;
}

export interface ApiSchedulerRunNow {
  ok: true;
  run: ApiSchedulerRun;
}

/** Ejecución del programador con nombre del evento (panel lateral / historial). */
export interface ApiSchedulerRunEntry extends ApiSchedulerRun {
  eventName: string;
}

export type SongRequestStatus = "pending" | "approved" | "rejected" | "played";

export interface ApiSongRequest {
  id: string;
  listenerName: string | null;
  listenerContact: string | null;
  title: string;
  artist: string | null;
  message: string | null;
  status: SongRequestStatus;
  assetId: string | null;
  asset: { id: string; title: string; artist: string | null } | null;
  reviewedAt: string | null;
  enqueuedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApiSongRequestCreateBody {
  listenerName?: string;
  listenerContact?: string;
  title: string;
  artist?: string;
  message?: string;
}

export interface ApiSongRequestPatchBody {
  status?: SongRequestStatus;
  assetId?: string | null;
}

export interface ApiSongRequestPendingCount {
  pending: number;
}

export interface ApiAuthUser {
  id: string;
  email: string;
  displayName: string | null;
  role: UserRole;
}

export interface ApiAuthSession {
  /** JWT de acceso (nombre canónico en RadioFlow). */
  token: string;
  /** Mismo valor que `token` — clientes Express/CRA suelen usar `accessToken`. */
  accessToken: string;
  refreshToken: string;
  user: ApiAuthUser;
  /** Alias CRA: mismo valor que `user.id` (clientes que leen `data.id`). */
  id: string;
  /** Alias CRA: mismo valor que `user.role` (clientes que leen `data.rol`). */
  rol: UserRole;
}

export type ApiAuthLoginResponse = ApiAuthSession;
export type ApiAuthRegisterResponse = ApiAuthSession;
export type ApiAuthRefreshResponse = ApiAuthSession;

export interface ApiAuthRegisterBody {
  email: string;
  password: string;
  displayName?: string;
  stationName?: string;
}

export interface ApiAuthLoginBody {
  email: string;
  password: string;
}

export interface ApiAuthRefreshBody {
  refreshToken: string;
}

export interface ApiAuthLogoutBody {
  refreshToken: string;
}

export interface ApiAuthOk {
  ok: true;
}

export interface ApiError {
  error: string;
  code?: string;
  status?: number;
  details?: unknown;
}

// Station
export type StationMode = "AUTO" | "LIVE_ASSIST" | "LIVE";

export interface ApiStationAsset {
  id: string;
  title: string;
  artist: string | null;
  path: string;
  coverPath?: string | null;
  /** Ajuste fino de nivel en cabina (dB), sumado a la ganancia global de estación. */
  playbackGainDb?: number;
  album?: string | null;
  genre?: string | null;
  mimeType?: string | null;
  durationSec?: number | null;
  /** Año de publicación desde etiquetas embebidas. */
  releaseYear?: number | null;
  /** Comentario desde etiquetas (p. ej. ID3 COMM). */
  id3Comment?: string | null;
  audioBitrateKbps?: number | null;
  audioSampleRateHz?: number | null;
  audioChannels?: number | null;
  /** Cue Start (s): omite silencio de cabeza. */
  cueStartSec?: number | null;
  /** Cue End (s): omite silencio de cola; el crossfade arranca overlap antes. */
  cueEndSec?: number | null;
}

/**
 * Contrato de segmento al aire (Cabina + encoder).
 * Misma ventana/ganancia/solape para que monitor ≈ oyente (Fase A1).
 */
export interface ApiPlaySegmentSpec {
  assetId: string;
  path: string;
  /** Inicio efectivo de reproducción (s). */
  cueStartSec: number;
  /**
   * Fin efectivo (s absolutos en el archivo).
   * null = hasta el final del archivo (o durationSec si está).
   */
  cueEndSec: number | null;
  durationSec: number | null;
  playbackGainDb: number;
  cabCrossfadeSec: number;
  cabReferenceGainDb: number;
}

/**
 * Solape de fundido estándar (misma regla Cabina/encoder).
 * Acotado al 45 % de la pista útil; mínimo 0.35 s.
 */
export function playSegmentCrossfadeOverlapSec(
  cueStartSec: number,
  cueEndSec: number | null,
  durationSec: number | null,
  configuredSec: number,
): number {
  const start = Math.max(0, cueStartSec);
  const end =
    cueEndSec != null && Number.isFinite(cueEndSec) && cueEndSec > start + 0.2
      ? cueEndSec
      : durationSec != null && durationSec > start + 0.2
        ? durationSec
        : start + 30;
  const usable = Math.max(0.2, end - start);
  return Math.min(Math.max(0.35, configuredSec), Math.max(0.35, usable * 0.45));
}

/** Construye el spec de segmento a partir del asset al aire + gains de estación. */
export function buildPlaySegmentSpec(
  asset: Pick<
    ApiStationAsset,
    "id" | "path" | "cueStartSec" | "cueEndSec" | "durationSec" | "playbackGainDb"
  >,
  station: { cabCrossfadeSec?: number | null; cabReferenceGainDb?: number | null },
): ApiPlaySegmentSpec {
  const cueStartSec =
    asset.cueStartSec != null && Number.isFinite(asset.cueStartSec) && asset.cueStartSec > 0
      ? Math.max(0, asset.cueStartSec)
      : 0;
  let cueEndSec: number | null =
    asset.cueEndSec != null && Number.isFinite(asset.cueEndSec) && asset.cueEndSec > cueStartSec + 0.2
      ? asset.cueEndSec
      : null;
  if (cueEndSec == null && asset.durationSec != null && asset.durationSec > cueStartSec + 0.2) {
    cueEndSec = asset.durationSec;
  }
  if (cueEndSec != null && asset.durationSec != null && asset.durationSec > 0) {
    cueEndSec = Math.min(cueEndSec, asset.durationSec);
  }
  return {
    assetId: asset.id,
    path: asset.path,
    cueStartSec: Math.round(cueStartSec * 1000) / 1000,
    cueEndSec: cueEndSec != null ? Math.round(cueEndSec * 1000) / 1000 : null,
    durationSec: asset.durationSec ?? null,
    playbackGainDb: asset.playbackGainDb ?? 0,
    cabCrossfadeSec: station.cabCrossfadeSec ?? 4,
    cabReferenceGainDb: station.cabReferenceGainDb ?? 0,
  };
}

export type QueueEntryKind =
  | "track"
  | "pause"
  | "marker"
  | "note"
  | "voicetrack"
  | "track_list"
  | "hour_marker"
  | "dtmf"
  | "time_announce"
  | "station_intro"
  | "jingle_auto"
  | "cmd"
  | "container";

/** Comando de lista estilo RadioBOSS (play/stop/next/clear/load). */
export type PlaylistCmdAction = "play" | "stop" | "next" | "clear" | "load_playlist";

export interface ApiPlaylistCmdSpec {
  type: "cmd";
  action: PlaylistCmdAction;
  /** Requerido si action = load_playlist. */
  playlistId?: string;
  /** load_playlist: true = reemplazar cola; false = añadir. */
  replace?: boolean;
}

/** Contenedor: playlist anidada que se expande al sincronizar cola. */
export interface ApiPlaylistContainerSpec {
  type: "container";
  playlistId: string;
}

export interface ApiStationQueueItem {
  id: string;
  position: number;
  kind: QueueEntryKind;
  label: string | null;
  pauseSec: number | null;
  asset: ApiStationAsset | null;
}

/** Entrada de la cola de reproducción (RadioBOSS “playback queue”): orden de salida sin mover filas. */
export interface ApiPlaybackQueueEntry {
  id: string;
  playQueueItemId: string;
  sortIndex: number;
}

export interface ApiStation {
  id: string;
  mode: StationMode;
  currentPosition: number;
  liveTitle: string | null;
  autoScheduleEnabled?: boolean;
  lastAppliedScheduleBlockId?: string | null;
  /** Playlist volcada a cola (AutoDJ / última sync). */
  activePlaylistId?: string | null;
  /** Segundos de solapamiento en el reproductor de referencia (cabina). */
  cabCrossfadeSec?: number;
  /** Ganancia global del bus de referencia (dB). */
  cabReferenceGainDb?: number;
  /** Motor Web Audio (crossfade + nivelación); si false, un solo elemento audio. */
  cabWebAudioEngine?: boolean;
  /** Mapa dígito DTMF → acción (RB-118). */
  dtmfActions?: Record<string, ApiDtmfAction>;
}

export interface ApiStationState {
  station: ApiStation;
  queue: ApiStationQueueItem[];
  /** Orden de reproducción prioritaria; vacío = seguir la cola por posición. */
  playbackQueue: ApiPlaybackQueueEntry[];
  nowPlaying: (ApiStationAsset & { queueItemId?: string }) | null;
  /** Fila actual en cola (incluye pausa, marcador, etc.). */
  currentQueueEntry?: ApiStationQueueItem | null;
  /** Metadatos enriquecidos con URLs públicas (carátula, logo). */
  nowPlayingInfo?: ApiNowPlayingInfo | null;
  /** Contrato Cabina↔encoder para el segmento al aire (A1). */
  playSegment?: ApiPlaySegmentSpec | null;
  /**
   * C2: si la cola es track→voicetrack→track, overlay VT sobre el outro
   * para el encoder (mismo sonido en listen-through).
   */
  voiceTrackOverlay?: ApiVoiceTrackOverlaySpec | null;
}

/** Now Playing enriquecido para widgets, apps y streaming. */
export interface ApiNowPlayingInfo {
  assetId: string | null;
  title: string;
  artist: string | null;
  album: string | null;
  /** URL absoluta de carátula; si no hay, logo de estación. */
  coverUrl: string | null;
  stationLogoUrl: string | null;
  stationName: string;
  /** ISO8601 cuando empezó la pista al aire (aprox., servidor). */
  startedAt: string | null;
  /** Segmento de reproducción para encoder / cabina (A1). */
  playSegment?: ApiPlaySegmentSpec | null;
}

export interface ApiPublicNowPlaying {
  playing: boolean;
  now: ApiNowPlayingInfo | null;
  fetchedAt: string;
  /** URLs HTTP del export sidecar (E1.3). */
  sidecar?: {
    jsonUrl: string;
    coverUrl: string;
  };
  /** Presente en el archivo exportado en disco. */
  coverFile?: string | null;
  sidecarUpdatedAt?: string;
}

/** Información pública para el reproductor web / widgets embebidos. */
export interface ApiPublicListen {
  stationName: string;
  tagline: string | null;
  primaryColor: string | null;
  stationLogoUrl: string | null;
  listenUrl: string | null;
  streamTargetName: string | null;
  broadcastEnabled: boolean;
  nowPlayingUrl: string;
}

export interface ApiStationPatchBody {
  mode?: StationMode;
  currentPosition?: number;
  liveTitle?: string | null;
  autoScheduleEnabled?: boolean;
  cabCrossfadeSec?: number;
  cabReferenceGainDb?: number;
  cabWebAudioEngine?: boolean;
  dtmfActions?: Record<string, ApiDtmfAction>;
}

export interface ApiStationQueueAppendBody {
  assetId: string;
  /** Si es true, inserta el ítem en la cola justo después de la pista al aire (cabina / cart). */
  playNext?: boolean;
}

export interface ApiStationQueueAppendBulkBody {
  assetIds: string[];
  /** Si es true, inserta el bloque justo después de la pista al aire (orden conservado). */
  playNext?: boolean;
}

export interface ApiStationQueueFromPlaylistBody {
  playlistId: string;
  replace?: boolean;
  scheduleBlockId?: string;
}

// Settings
export interface ApiSettings {
  id: string;
  stationName: string;
  tagline: string | null;
  primaryColor: string | null;
  logoUrl: string | null;
  activeStreamingTargetId: string | null;
  /** Destinos adicionales simultáneos (RB-135). */
  extraStreamingTargetIds: string[];
  rdsText: string | null;
  rdsEnabled: boolean;
  songRequestArtistCooldownMin: number;
  songRequestTitleCooldownMin: number;
  /** AutoDJ: evita repetir artista en las últimas N canciones (0 = off). */
  autoDjNoRepeatArtistLastN: number;
  /** AutoDJ: evita repetir el mismo tema en las últimas N canciones (0 = off). */
  autoDjNoRepeatTrackLastN: number;
  /** AutoDJ: mantener mínimo de canciones futuras en cola (0 = off). */
  autoDjMinUpcomingTracks: number;
  /** Carpeta bajo uploads/ con intros por artista (RB-058). */
  autoIntroFolder: string;
  /** Etiquetas de los 5 campos personalizados de biblioteca. */
  libraryCustomFieldLabels: string[];
  /** Carpeta bajo uploads/ para grabaciones de stream. */
  streamRecordingFolder: string;
  /** Carpeta absoluta (PC) con voces hr_/m_ para locución horaria RadioBOSS. */
  timeAnnounceFolderAbs: string | null;
  /** 0 = manual; 15 / 30 / 60 = anuncio automático cada N minutos. */
  timeAnnounceIntervalMin: 0 | 15 | 30 | 60;
  /** 0 = off; 15 / 30 / 60 = jingle automático cada N minutos (reloj del PC). */
  jingleAutoIntervalMin: 0 | 15 | 30 | 60;
  /** 0 = off; >0 = jingle automático cada N canciones. */
  jingleAutoEveryTracks: number;
  /** Página del cart wall para jingles automáticos (A/B/C). */
  jingleAutoPageKey: "A" | "B" | "C";
  /** Teclas habilitadas para selección automática (ej. ["1","2","0"]). */
  jingleAutoSlotKeys: string[];
  /** Archivo o carpeta (disco) con intro de emisora / station ID. */
  stationIntroSourceAbs: string | null;
  /** 0 = manual; 15 / 30 / 60 = intro automática cada N minutos. */
  stationIntroIntervalMin: 0 | 15 | 30 | 60;
  /** Failover automático si el destino primario pierde fuente Icecast. */
  streamingFailoverEnabled: boolean;
  /** Primer respaldo (legacy); preferir cadena. */
  streamingFailoverBackupTargetId: string | null;
  /** Cadena ordenada de respaldos (hasta 5). */
  streamingFailoverBackupTargetIds: string[];
  streamingFailoverAutoRevert: boolean;
  /** Emisión a Internet (encoder) habilitada en configuración. */
  broadcastEnabled: boolean;
}

export interface ApiSettingsPatchBody {
  stationName?: string;
  tagline?: string | null;
  primaryColor?: string | null;
  logoUrl?: string | null;
  activeStreamingTargetId?: string | null;
  extraStreamingTargetIds?: string[];
  rdsText?: string | null;
  rdsEnabled?: boolean;
  songRequestArtistCooldownMin?: number;
  songRequestTitleCooldownMin?: number;
  autoDjNoRepeatArtistLastN?: number;
  autoDjNoRepeatTrackLastN?: number;
  autoDjMinUpcomingTracks?: number;
  autoIntroFolder?: string;
  libraryCustomFieldLabels?: string[];
  streamRecordingFolder?: string;
  timeAnnounceFolderAbs?: string | null;
  timeAnnounceIntervalMin?: 0 | 15 | 30 | 60;
  jingleAutoIntervalMin?: 0 | 15 | 30 | 60;
  jingleAutoEveryTracks?: number;
  jingleAutoPageKey?: "A" | "B" | "C";
  jingleAutoSlotKeys?: string[];
  stationIntroSourceAbs?: string | null;
  stationIntroIntervalMin?: 0 | 15 | 30 | 60;
  streamingFailoverEnabled?: boolean;
  streamingFailoverBackupTargetId?: string | null;
  streamingFailoverBackupTargetIds?: string[];
  streamingFailoverAutoRevert?: boolean;
  broadcastEnabled?: boolean;
}

/** GET/POST locución horaria (RadioBOSS time announcement). */
export interface ApiTimeAnnounceFolderSummary {
  folderAbs: string;
  hourFiles: number;
  hourExactFiles: number;
  minuteFiles: number;
  totalAudio: number;
}

export interface ApiTimeAnnouncePlayResult {
  ok: boolean;
  hour: number;
  minute: number;
  inserted: number;
  assetIds: string[];
  fileNames: string[];
  missing: string[];
  error?: string;
}

// Streaming
export type StreamProtocol = "icecast" | "shoutcast" | "azuracast";

export interface ApiStreamingTarget {
  id: string;
  name: string;
  protocol: StreamProtocol;
  host: string;
  port: number;
  mountPath: string;
  sourceUser: string | null;
  publicBaseUrl: string | null;
  tls: boolean;
  enabled: boolean;
  hasSourcePassword: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ApiStreamingTargetCreateBody {
  name: string;
  protocol: StreamProtocol;
  host: string;
  port?: number;
  mountPath?: string;
  sourceUser?: string | null;
  sourcePassword: string;
  publicBaseUrl?: string | null;
  tls?: boolean;
  enabled?: boolean;
}

export type ApiStreamingTargetPatchBody = Partial<Omit<ApiStreamingTargetCreateBody, "sourcePassword">> & {
  sourcePassword?: string;
};

export interface ApiStreamingEncoderUrl {
  url: string;
  targetId: string;
  name: string;
  protocol: StreamProtocol;
}

/** GET /streaming/encoder-urls — primario + secundarios (RB-135). */
export interface ApiStreamingEncoderUrls {
  primary: ApiStreamingEncoderUrl | null;
  extras: ApiStreamingEncoderUrl[];
}

export type ApiDtmfAction =
  | { type: "skip" }
  | { type: "cart"; slotKey: string; pageKey?: string }
  | { type: "mode"; mode: StationMode };

/** POST /station/dtmf */
export interface ApiStationDtmfBody {
  digit: string;
}

export interface ApiJingleSlotEntry {
  assetId: string;
  label: string;
  asset: { id: string; title: string; artist: string | null };
}

export type ApiJingleSlotsMap = Record<string, ApiJingleSlotEntry | null>;

/** POST /jingles/fire — disparar ranura del cart wall a la cola. */
export interface ApiJingleFireBody {
  slotKey: string;
  pageKey?: "A" | "B" | "C";
  /** Encolar justo después de lo al aire (sin cortar). Default API si no hay playNow. */
  playNext?: boolean;
  /** C5: al aire ya (insert playNext + skip si hay pista sonando). */
  playNow?: boolean;
}

/** Respuesta OK de POST /jingles/fire */
export interface ApiJingleFireResult {
  ok: true;
  assetId: string;
  label: string;
  playNow: boolean;
}

export interface ApiBroadcastConfigPatchBody {
  broadcastEnabled?: boolean;
  activeStreamingTargetId?: string | null;
  extraStreamingTargetIds?: string[];
  rdsEnabled?: boolean;
  rdsText?: string | null;
}

export interface ApiEncoderHeartbeatStatus {
  at: string;
  stale: boolean;
  ffmpegActive: boolean;
  wsConnected: boolean;
  title: string | null;
  artist: string | null;
  album: string | null;
  assetId: string | null;
  coverUrl: string | null;
  stationLogoUrl: string | null;
  lastFfmpegExitCode: number | null;
}

export interface ApiIcecastLiveStatus {
  listenUrl: string | null;
  listeners: number | null;
  streamTitle: string | null;
  sourceConnected: boolean | null;
  error: string | null;
}

export interface ApiBroadcastStatus {
  nowPlaying: ApiNowPlayingInfo | null;
  encoder: ApiEncoderHeartbeatStatus | null;
  icecast: ApiIcecastLiveStatus;
  activeTarget: { id: string; name: string; protocol: StreamProtocol } | null;
  streamRecording: ApiStreamRecordingStatus;
  /** A7: alerta de fuente Icecast caída > N min (solo relevante con broadcastEnabled). */
  sourceAlert?: ApiIcecastSourceAlertStatus | null;
  /**
   * C1: path de aire productizado (encoder → Icecast).
   * Cabina en emisión debe preferir listen-through de `publicListenUrl`.
   */
  airPath: "encoder";
  broadcastEnabled: boolean;
  /** URL estable del mount para oyentes y Cabina (alias de icecast.listenUrl / destino activo). */
  publicListenUrl: string | null;
}

/**
 * C1: ¿Cabina debe oír el mount público en vez del motor Web Audio local?
 * Requiere Emitir ON, encoder vivo (ffmpeg) y URL de escucha.
 */
export function isListenThroughEligible(input: {
  broadcastEnabled: boolean;
  publicListenUrl: string | null | undefined;
  encoder: Pick<ApiEncoderHeartbeatStatus, "stale" | "ffmpegActive"> | null | undefined;
  /** Preferencia de operador: monitor local (Web Audio). */
  preferLocalMonitor?: boolean;
}): boolean {
  if (input.preferLocalMonitor) return false;
  if (!input.broadcastEnabled) return false;
  if (!input.publicListenUrl?.trim()) return false;
  const enc = input.encoder;
  if (!enc || enc.stale || !enc.ffmpegActive) return false;
  return true;
}

/** Con listen-through activo, el clock de avance es el encoder (EOF); Cabina no pide skip por XF. */
export function cabinaMayAutoSkip(listenThroughActive: boolean): boolean {
  return !listenThroughActive;
}

export interface ApiIcecastSourceAlertStatus {
  monitoring: boolean;
  active: boolean;
  downSince: string | null;
  downForMs: number;
  thresholdMs: number;
  lastAlertAt: string | null;
  lastRecoveredAt: string | null;
  reason: string | null;
  targetId: string | null;
  targetName: string | null;
}

export interface ApiStreamingFailoverStatus {
  enabled: boolean;
  onBackup: boolean;
  primaryTargetId: string | null;
  backupTargetId: string | null;
  backupChain: string[];
  activeBackupIndex: number;
  activeTargetId: string | null;
  primaryFailStreak: number;
  backupFailStreak: number;
  lastSwitchAt: string | null;
}

export interface ApiStreamRecordingStatus {
  active: boolean;
  startedAt: string | null;
  relPath: string | null;
  listenUrl: string | null;
  targetName: string | null;
  error: string | null;
}

export interface ApiStreamRecordingStopResult {
  status: ApiStreamRecordingStatus;
  relPath: string | null;
  durationSec: number | null;
  addedToLibrary: boolean;
  assetId: string | null;
}

export interface ApiEncoderHeartbeatBody {
  ffmpegActive: boolean;
  wsConnected: boolean;
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  assetId?: string | null;
  coverUrl?: string | null;
  stationLogoUrl?: string | null;
  lastFfmpegExitCode?: number | null;
}

// Library
export interface ApiLibraryAsset {
  id: string;
  title: string;
  artist: string | null;
  album?: string | null;
  genre?: string | null;
  path: string;
  /** Ruta relativa a MEDIA_ROOT; la imagen se sirve en GET /library/assets/:id/cover */
  coverPath?: string | null;
  durationSec: number | null;
  mimeType?: string | null;
  embeddingRef?: string | null;
  semanticNote?: string | null;
  /** Nivel en cabina / motor Web Audio (dB). */
  playbackGainDb?: number;
  releaseYear?: number | null;
  id3Comment?: string | null;
  audioBitrateKbps?: number | null;
  audioSampleRateHz?: number | null;
  audioChannels?: number | null;
  /** Cue Start (s): omite silencio de cabeza. */
  cueStartSec?: number | null;
  /** Cue End (s): omite silencio de cola. */
  cueEndSec?: number | null;
  customField1?: string | null;
  customField2?: string | null;
  customField3?: string | null;
  customField4?: string | null;
  customField5?: string | null;
}

/** Body de PATCH /library/assets/:id */
export interface ApiLibraryAssetPatchBody {
  title?: string;
  artist?: string | null;
  album?: string | null;
  genre?: string | null;
  semanticNote?: string | null;
  playbackGainDb?: number;
  /** Año de publicación (ID3 Year / TDRC). */
  releaseYear?: number | null;
  /** Comentario ID3 embebido. */
  id3Comment?: string | null;
  customField1?: string | null;
  customField2?: string | null;
  customField3?: string | null;
  customField4?: string | null;
  customField5?: string | null;
}

export interface ApiSemanticStatus {
  ollamaConfigured: boolean;
  chatModel: string;
  embeddingModel: string;
  pgvectorEnabled: boolean;
  pgvectorBackfillPending: number;
  assetsTotal: number;
  assetsWithSemanticNote: number;
  assetsWithEmbedding: number;
}

export interface ApiSemanticSearchHit extends ApiLibraryAsset {
  semanticScore?: number | null;
}

export interface ApiSemanticEnrichBatchResult {
  ok: number;
  failed: number;
  results: { assetId: string; ok: boolean; error?: string }[];
}

export interface ApiLibraryCreateAssetBody {
  title: string;
  artist?: string;
  path: string;
  durationSec?: number;
  mimeType?: string;
}

export interface ApiLibraryListQuery {
  q?: string;
  genre?: string;
  /** Artista exacto; `__none__` = sin artista en metadatos. */
  artist?: string;
  /** Filtro por texto en álbum (contiene, sin distinguir mayúsculas en servidor). */
  album?: string;
  /** Primer segmento de ruta relativa (p. ej. `uploads`, `covers`) — “carpeta” virtual. */
  pathPrefix?: string;
  sort?: "title" | "artist" | "createdAt" | "duration";
  order?: "asc" | "desc";
  /** Página: máximo por petición (default servidor 500; sin techo artificial de catálogo). */
  take?: number;
  /** Offset para paginar (combinar con take). */
  skip?: number;
}

/** GET /library/assets/count — total de pistas que coinciden con filtros. */
export interface ApiLibraryAssetsCount {
  total: number;
}

export interface ApiLibraryBrowseLabel {
  name: string;
  count: number;
}

export interface ApiLibraryBrowseResponse {
  pathFolders: ApiLibraryFolderRow[];
  genres: ApiLibraryBrowseLabel[];
  artists: ApiLibraryBrowseLabel[];
  albums: ApiLibraryBrowseLabel[];
}

export interface ApiLibraryStats {
  totalTracks: number;
  /** Suma de `durationSec` cuando está informado (pistas sin duración no suman). */
  totalDurationSec: number | null;
  /** Top de géneros con conteo. */
  topGenres: { genre: string; count: number }[];
}

export interface ApiLibraryFolderRow {
  /** Primer segmento de `path` (p. ej. carpeta bajo MEDIA_ROOT). */
  name: string;
  count: number;
}

export interface ApiLibraryFoldersResponse {
  folders: ApiLibraryFolderRow[];
}

export interface ApiLibraryCreateFolderBody {
  /** Nombre visible: Salsa, Jingles, Comerciales, etc. */
  name: string;
}

export interface ApiLibraryCreateFolderResponse {
  /** Prefijo para filtrar/subir, p. ej. `uploads/salsa`. */
  pathPrefix: string;
  displayName: string;
}

export interface ApiLibraryDeleteFolderBody {
  /** Prefijo bajo MEDIA_ROOT, p. ej. `uploads/vallenatos`. */
  pathPrefix: string;
}

export interface ApiLibraryDeleteFolderResult {
  deletedAssets: number;
  removedFiles: number;
}

export interface ApiLibraryBulkDeleteBody {
  ids: string[];
}

export interface ApiLibraryBulkDeleteResult {
  deleted: number;
  removedFiles?: number;
}

/** Resultado de POST /library/verify (estilo RadioBOSS “Verify”). */
export interface ApiLibraryVerifyResult {
  dryRun: boolean;
  inspected: number;
  orphanCount: number;
  removed: number;
  /** Muestra de huérfanos (máx. 80) para revisión. */
  samples: { id: string; path: string; title: string }[];
}

/** Una fila con problemas tras POST /library/check-tracks (solo lectura). Códigos de `issues` incluyen p. ej. `duration_mismatch`, `tag_title_mismatch`, `tag_artist_mismatch`, `tag_album_mismatch` (los dos últimos si el body activa `compareArtists` / `compareAlbums`). */
export interface ApiLibraryCheckTrackIssue {
  assetId: string;
  path: string;
  title: string;
  issues: string[];
  fileMeta?: {
    durationSec?: number | null;
    tagTitle?: string | null;
    tagArtist?: string | null;
    tagAlbum?: string | null;
  };
}

export interface ApiLibraryCheckTracksResult {
  inspected: number;
  withIssues: number;
  issues: ApiLibraryCheckTrackIssue[];
  truncated: boolean;
}

/** Resultado de POST /library/sync-duration-bulk */
export interface ApiLibrarySyncDurationBulkResult {
  updated: number;
  failures: { id: string; error: string }[];
}

/** Body de POST /library/sync-metadata-bulk — lee ID3 (y nombre de archivo) al catálogo. */
export interface ApiLibrarySyncMetadataBulkBody {
  assetIds: string[];
}

/** Resultado de POST /library/sync-metadata-bulk */
export interface ApiLibrarySyncMetadataBulkResult {
  updated: number;
  failures: { id: string; error: string }[];
}

/** GET /library/audio-tools — configuración + probe de ffprobe/ffmpeg. Query `?refresh=1` solo admin (ignora caché). */
export interface ApiLibraryAudioToolsStatus {
  ffprobeEnabled: boolean;
  /** Comando o ruta configurada para ffprobe (p. ej. `ffprobe` o ruta absoluta). */
  ffprobePath: string;
  /**
   * Si el respaldo ffprobe está desactivado en config: `null`.
   * Si está activo: resultado de ejecutar `ffprobe -version` (cacheado en la API ~1 min).
   */
  ffprobeReachable: boolean | null;
  /** Primera línea de `ffprobe -version` o mensaje de error corto (vacío si ffprobe desactivado). */
  ffprobeDetail: string | null;
  ffmpegEnabled: boolean;
  ffmpegPath: string;
  ffmpegReachable: boolean | null;
  ffmpegDetail: string | null;
}

/** POST /library/process-tracks/loudness — medición loudnorm (manual “Process tracks” / normalización, sin re-encode). */
export interface ApiLibraryProcessTracksLoudnessRow {
  assetId: string;
  title: string;
  path: string;
  previousPlaybackGainDb: number;
  measuredIntegratedLufs: number | null;
  suggestedGainDb: number | null;
  targetLufs: number;
  appliedPlaybackGainDb?: number | null;
  error?: string | null;
}

export interface ApiLibraryProcessTracksLoudnessResult {
  dryRun: boolean;
  targetLufs: number;
  rows: ApiLibraryProcessTracksLoudnessRow[];
  updated: number;
}

/** Resultado de job `bpm_detect` (tags TBPM + análisis de audio opcional). */
export interface ApiLibraryProcessTracksBpmDetectRow {
  assetId: string;
  title: string;
  path: string;
  bpmFromTags: number | null;
  bpmFromAudio?: number | null;
  /** Mejor valor disponible (tags o audio). */
  bpm?: number | null;
  note?: string | null;
  error?: string | null;
}

export interface ApiLibraryProcessTracksBpmDetectResult {
  kind: "bpm_detect";
  rows: ApiLibraryProcessTracksBpmDetectRow[];
}

export interface ApiLibraryProcessTrimSilenceSilenceSpan {
  startSec: number;
  endSec: number;
}

export interface ApiLibraryProcessTrimSilenceRow {
  assetId: string;
  title: string;
  path: string;
  apply: boolean;
  silences?: ApiLibraryProcessTrimSilenceSilenceSpan[];
  /** Si true, se reescribió el archivo (recorte destructivo). */
  trimmed?: boolean;
  /** Cues detectados / guardados (modo no destructivo o además del recorte). */
  cueStartSec?: number;
  cueEndSec?: number;
  cuesUpdated?: boolean;
  error?: string;
}

export interface ApiLibraryProcessTrimSilenceResult {
  kind: "trim_silence";
  apply: boolean;
  policy: { noiseDb: number; minSilenceSec: number; timeoutMsPerAsset?: number };
  rows: ApiLibraryProcessTrimSilenceRow[];
}

export interface ApiLibraryProcessTranscodeMp3Row {
  assetId: string;
  title: string;
  path: string;
  apply: boolean;
  newPath?: string;
  bitrateKbps?: number;
  error?: string;
}

export interface ApiLibraryProcessTranscodeMp3Result {
  kind: "transcode_mp3";
  apply: boolean;
  policy: { bitrateKbps: number; preserveMetadata: boolean; timeoutMsPerAsset?: number };
  rows: ApiLibraryProcessTranscodeMp3Row[];
}

export interface ApiLibraryProcessTimeStretchRow {
  assetId: string;
  title: string;
  path: string;
  apply: boolean;
  tempoRatio: number;
  estimatedDurationSec?: number;
  error?: string;
}

export interface ApiLibraryProcessTimeStretchResult {
  kind: "time_stretch";
  apply: boolean;
  tempoRatio: number;
  rows: ApiLibraryProcessTimeStretchRow[];
}

/** Resultado de job `sync_metadata` (ID3 + nombre de archivo → catálogo). */
export interface ApiLibraryProcessSyncMetadataFailure {
  assetId: string;
  title: string;
  error: string;
}

export interface ApiLibraryProcessSyncMetadataResult {
  kind: "sync_metadata";
  updated: number;
  failures: number;
  total: number;
  recentFailures: ApiLibraryProcessSyncMetadataFailure[];
}

/** GET /library/process-jobs/:id — estado de un trabajo en cola (worker aparte). */
export interface ApiLibraryProcessJobDetail {
  id: string;
  kind: string;
  status: string;
  payload: unknown;
  result: unknown | null;
  error: string | null;
  progressCurrent: number;
  progressTotal: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

/** POST /library/process-jobs — encolar: loudness_batch, bpm_detect, trim_silence, transcode_mp3, sync_metadata, semantic_enrich; policy opcional. */
export interface ApiLibraryProcessJobEnqueueResult {
  jobId: string;
}

export type ApiLibraryUploadResponse = ApiLibraryAsset;

/** Resultado de POST /library/import/m3u (registrar pistas ya presentes bajo MEDIA_ROOT). */
export interface ApiLibraryImportM3uResult {
  created: number;
  skippedExisting: number;
  skippedMissing: number;
  skippedRemote: number;
}

/** POST /library/import-local-files — copia desde rutas absolutas (app instalada). */
export interface ApiLibraryImportLocalFilesBody {
  paths: string[];
  folder?: string;
}

export interface ApiLibraryImportLocalFilesResult {
  imported: number;
  ids: string[];
  skipped: number;
  errors: string[];
}

/** GET/PUT /library/auto-update — escaneo programado de carpetas en bóveda (RadioBOSS). */
export interface ApiLibraryAutoUpdateLastResult {
  scanned: number;
  created: number;
  skippedExisting: number;
  errors: number;
  errorSample?: string;
}

export interface ApiLibraryAutoUpdateConfig {
  enabled: boolean;
  intervalMinutes: number;
  folderPrefixes: string[];
  lastRunAt: string | null;
  lastResult: ApiLibraryAutoUpdateLastResult | null;
}

export interface ApiLibraryAutoUpdatePatchBody {
  enabled?: boolean;
  intervalMinutes?: number;
  folderPrefixes?: string[];
}

// Playlists
export interface ApiPlaylistListItem {
  id: string;
  name: string;
  /** Color de pestaña (#RRGGBB) o null. */
  tabColor?: string | null;
  _count: { items: number };
}

export interface ApiPlaylist {
  id: string;
  name: string;
  tabColor?: string | null;
}

export interface ApiPlaylistCreateBody {
  name: string;
}

/** POST /playlists/from-library-view — misma lógica de filtros que GET /library/assets. */
export interface ApiPlaylistFromLibraryViewBody {
  name?: string;
  q?: string;
  genre?: string;
  artist?: string;
  album?: string;
  pathPrefix?: string;
  /** Si se envía, solo esas pistas (máx. 500); ignoran otros filtros salvo validación de existencia. */
  assetIds?: string[];
}

/** Filtros opcionales por categoría (Generator Pro). */
export interface ApiPlaylistCategoryFilters {
  yearMin?: number;
  yearMax?: number;
  durationMinSec?: number;
  durationMaxSec?: number;
}

/**
 * Categoría del Playlist Generator Pro (RadioBOSS).
 * - Con `rotation[]`: patrón estructural (Top100 → ID → Music → …).
 * - Sin `rotation`: rotación ponderada por `weight` (compat).
 */
export interface ApiPlaylistCategoryRule {
  id?: string;
  name?: string;
  kind: "genre" | "folder" | "artist";
  value: string;
  /** Peso relativo en modo ponderado (se normaliza al 100 %). Default 25. */
  weight?: number;
  /** Pistas a tomar cada vez que la categoría aparece en la rotación. Default 1. */
  picksPerCycle?: number;
  /** Ignorar separación de artista / no-repeat (jingles, IDs). */
  ignoreRepeatProtection?: boolean;
  /** Preferir pistas con menos reproducciones recientes. */
  preferFewerPlays?: boolean;
  filters?: ApiPlaylistCategoryFilters;
}

/** POST /playlists/generate — Playlist Generator Pro. */
export interface ApiPlaylistGenerateBody {
  name?: string;
  targetDurationSec?: number;
  genres?: string[];
  pathPrefixes?: string[];
  categoryRules?: ApiPlaylistCategoryRule[];
  /**
   * Secuencia de ids de categoría (RadioBOSS Rotation).
   * Si está presente y no vacío, se cicla el patrón hasta la duración objetivo.
   */
  rotation?: string[];
  order?: "random" | "title";
  minArtistGap?: number;
  maxTracks?: number;
}

export interface ApiPlaylistGenerateResult {
  playlistId: string;
  name: string;
  trackCount: number;
  totalDurationSec: number;
  shortfallSec: number;
}

/** Payload de evento GENERATE_AND_PLAY_PLAYLIST (RB-127). */
export interface ApiSchedulerGenerateAndPlayPayload {
  generate: ApiPlaylistGenerateBody;
  /** Si true, reemplaza la cola al aire; si false, añade al final. Default true. */
  replaceQueue?: boolean;
}

/** Preset local del generador (UI). */
export interface ApiPlaylistGeneratorPreset {
  id: string;
  name: string;
  config: ApiPlaylistGenerateBody;
}

/** Configuración del planificador de publicidad (singleton `main`). */
export interface ApiAdSchedulerConfig {
  id: string;
  enabled: boolean;
  pathPrefix: string;
  intervalMinutes: number;
  spotsPerBreak: number;
  maxSpotsPerHour: number;
  minGapMinutes: number;
  rotationMode: "random" | "sequential";
  lastBreakAt: string | null;
  sequentialCursor: number;
  hourWindowStart: string | null;
  spotsThisHour: number;
  updatedAt: string;
}

export interface ApiAdSchedulerConfigPatchBody {
  enabled?: boolean;
  pathPrefix?: string;
  intervalMinutes?: number;
  spotsPerBreak?: number;
  maxSpotsPerHour?: number;
  minGapMinutes?: number;
  rotationMode?: "random" | "sequential";
}

export interface ApiAdSpotRow {
  id: string;
  title: string;
  artist: string | null;
  path: string;
  durationSec: number | null;
}

export interface ApiAdBreakResult {
  ok: true;
  assetIds: string[];
  insertedCount: number;
  source: string;
}

export interface ApiAdBreakLogRow {
  id: string;
  stationId: string;
  assetIds: string[];
  source: string;
  createdAt: string;
}

/** Payload de evento PLAY_AD_BREAK / POST /ads/break */
export interface ApiAdBreakPayload {
  spotCount?: number;
  pathPrefix?: string;
}

export interface ApiPlaylistRenameBody {
  name?: string;
  /** Hex #RRGGBB; null quita el color. */
  tabColor?: string | null;
}

/** POST /playlists/:id/fill-from-genre — reemplaza ítems con todas las pistas del género en biblioteca. */
export interface ApiPlaylistFillFromGenreBody {
  genre: string;
  /** Renombrar la lista al nombre del género (default true). */
  renameToGenre?: boolean;
}

/** POST /playlists/:id/fill-from-artist — reemplaza ítems con pistas del artista en biblioteca. */
export interface ApiPlaylistFillFromArtistBody {
  artist: string;
  renameToArtist?: boolean;
}

/** POST /playlists/:id/fill-from-folder — reemplaza ítems con pistas bajo pathPrefix en bóveda. */
export interface ApiPlaylistFillFromFolderBody {
  pathPrefix: string;
  renameToFolder?: boolean;
}

/** POST /playlists/:id/merge-from-playlist — añade o reemplaza con otra lista guardada. */
export interface ApiPlaylistMergeFromPlaylistBody {
  sourcePlaylistId: string;
  /** true = reemplaza ítems; false = añade al final (RadioBOSS: Add tracks from playlist). */
  replace?: boolean;
}

/** POST /playlists/:targetId/items/transfer — mover/copiar ítems entre pestañas. */
export interface ApiPlaylistTransferItemsBody {
  sourcePlaylistId: string;
  itemIds: string[];
  mode: "move" | "copy";
}

export interface ApiPlaylistItem {
  id: string;
  position: number;
  kind: QueueEntryKind;
  label: string | null;
  pauseSec: number | null;
  asset: ApiLibraryAsset | null;
  /** Reglas de expansión (track_list) o payload de cmd/container. */
  trackListSpec?: ApiTrackListSpec | ApiPlaylistCmdSpec | ApiPlaylistContainerSpec | null;
}

/** Reglas RadioBOSS-style para ítem «track list» / «lista de pistas» en playlist. */
export interface ApiTrackListSpec {
  /** folder | playlist (UI RadioBOSS); genre | artist | category (compat). */
  source: "folder" | "playlist" | "genre" | "artist" | "category";
  /** Prefijo de carpeta, id de playlist, género, artista… */
  value: string;
  /**
   * Cuántas pistas materializar por lanzamiento al sync/refill.
   * RadioBOSS: 1 (un ítem Track List = una canción al aire).
   */
  maxTracks?: number;
  /** random | sequential (alias legacy: title) | series */
  order?: "random" | "sequential" | "series" | "title";
  label?: string;
  /** Ignorar anti-repetición global (jingles / IDs). */
  ignoreRepeatProtection?: boolean;
  /** Carpeta: incluir subcarpetas (default true). */
  recurseSubfolders?: boolean;
  /** Cursor sequential/series (0-based). */
  cursor?: number;
  /** Modo series: pista fija hasta avanzar con evento. */
  stickyAssetId?: string | null;
  /** Modo random: mazo restante sin repetir hasta agotar. */
  deck?: string[];
}

/** PUT /playlists/:id/items/restore — restaurar snapshot (undo/redo). */
export interface ApiPlaylistRestoreItemsBody {
  items: Array<{
    kind: QueueEntryKind;
    assetId?: string | null;
    label?: string | null;
    pauseSec?: number | null;
    trackListSpec?: ApiTrackListSpec | null;
  }>;
}

/** POST /library/assets/stream-url — registrar URL http(s) como medio en catálogo. */
export interface ApiLibraryRegisterStreamUrlBody {
  url: string;
  title?: string;
  artist?: string;
  durationSec?: number;
}

/** POST /playlists/:id/items/stream-url — añadir stream remoto a playlist. */
export interface ApiPlaylistInsertStreamUrlBody {
  url: string;
  title?: string;
  artist?: string;
  durationSec?: number;
  insertAfterItemId?: string | null;
}

/** POST /playlists/:id/items/track-list */
export interface ApiPlaylistInsertTrackListBody {
  source: ApiTrackListSpec["source"];
  value: string;
  maxTracks?: number;
  order?: ApiTrackListSpec["order"];
  label?: string;
  ignoreRepeatProtection?: boolean;
  recurseSubfolders?: boolean;
  insertAfterItemId?: string | null;
}

/** POST /api/station/playout-heartbeat — cliente UI indica que reproduce localmente. */
export interface ApiPlayoutHeartbeatBody {
  queueItemId?: string;
  playing?: boolean;
  currentSec?: number;
}

/** POST /playlists/:id/duplicate — copia real (RB-004). */
export interface ApiPlaylistDuplicateBody {
  name: string;
}

/** POST /playlists/import-file — importar M3U/PLS (RB-009). */
export interface ApiPlaylistImportFileBody {
  format: "m3u" | "pls";
  content: string;
  name?: string;
  targetPlaylistId?: string | null;
}

export interface ApiPlaylistImportFileResult {
  playlistId: string;
  added: number;
  skipped: number;
}

/** POST /playlists/:id/items/command — pausa, marcador, nota, cmd, container, etc. */
export interface ApiPlaylistAddCommandBody {
  kind: "pause" | "marker" | "note" | "hour_marker" | "dtmf" | "cmd" | "container";
  label?: string;
  pauseSec?: number;
  /** Payload si kind = cmd. */
  cmdSpec?: Omit<ApiPlaylistCmdSpec, "type"> & { action: PlaylistCmdAction };
  /** Playlist anidada si kind = container. */
  containerPlaylistId?: string;
  /** Insertar después de este ítem; si falta, al final (o tras la selección en UI). */
  insertAfterItemId?: string | null;
}

/** POST /playlists/:id/items/voicetrack — locución grabada (asset ya en biblioteca). */
export interface ApiPlaylistInsertVoicetrackBody {
  assetId: string;
  label?: string;
  /** Título del medio en biblioteca (opcional). */
  title?: string;
  insertAfterItemId?: string | null;
}

export interface ApiPlaylistAutoIntroMatch {
  trackItemId: string;
  trackTitle: string;
  artist: string;
  introAssetId: string;
  introTitle: string;
  /** id3 = tag INTRO: / introMatchKey; folder = carpeta o nombre. */
  matchSource?: "id3" | "folder";
}

/** POST /playlists/:id/render — mezcla offline (P2-01). */
export interface ApiPlaylistRenderBody {
  format: "wav" | "mp3";
}

export interface ApiPlaylistRenderEnqueueResult {
  jobId: string;
}

/** POST /playlists/:id/items/tts — locución sintetizada (RB-057). */
export interface ApiPlaylistInsertTtsBody {
  text: string;
  label?: string;
  title?: string;
  insertAfterItemId?: string | null;
  lang?: string;
  /** 0.5–2.0 velocidad relativa. */
  rate?: number;
  engine?: "auto" | "sapi" | "espeak" | "edge-tts" | "piper";
  voice?: string;
}

/** POST /playlists/:id/auto-intro — insertar intros por artista (RB-058). */
export interface ApiPlaylistAutoIntroBody {
  dryRun?: boolean;
  folderPath?: string;
}

export interface ApiPlaylistAutoIntroResult {
  dryRun: boolean;
  folder: string;
  inserted: number;
  matches: ApiPlaylistAutoIntroMatch[];
}

export interface ApiPlaylistDetail {
  id: string;
  name: string;
  tabColor?: string | null;
  /** Última modificación en servidor (auto-guardado). */
  updatedAt?: string;
  /** Desde cuándo se calcula «ya sonó» (RB-055). */
  rotationResetAt?: string;
  /** Asset IDs con skip registrado desde rotationResetAt. */
  playedAssetIds?: string[];
  items: ApiPlaylistItem[];
}

export interface ApiListenerHistory {
  hours: number;
  since: string;
  sampleCount: number;
  peakListeners: number | null;
  avgListeners: number | null;
  latest: {
    recordedAt: string;
    listeners: number | null;
    streamTitle: string | null;
    sourceConnected: boolean | null;
    targetName: string | null;
  } | null;
  samples: {
    recordedAt: string;
    listeners: number | null;
    streamTitle: string | null;
    sourceConnected: boolean | null;
    targetName: string | null;
  }[];
}

export interface ApiPlaylistAddItemBody {
  assetId: string;
}

/** Añade varios medios ya existentes al final de la playlist (orden del array). */
export interface ApiPlaylistBatchItemsBody {
  assetIds: string[];
}

/** POST /playlists/:id/items/interleave-jingles — N canciones + 1 jingle. */
export interface ApiPlaylistInterleaveJinglesBody {
  /** Canciones entre cada jingle (default 3). */
  everyN: number;
  /** auto = detectar jingles; selected = usar jingleItemIds. */
  mode?: "auto" | "selected";
  jingleItemIds?: string[];
}

export interface ApiPlaylistReorderBody {
  orderedItemIds: string[];
}

// Schedule
export interface ApiSchedulePlaylistRef {
  id: string;
  name: string;
}

export interface ApiScheduleBlock {
  id: string;
  label: string;
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  playlist: ApiSchedulePlaylistRef | null;
  playlistId?: string | null;
  priority: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface ApiScheduleCreateBody {
  label: string;
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  playlistId?: string | null;
  priority?: number;
}

export type ApiSchedulePatchBody = Partial<ApiScheduleCreateBody>;

export interface ApiScheduleTodayHints {
  dayOfWeek: number;
  minuteNow: number;
  blocks: ApiScheduleBlock[];
  active: ApiScheduleBlock[];
}

export interface ApiScheduleApplyActiveBody {
  /** Sustituir toda la cola (por defecto true, estilo radio por franja). */
  replace?: boolean;
  /** Ignorar deduplicación por último bloque aplicado. */
  force?: boolean;
}

export type ApiScheduleApplyActiveReason =
  | "applied"
  | "no_active_block"
  | "no_playlist_on_block"
  | "already_applied";

export interface ApiScheduleApplyActiveResult {
  applied: boolean;
  reason: ApiScheduleApplyActiveReason;
  block: ApiScheduleBlock | null;
  station: ApiStationState | null;
}

export { buildM3uPlaylist, parseM3uPlaylist, type M3uPlaylistEntry } from "./m3u.js";
export { buildPlsPlaylist, parsePlsPlaylist, type PlsPlaylistEntry } from "./pls.js";