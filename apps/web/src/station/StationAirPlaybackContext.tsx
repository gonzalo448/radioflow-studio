import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "../auth/AuthContext";
import { apiFetch } from "../lib/api";
import { apiUrl } from "../lib/api-base";
import { computeOnAirDisplay, type OnAirDisplay } from "./on-air-display";
import { queueEntryTitle } from "../lib/queue-entry-display";
import { hasDeferredSpotBeforeNextTrack, logicalNextPlayableQueueRow } from "./playback-upcoming-order";
import type { PauseCountdown } from "./pause-countdown";
import { dbToLinear, DEFAULT_DUCK_ATTACK_RAMP_SEC, DEFAULT_DUCK_RELEASE_RAMP_SEC } from "./reference-duck";
import { STATION_PLAY_REQUEST_EVENT } from "../lib/local-audio-import";
import { sendPlayoutHeartbeat } from "../lib/playout-heartbeat";
import { parseCmdQueueLabel } from "../lib/playlist-cmd-spec";
import { useStationLive } from "./StationLiveContext";
import { isSpotLikeAsset, resolvePlaySegmentFades } from "@radioflow/shared";
import {
  CabReferencePlayer,
  type CabBusMeterFrame,
  type CabReferencePlayerHandle,
} from "./CabReferencePlayer";
import { normalizeClientCues } from "./track-cues";
import { planVoiceTrackBridge } from "./voice-track-bridge";
import {
  CAB_VOICE_TRACK_EVENT,
  loadCabVoiceTrackSettings,
} from "../lib/cab-voice-track";
import { useBroadcastAirStatus } from "../hooks/useBroadcastAirStatus";
import {
  cabinaMayAutoSkip,
  listenThroughFromBroadcastStatus,
  loadCabinaMonitorMode,
  resolveCabinaListenUrl,
  saveCabinaMonitorMode,
  type CabinaMonitorMode,
} from "./listen-through";

type AirPlayback = { current: number; duration: number };

type StationAirPlaybackContextValue = {
  dockMuted: boolean;
  setDockMuted: (value: boolean | ((prev: boolean) => boolean)) => void;
  airPlayback: AirPlayback;
  useCabEngine: boolean;
  airAssetId: string | null;
  play: () => Promise<void>;
  pause: () => void;
  getLeadAudio: () => HTMLAudioElement | null;
  airAudioRef: React.RefObject<HTMLAudioElement | null>;
  subscribeMeterFrame: (listener: (sample: CabBusMeterFrame) => void) => () => void;
  pauseForPreview: () => void;
  onAirDisplay: OnAirDisplay;
  /** Cuenta regresiva activa durante un comando «pausa» en cola. */
  pauseCountdown: PauseCountdown | null;
  /** Atenuación extra del bus de referencia (dB; negativo = ducking). */
  referenceDuckDb: number;
  setReferenceDuckDb: (db: number) => void;
  /** C1: monitor = mount público (encoder) vs Web Audio local. */
  listenThroughActive: boolean;
  monitorMode: CabinaMonitorMode;
  setMonitorMode: (mode: CabinaMonitorMode) => void;
  /** true si broadcast+encoder permitirían listen-through (aunque el ops force local). */
  listenThroughAvailable: boolean;
};

const StationAirPlaybackContext = createContext<StationAirPlaybackContextValue | null>(null);

export function StationAirPlaybackProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const { state, refresh } = useStationLive();
  const { status: broadcastStatus } = useBroadcastAirStatus(10_000);
  const currentQueueItemId = state?.currentQueueEntry?.id ?? null;
  const [dockMuted, setDockMuted] = useState(false);
  const [airPlayback, setAirPlayback] = useState<AirPlayback>({ current: 0, duration: 0 });
  const [leadAssetIdOverride, setLeadAssetIdOverride] = useState<string | null>(null);
  const [pauseCountdown, setPauseCountdown] = useState<PauseCountdown | null>(null);
  const [referenceDuckDb, setReferenceDuckDb] = useState(0);
  const [monitorMode, setMonitorModeState] = useState<CabinaMonitorMode>(() => loadCabinaMonitorMode());
  const skipInFlightRef = useRef(false);
  const transmissionArmedRef = useRef(false);
  const cabRef = useRef<CabReferencePlayerHandle>(null);
  const airAudioRef = useRef<HTMLAudioElement | null>(null);
  const meterListenersRef = useRef(new Set<(sample: CabBusMeterFrame) => void>());

  const preferLocalMonitor = monitorMode === "local";
  const listenThroughAvailable = listenThroughFromBroadcastStatus(broadcastStatus, false);
  const listenThroughActive = listenThroughFromBroadcastStatus(broadcastStatus, preferLocalMonitor);
  const listenUrl =
    listenThroughActive && broadcastStatus?.publicListenUrl
      ? resolveCabinaListenUrl(broadcastStatus.publicListenUrl)
      : null;

  const setMonitorMode = useCallback((mode: CabinaMonitorMode) => {
    saveCabinaMonitorMode(mode);
    setMonitorModeState(mode);
  }, []);

  const curPos = state?.station.currentPosition ?? 0;
  const queue = state?.queue ?? [];
  const playbackQ = state?.playbackQueue ?? [];

  const airAsset = useMemo(() => {
    if (!state) return null;
    const np = state.nowPlaying;
    if (np) return np;
    const row = queue[curPos];
    return row?.kind === "track" || row?.kind === "voicetrack" ? row.asset : null;
  }, [state, queue, curPos]);

  const airAssetId = airAsset?.id ?? null;

  const onAirDisplay = useMemo(
    () => computeOnAirDisplay(state, leadAssetIdOverride),
    [state, leadAssetIdOverride],
  );

  const reportLeadAssetId = useCallback((id: string) => {
    setLeadAssetIdOverride(id);
  }, []);

  useEffect(() => {
    if (airAssetId && leadAssetIdOverride === airAssetId) {
      setLeadAssetIdOverride(null);
    }
  }, [airAssetId, leadAssetIdOverride]);

  // Prefetch / crossfade siempre según la posición del SERVIDOR (canción al aire),
  // no según el deck entrante del XF: si no, se “salta” el marcador de locución
  // insertado entre la canción actual y la siguiente y se mezcla encima.
  const nextPlayableRow = state ? logicalNextPlayableQueueRow(queue, curPos, playbackQ) : null;
  const [vtSettings, setVtSettings] = useState(() => loadCabVoiceTrackSettings());
  useEffect(() => {
    const onVt = () => setVtSettings(loadCabVoiceTrackSettings());
    window.addEventListener(CAB_VOICE_TRACK_EVENT, onVt);
    return () => window.removeEventListener(CAB_VOICE_TRACK_EVENT, onVt);
  }, []);

  const airCuesForBridge = useMemo(() => {
    const a = airAsset as {
      cueStartSec?: number | null;
      cueEndSec?: number | null;
      durationSec?: number | null;
    } | null;
    if (!a) return null;
    return normalizeClientCues(a.durationSec, a.cueStartSec, a.cueEndSec);
  }, [airAsset]);

  const voiceTrackBridgePlan =
    state && vtSettings.bridgeEnabled && !listenThroughActive
      ? planVoiceTrackBridge(
          queue,
          curPos,
          resolvePlaySegmentFades(state.station).overlapSec,
          airCuesForBridge,
          vtSettings.duckDb,
        )
      : null;

  const nextAirAssetId = voiceTrackBridgePlan?.nextMusicAssetId ?? nextPlayableRow?.asset?.id ?? null;

  const cabEngineAllowed = Boolean(state && airAsset && state.station.cabWebAudioEngine !== false);
  /** Web Audio / asset local: nunca en listen-through (C1). */
  const useCabEngine = cabEngineAllowed && !listenThroughActive;
  const airGainDb = (airAsset as { playbackGainDb?: number | null } | null)?.playbackGainDb ?? 0;
  const nextGainDb = voiceTrackBridgePlan
    ? voiceTrackBridgePlan.nextMusicGainDb
    : ((nextPlayableRow?.asset as { playbackGainDb?: number | null } | undefined)?.playbackGainDb ?? 0);
  const airCuesAsset = airAsset as {
    cueStartSec?: number | null;
    cueEndSec?: number | null;
    durationSec?: number | null;
    genre?: string | null;
  } | null;
  const nextCuesAsset = voiceTrackBridgePlan
    ? {
        cueStartSec: voiceTrackBridgePlan.nextMusicCueStartSec,
        cueEndSec: voiceTrackBridgePlan.nextMusicCueEndSec,
        durationSec: voiceTrackBridgePlan.nextMusicDurationSec,
        genre: null as string | null,
      }
    : (nextPlayableRow?.asset as {
        cueStartSec?: number | null;
        cueEndSec?: number | null;
        durationSec?: number | null;
        genre?: string | null;
      } | null);
  const airIsAnnounce =
    airCuesAsset?.genre === "time-announce" ||
    airCuesAsset?.genre === "station-intro" ||
    airCuesAsset?.genre === "jingle-auto";
  /** Jingle/spot al aire (aunque venga como pista normal): sale completo, sin fundido de salida. */
  const airIsSpot = airIsAnnounce || isSpotLikeAsset(airCuesAsset);
  // Preferir contrato PlaySegmentSpec (A1) cuando la API lo envía; misma ventana que el encoder.
  const playSeg = state?.playSegment ?? state?.nowPlayingInfo?.playSegment ?? null;
  const airCueStart = airIsAnnounce
    ? null
    : playSeg && playSeg.assetId === airAssetId
      ? playSeg.cueStartSec
      : airCuesAsset?.cueStartSec;
  const airCueEnd = airIsAnnounce
    ? null
    : playSeg && playSeg.assetId === airAssetId
      ? playSeg.cueEndSec
      : airCuesAsset?.cueEndSec;
  const nextCueStart = nextCuesAsset?.cueStartSec ?? null;
  const nextCueEnd = nextCuesAsset?.cueEndSec ?? null;
  const spotNext = Boolean(state) && hasDeferredSpotBeforeNextTrack(queue, curPos);
  const stationFades = resolvePlaySegmentFades(state?.station ?? {});
  // Con locución/intro/jingle a continuación: corte duro al terminar (0), sin mezclar.
  // Con voice track bridge: XF normal off (el solape lo hace el overlay VT).
  const xfDisabled =
    airIsSpot || spotNext || nextAirAssetId == null || Boolean(voiceTrackBridgePlan);
  const cabCrossfadeSec = xfDisabled ? 0 : stationFades.overlapSec;
  const cabFadeInSec = xfDisabled ? 0 : stationFades.fadeInSec;
  const cabFadeOutSec = xfDisabled ? 0 : stationFades.fadeOutSec;
  const cabReferenceGainDb = state?.station.cabReferenceGainDb ?? 0;

  const skip = useCallback(async () => {
    if (!token || skipInFlightRef.current) return;
    skipInFlightRef.current = true;
    try {
      await apiFetch("/api/station/skip", { method: "POST", token });
      await refresh();
    } finally {
      skipInFlightRef.current = false;
    }
  }, [token, refresh]);

  /** Auto-skip de decks Web Audio: desactivado en listen-through (encoder EOF es soberano). */
  const onRequestSkipFromCab = useCallback(async () => {
    if (!cabinaMayAutoSkip(listenThroughActive)) return;
    await skip();
  }, [listenThroughActive, skip]);

  /** Al cerrar el bridge, avanza canción A + voicetrack y deja B al aire. */
  const skipVoiceTrackBridge = useCallback(async () => {
    if (!cabinaMayAutoSkip(listenThroughActive)) return;
    if (!token || skipInFlightRef.current) return;
    skipInFlightRef.current = true;
    try {
      await apiFetch("/api/station/skip", { method: "POST", token });
      await apiFetch("/api/station/skip", { method: "POST", token });
      await refresh();
    } finally {
      skipInFlightRef.current = false;
    }
  }, [listenThroughActive, token, refresh]);

  // Si un VT embebido entre canciones queda al aire (p. ej. 1 skip del bridge), avanzar.
  useEffect(() => {
    if (!vtSettings.bridgeEnabled || !token || !state || listenThroughActive) return;
    const row = queue[curPos];
    if (!row || row.kind !== "voicetrack" || !row.asset) return;
    const prev = queue[curPos - 1];
    const next = queue[curPos + 1];
    if (!(prev?.kind === "track" && prev.asset && next?.kind === "track" && next.asset)) return;
    void skip();
  }, [curPos, listenThroughActive, queue, skip, state, token, vtSettings.bridgeEnabled]);

  const commandEntry = onAirDisplay.commandEntry;
  const commandEntryId = commandEntry?.id ?? null;

  useEffect(() => {
    if (!state || !token || !commandEntry) {
      setPauseCountdown(null);
      return;
    }
    if (
      commandEntry.kind === "time_announce" ||
      commandEntry.kind === "station_intro" ||
      commandEntry.kind === "jingle_auto"
    ) {
      setPauseCountdown(null);
      void skip();
      return;
    }
    if (commandEntry.kind === "marker") {
      setPauseCountdown(null);
      void skip();
      return;
    }
    if (commandEntry.kind === "hour_marker") {
      setPauseCountdown(null);
      const next = new Date();
      next.setMinutes(0, 0, 0);
      next.setHours(next.getHours() + 1);
      const targetMs = next.getTime();
      const label = queueEntryTitle(commandEntry);

      const tick = () => {
        const remainingSec = Math.max(0, Math.ceil((targetMs - Date.now()) / 1000));
        setPauseCountdown({
          queueItemId: commandEntry.id,
          totalSec: remainingSec,
          remainingSec,
          label,
        });
        if (remainingSec <= 0) void skip();
      };

      tick();
      const interval = window.setInterval(tick, 250);
      return () => {
        window.clearInterval(interval);
        setPauseCountdown(null);
      };
    }
    if (commandEntry.kind === "pause") {
      const totalSec = Math.max(0, commandEntry.pauseSec ?? 0);
      if (totalSec === 0) {
        setPauseCountdown(null);
        void skip();
        return;
      }
      const startedAt = Date.now();
      const label = queueEntryTitle(commandEntry);

      const tick = () => {
        const elapsed = Math.floor((Date.now() - startedAt) / 1000);
        const remainingSec = Math.max(0, totalSec - elapsed);
        setPauseCountdown({
          queueItemId: commandEntry.id,
          totalSec,
          remainingSec,
          label,
        });
        if (remainingSec <= 0) void skip();
      };

      tick();
      const interval = window.setInterval(tick, 250);
      return () => {
        window.clearInterval(interval);
        setPauseCountdown(null);
      };
    }
    setPauseCountdown(null);
  }, [commandEntry, commandEntryId, skip, state, token]);

  const onCabLeadTick = useCallback((current: number, duration: number) => {
    if (!Number.isFinite(duration) || duration <= 0) {
      setAirPlayback({ current, duration: 0 });
      return;
    }
    setAirPlayback({ current, duration });
  }, []);

  const onCabBusMeterFrame = useCallback((sample: CabBusMeterFrame) => {
    for (const fn of meterListenersRef.current) fn(sample);
  }, []);

  const syncAirMedia = useCallback((el: HTMLAudioElement) => {
    const dur = el.duration;
    if (!Number.isFinite(dur) || dur <= 0) {
      setAirPlayback({ current: el.currentTime, duration: 0 });
      return;
    }
    setAirPlayback({ current: el.currentTime, duration: dur });
  }, []);

  const play = useCallback(async () => {
    transmissionArmedRef.current = true;
    try {
      if (useCabEngine && cabRef.current) {
        await cabRef.current.play();
        return;
      }
      await airAudioRef.current?.play();
    } catch {
      /* autoplay bloqueado */
    }
  }, [useCabEngine]);

  const pause = useCallback(() => {
    transmissionArmedRef.current = false;
    if (useCabEngine && cabRef.current) cabRef.current.pause();
    else airAudioRef.current?.pause();
  }, [useCabEngine]);

  // Comandos en cola (cmd) + DTMF auto-avance
  useEffect(() => {
    if (!state || !token || !commandEntry) return;
    if (commandEntry.kind === "dtmf") {
      void skip();
      return;
    }
    if (commandEntry.kind !== "cmd") return;

    let cancelled = false;
    void (async () => {
      const spec = parseCmdQueueLabel(commandEntry.label);
      if (cancelled) return;
      if (!spec) {
        await skip();
        return;
      }
      try {
        if (spec.action === "play") {
          await play();
          if (!cancelled) await skip();
          return;
        }
        if (spec.action === "stop") {
          pause();
          if (!cancelled) await skip();
          return;
        }
        if (spec.action === "next") {
          await skip();
          return;
        }
        if (spec.action === "clear") {
          await apiFetch("/api/station/queue-clear", { method: "POST", token });
          if (!cancelled) await refresh();
          return;
        }
        if (spec.action === "load_playlist" && spec.playlistId) {
          const replace = spec.replace !== false;
          await apiFetch("/api/station/queue-from-playlist", {
            method: "POST",
            token,
            body: JSON.stringify({ playlistId: spec.playlistId, replace }),
          });
          if (cancelled) return;
          await refresh();
          if (!replace) await skip();
          return;
        }
        await skip();
      } catch {
        if (!cancelled) await skip();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [commandEntry, commandEntryId, pause, play, refresh, skip, state, token]);

  const getLeadAudio = useCallback(() => {
    if (useCabEngine && cabRef.current) return cabRef.current.getLeadAudio();
    return airAudioRef.current;
  }, [useCabEngine]);

  useEffect(() => {
    if (!token) return;
    // C1 listen-through: siempre marcar playing para que headless no compita con encoder EOF.
    const forcePlayingForAirClock = listenThroughActive;
    if (!forcePlayingForAirClock && !airAssetId) return;
    const tick = () => {
      if (forcePlayingForAirClock) {
        sendPlayoutHeartbeat(token, {
          queueItemId: currentQueueItemId ?? undefined,
          playing: true,
        });
        return;
      }
      const el = getLeadAudio();
      const playing = el ? !el.paused && !el.ended : false;
      sendPlayoutHeartbeat(token, {
        queueItemId: currentQueueItemId ?? undefined,
        playing,
        currentSec: el && Number.isFinite(el.currentTime) ? el.currentTime : undefined,
      });
    };
    tick();
    const interval = window.setInterval(tick, 4000);
    return () => window.clearInterval(interval);
  }, [airAssetId, currentQueueItemId, getLeadAudio, listenThroughActive, token]);

  const pauseForPreview = useCallback(() => {
    pause();
  }, [pause]);

  useEffect(() => {
    const onPlayRequest = () => {
      void (async () => {
        await refresh();
        await play();
      })();
    };
    window.addEventListener(STATION_PLAY_REQUEST_EVENT, onPlayRequest);
    return () => window.removeEventListener(STATION_PLAY_REQUEST_EVENT, onPlayRequest);
  }, [play, refresh]);

  const subscribeMeterFrame = useCallback((listener: (sample: CabBusMeterFrame) => void) => {
    meterListenersRef.current.add(listener);
    return () => {
      meterListenersRef.current.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (!listenThroughActive || !listenUrl) return;
    transmissionArmedRef.current = true;
    const el = airAudioRef.current;
    if (!el) return;
    void el.play().catch(() => {});
  }, [listenThroughActive, listenUrl]);

  useEffect(() => {
    if (useCabEngine || !transmissionArmedRef.current) return;
    if (!listenThroughActive && !airAssetId) return;
    const el = airAudioRef.current;
    if (!el) return;
    void el.play().catch(() => {});
  }, [airAssetId, listenThroughActive, listenUrl, useCabEngine]);

  useEffect(() => {
    setDockMuted(false);
  }, [airAssetId, listenUrl]);

  useEffect(() => {
    const el = airAudioRef.current;
    if (!el || useCabEngine) return;
    const targetLin = referenceDuckDb !== 0 ? dbToLinear(referenceDuckDb) : 1;
    const targetVol = dockMuted ? 0 : Math.min(1, targetLin);
    const rampSec = referenceDuckDb === 0 ? DEFAULT_DUCK_RELEASE_RAMP_SEC : DEFAULT_DUCK_ATTACK_RAMP_SEC;
    const startVol = el.volume;
    const startMs = performance.now();
    const durationMs = rampSec * 1000;
    let raf = 0;
    const tick = () => {
      const p = Math.min(1, (performance.now() - startMs) / durationMs);
      el.volume = startVol + (targetVol - startVol) * p;
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [referenceDuckDb, dockMuted, useCabEngine, airAssetId, listenUrl]);

  const setReferenceDuckDbStable = useCallback((db: number) => {
    setReferenceDuckDb(db);
  }, []);

  const value = useMemo<StationAirPlaybackContextValue>(
    () => ({
      dockMuted,
      setDockMuted,
      airPlayback,
      useCabEngine,
      airAssetId,
      play,
      pause,
      getLeadAudio,
      airAudioRef,
      subscribeMeterFrame,
      pauseForPreview,
      onAirDisplay,
      pauseCountdown,
      referenceDuckDb,
      setReferenceDuckDb: setReferenceDuckDbStable,
      listenThroughActive,
      monitorMode,
      setMonitorMode,
      listenThroughAvailable,
    }),
    [
      dockMuted,
      airPlayback,
      useCabEngine,
      airAssetId,
      play,
      pause,
      getLeadAudio,
      subscribeMeterFrame,
      pauseForPreview,
      onAirDisplay,
      pauseCountdown,
      referenceDuckDb,
      setReferenceDuckDbStable,
      listenThroughActive,
      monitorMode,
      setMonitorMode,
      listenThroughAvailable,
    ],
  );

  return (
    <StationAirPlaybackContext.Provider value={value}>
      {children}
      <div className="station-air-playback-host" aria-hidden="true">
        {useCabEngine && airAssetId ? (
          <CabReferencePlayer
            ref={cabRef}
            currentAssetId={airAssetId}
            nextAssetId={nextAirAssetId}
            currentPlaybackGainDb={airGainDb}
            nextPlaybackGainDb={nextGainDb}
            stationGainDb={cabReferenceGainDb}
            referenceDuckDb={referenceDuckDb}
            crossfadeSec={cabCrossfadeSec}
            fadeInSec={cabFadeInSec}
            fadeOutSec={cabFadeOutSec}
            currentCueStartSec={airCueStart}
            currentCueEndSec={airCueEnd}
            currentDurationSec={
              playSeg && playSeg.assetId === airAssetId
                ? playSeg.durationSec
                : airCuesAsset?.durationSec
            }
            nextCueStartSec={nextCueStart}
            nextCueEndSec={nextCueEnd}
            nextDurationSec={nextCuesAsset?.durationSec}
            dockMuted={dockMuted}
            onLeadTick={onCabLeadTick}
            onRequestSkip={onRequestSkipFromCab}
            onBusMeterFrame={onCabBusMeterFrame}
            onLeadAssetIdChange={reportLeadAssetId}
            voiceTrackBridge={
              voiceTrackBridgePlan
                ? {
                    assetId: voiceTrackBridgePlan.voiceTrackAssetId,
                    gainDb: voiceTrackBridgePlan.voiceTrackGainDb,
                    outroWindowSec: voiceTrackBridgePlan.outroWindowSec,
                    duckDb: voiceTrackBridgePlan.duckDb,
                  }
                : null
            }
            onRequestSkipVoiceTrackBridge={skipVoiceTrackBridge}
          />
        ) : listenThroughActive && listenUrl ? (
          <audio
            ref={airAudioRef}
            key={`listen-through:${listenUrl}`}
            className="station-player-audio"
            muted={dockMuted}
            src={listenUrl}
            preload="none"
            onTimeUpdate={(e) => syncAirMedia(e.currentTarget)}
            onLoadedMetadata={(e) => syncAirMedia(e.currentTarget)}
            onPlay={(e) => {
              syncAirMedia(e.currentTarget);
              transmissionArmedRef.current = true;
            }}
            onPause={(e) => syncAirMedia(e.currentTarget)}
          />
        ) : airAssetId ? (
          <audio
            ref={airAudioRef}
            key={airAssetId}
            className="station-player-audio"
            crossOrigin="anonymous"
            muted={dockMuted}
            src={apiUrl(`/api/library/assets/${airAssetId}/stream`)}
            preload="metadata"
            onTimeUpdate={(e) => syncAirMedia(e.currentTarget)}
            onLoadedMetadata={(e) => {
              syncAirMedia(e.currentTarget);
              reportLeadAssetId(airAssetId);
            }}
            onPlay={(e) => syncAirMedia(e.currentTarget)}
            onPause={(e) => syncAirMedia(e.currentTarget)}
            onEnded={() => {
              if (cabinaMayAutoSkip(listenThroughActive)) void skip();
            }}
          />
        ) : null}
      </div>
    </StationAirPlaybackContext.Provider>
  );
}

export function useStationAirPlayback(): StationAirPlaybackContextValue {
  const ctx = useContext(StationAirPlaybackContext);
  if (!ctx) throw new Error("useStationAirPlayback debe usarse dentro de StationAirPlaybackProvider");
  return ctx;
}
