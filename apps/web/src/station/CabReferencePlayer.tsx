import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import type { CabMeterSample } from "../desktop-bridge";
import { apiUrl } from "../lib/api-base";
import { splitWaveformHalfPeaks } from "./vu-waveform-peaks.js";
import {
  DEFAULT_DUCK_ATTACK_RAMP_SEC,
  DEFAULT_DUCK_RELEASE_RAMP_SEC,
} from "./reference-duck.js";
import { CAB_FX_EVENT, cabFxLevelToDb, loadCabFx } from "../lib/cab-fx.js";
import {
  CAB_DYNAMICS_EVENT,
  loadCabDynamics,
  type CabDynamics,
} from "../lib/cab-dynamics.js";
import { clampCuesToFileDuration, crossfadeOverlapSec, mixTriggerAt, normalizeClientCues } from "./track-cues.js";
import { voiceTrackOverlayTriggerAt } from "./voice-track-bridge.js";

function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

function streamSrc(assetId: string): string {
  return apiUrl(`/api/library/assets/${assetId}/stream`);
}

function combinedLinear(stationDb: number, assetDb: number): number {
  return dbToLinear(stationDb + assetDb);
}

/** IPC a Electron (~15 Hz): proceso principal guarda última muestra (HUD / motor nativo futuro). */
function tryPushCabMeterIpc(peak01: number, dbFs: number | null, tickIndex: number) {
  if (tickIndex % 4 !== 0) return;
  const cab = typeof window !== "undefined" ? window.radioflow?.cabMeter : undefined;
  if (!cab?.pushSample) return;
  try {
    const sample: CabMeterSample = {
      peak01,
      dbFs,
      tMs: typeof performance !== "undefined" ? performance.now() : Date.now(),
    };
    cab.pushSample(sample);
  } catch {
    /* preload antiguo */
  }
}

/** Muestra del bus post-master (VU interno e IPC). `peak01L/R` mitades temporales cuando hay buffer de onda (mono ≠ estéreo calibrado). */
export type CabBusMeterFrame = {
  peak01: number;
  peak01L?: number;
  peak01R?: number;
  dbFs: number | null;
};

export type CabReferencePlayerProps = {
  currentAssetId: string;
  nextAssetId: string | null;
  currentPlaybackGainDb: number;
  nextPlaybackGainDb: number;
  stationGainDb: number;
  /** Ducking adicional (dB; 0 o negativo). */
  referenceDuckDb?: number;
  /** Mix point / overlap fijo : segundos antes de cueEnd. */
  crossfadeSec: number;
  /** Cue Start/End de la pista al aire (omitir silencios de cabeza/cola). */
  currentCueStartSec?: number | null;
  currentCueEndSec?: number | null;
  currentDurationSec?: number | null;
  /** Cue Start de la siguiente (arranca ahí al mix). */
  nextCueStartSec?: number | null;
  nextCueEndSec?: number | null;
  nextDurationSec?: number | null;
  dockMuted: boolean;
  onLeadTick: (current: number, duration: number) => void;
  onRequestSkip: () => Promise<void>;
  /** Cada frame (~60 Hz) mientras exista el grafo Web Audio; ideal para VU externos sin `setState`. */
  onBusMeterFrame?: (sample: CabBusMeterFrame) => void;
  /** Pista que suena en el deck líder (para cinta superior antes de que el servidor avance `currentPosition`). */
  onLeadAssetIdChange?: (assetId: string) => void;
  /**
   * Voice track bridge : overlay del VT sobre outro de la actual + intro de `nextAssetId`.
   * Cuando está activo, `nextAssetId` debe ser la música tras el VT (no el VT).
   */
  voiceTrackBridge?: {
    assetId: string;
    gainDb: number;
    outroWindowSec: number;
    duckDb: number;
  } | null;
  /** Avance de cola: salta canción actual + ítem voicetrack (doble skip). */
  onRequestSkipVoiceTrackBridge?: () => Promise<void>;
};

export type CabReferencePlayerHandle = {
  play: () => Promise<void>;
  pause: () => void;
  getLeadAudio: () => HTMLAudioElement | null;
};

type Graph = {
  ctx: AudioContext;
  master: GainNode;
  agcGain: GainNode;
  compressor: DynamicsCompressorNode;
  limiter: DynamicsCompressorNode;
  eqLow: BiquadFilterNode;
  eqMid: BiquadFilterNode;
  eqHigh: BiquadFilterNode;
  duck: GainNode;
  g0: GainNode;
  g1: GainNode;
  /** Overlay de voice track (post-duck: la voz no se atenúa con la cama). */
  vtGain: GainNode;
  analyser: AnalyserNode;
};

function applyCabDynamicsToGraph(g: Graph, dyn: CabDynamics): void {
  const t = g.ctx.currentTime;
  if (dyn.compressorEnabled) {
    g.compressor.threshold.setValueAtTime(dyn.compressorThresholdDb, t);
    g.compressor.knee.setValueAtTime(6, t);
    g.compressor.ratio.setValueAtTime(dyn.compressorRatio, t);
    g.compressor.attack.setValueAtTime(0.005, t);
    g.compressor.release.setValueAtTime(0.15, t);
  } else {
    g.compressor.threshold.setValueAtTime(0, t);
    g.compressor.ratio.setValueAtTime(1, t);
  }
  g.limiter.threshold.setValueAtTime(dyn.limiterCeilingDb, t);
  g.limiter.knee.setValueAtTime(0, t);
  g.limiter.ratio.setValueAtTime(20, t);
  g.limiter.attack.setValueAtTime(0.001, t);
  g.limiter.release.setValueAtTime(0.05, t);
}

function applyCabFxToGraph(g: Graph): void {
  const fx = loadCabFx();
  g.eqLow.gain.value = cabFxLevelToDb(fx.low);
  g.eqMid.gain.value = cabFxLevelToDb(fx.mid);
  g.eqHigh.gain.value = cabFxLevelToDb(fx.high);
}

/**
 * Dos decks + Web Audio: nivelación (dB de estación + por pista) y crossfade
 * alineado a `POST /station/skip` al cerrar la mezcla.
 */
export const CabReferencePlayer = forwardRef<CabReferencePlayerHandle, CabReferencePlayerProps>(
  function CabReferencePlayer(
    {
      currentAssetId,
      nextAssetId,
      currentPlaybackGainDb,
      nextPlaybackGainDb,
      stationGainDb,
      referenceDuckDb = 0,
      crossfadeSec,
      currentCueStartSec = null,
      currentCueEndSec = null,
      currentDurationSec = null,
      nextCueStartSec = null,
      nextCueEndSec = null,
      nextDurationSec = null,
      dockMuted,
      onLeadTick,
      onRequestSkip,
      onBusMeterFrame,
      onLeadAssetIdChange,
      voiceTrackBridge = null,
      onRequestSkipVoiceTrackBridge,
    },
    ref,
  ) {
    const a0Ref = useRef<HTMLAudioElement | null>(null);
    const a1Ref = useRef<HTMLAudioElement | null>(null);
    const aVtRef = useRef<HTMLAudioElement | null>(null);
    const graphRef = useRef<Graph | null>(null);
    const referenceDuckDbRef = useRef(referenceDuckDb);
    referenceDuckDbRef.current = referenceDuckDb;
    /** Duck forzado por bridge VT; tiene prioridad sobre referenceDuckDb. */
    const bridgeDuckDbRef = useRef<number | null>(null);
    const voiceTrackBridgeRef = useRef(voiceTrackBridge);
    voiceTrackBridgeRef.current = voiceTrackBridge;
    const onRequestSkipVoiceTrackBridgeRef = useRef(onRequestSkipVoiceTrackBridge);
    onRequestSkipVoiceTrackBridgeRef.current = onRequestSkipVoiceTrackBridge;
    const vtOverlayStartedRef = useRef(false);
    const vtBridgeHandoffRef = useRef(false);
    /** Asset del VT en curso (para ignorar el ítem intermedio en cola tras el 1.er skip). */
    const vtBridgeIgnoreAssetIdRef = useRef<string | null>(null);
    const leadDeckRef = useRef<0 | 1>(0);
    const transitionRef = useRef<{
      gen: number;
      outDeck: 0 | 1;
      inDeck: 0 | 1;
      expectedNextId: string;
    } | null>(null);
    const crossfadeGenRef = useRef(0);
    const prevCurrentIdRef = useRef<string | null>(null);
    const initRef = useRef(false);
    /** Operador inició transmisión manualmente; tras eso las pistas siguientes suenan solas. */
    const transmissionArmedRef = useRef(false);
    const seekedToCueRef = useRef<string | null>(null);
    const vuSmoothRef = useRef(0);
    const vuSmoothLRef = useRef(0);
    const vuSmoothRRef = useRef(0);
    const vuFillRef = useRef<HTMLDivElement | null>(null);
    const vuDbRef = useRef<HTMLSpanElement | null>(null);
    const ipcTickRef = useRef(0);
    const onBusMeterFrameRef = useRef(onBusMeterFrame);
    onBusMeterFrameRef.current = onBusMeterFrame;
    const onLeadAssetIdChangeRef = useRef(onLeadAssetIdChange);
    onLeadAssetIdChangeRef.current = onLeadAssetIdChange;

    const currentCuesRef = useRef(
      normalizeClientCues(currentDurationSec, currentCueStartSec, currentCueEndSec),
    );
    currentCuesRef.current = normalizeClientCues(
      currentDurationSec,
      currentCueStartSec,
      currentCueEndSec,
    );
    const nextCuesRef = useRef(normalizeClientCues(nextDurationSec, nextCueStartSec, nextCueEndSec));
    nextCuesRef.current = normalizeClientCues(nextDurationSec, nextCueStartSec, nextCueEndSec);

    const getDeckAudio = (d: 0 | 1) => (d === 0 ? a0Ref.current : a1Ref.current);

    const applyDuckGain = useCallback((g: Graph, ramp = true) => {
      const duckDb = bridgeDuckDbRef.current ?? referenceDuckDbRef.current;
      const t = g.ctx.currentTime;
      const targetLin = duckDb !== 0 ? dbToLinear(duckDb) : 1;
      if (!ramp) {
        g.duck.gain.setValueAtTime(targetLin, t);
        return;
      }
      const rampSec = duckDb === 0 ? DEFAULT_DUCK_RELEASE_RAMP_SEC : DEFAULT_DUCK_ATTACK_RAMP_SEC;
      g.duck.gain.cancelScheduledValues(t);
      g.duck.gain.setValueAtTime(g.duck.gain.value, t);
      g.duck.gain.linearRampToValueAtTime(targetLin, t + rampSec);
    }, []);

    const stopVtOverlay = useCallback((releaseDuck = true) => {
      const vtEl = aVtRef.current;
      vtEl?.pause();
      vtEl?.removeAttribute("src");
      vtEl?.load();
      const g = graphRef.current;
      if (g) {
        const t = g.ctx.currentTime;
        g.vtGain.gain.cancelScheduledValues(t);
        g.vtGain.gain.setValueAtTime(0, t);
        if (releaseDuck) {
          bridgeDuckDbRef.current = null;
          applyDuckGain(g);
        }
      }
      vtOverlayStartedRef.current = false;
    }, [applyDuckGain]);

    const ensureGraph = useCallback((): Graph | null => {
      if (graphRef.current) return graphRef.current;
      const el0 = a0Ref.current;
      const el1 = a1Ref.current;
      const elVt = aVtRef.current;
      if (!el0 || !el1 || !elVt) return null;
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      const master = ctx.createGain();
      const agcGain = ctx.createGain();
      agcGain.gain.value = 1;
      const compressor = ctx.createDynamicsCompressor();
      const limiter = ctx.createDynamicsCompressor();
      const eqLow = ctx.createBiquadFilter();
      eqLow.type = "lowshelf";
      eqLow.frequency.value = 200;
      const eqMid = ctx.createBiquadFilter();
      eqMid.type = "peaking";
      eqMid.frequency.value = 1000;
      eqMid.Q.value = 1;
      const eqHigh = ctx.createBiquadFilter();
      eqHigh.type = "highshelf";
      eqHigh.frequency.value = 4000;
      const duck = ctx.createGain();
      duck.gain.value = 1;
      const g0 = ctx.createGain();
      const g1 = ctx.createGain();
      const vtGain = ctx.createGain();
      vtGain.gain.value = 0;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.55;
      el0.volume = 1;
      el1.volume = 1;
      elVt.volume = 1;
      const src0 = ctx.createMediaElementSource(el0);
      const src1 = ctx.createMediaElementSource(el1);
      const srcVt = ctx.createMediaElementSource(elVt);
      src0.connect(g0);
      src1.connect(g1);
      srcVt.connect(vtGain);
      g0.connect(master);
      g1.connect(master);
      master.connect(agcGain);
      agcGain.connect(compressor);
      compressor.connect(limiter);
      limiter.connect(eqLow);
      eqLow.connect(eqMid);
      eqMid.connect(eqHigh);
      eqHigh.connect(duck);
      duck.connect(analyser);
      // VT post-duck: la cama se atenúa; la locución queda a nivel pleno.
      vtGain.connect(analyser);
      analyser.connect(ctx.destination);
      graphRef.current = {
        ctx,
        master,
        agcGain,
        compressor,
        limiter,
        eqLow,
        eqMid,
        eqHigh,
        duck,
        g0,
        g1,
        vtGain,
        analyser,
      };
      applyCabFxToGraph(graphRef.current);
      applyCabDynamicsToGraph(graphRef.current, loadCabDynamics());
      applyCabFxToGraph(graphRef.current);
      applyDuckGain(graphRef.current, false);
      return graphRef.current;
    }, [applyDuckGain]);

    useEffect(() => {
      const onFx = () => {
        const g = graphRef.current;
        if (g) applyCabFxToGraph(g);
      };
      const onDyn = () => {
        const g = graphRef.current;
        if (g) applyCabDynamicsToGraph(g, loadCabDynamics());
      };
      window.addEventListener(CAB_FX_EVENT, onFx);
      window.addEventListener(CAB_DYNAMICS_EVENT, onDyn);
      return () => {
        window.removeEventListener(CAB_FX_EVENT, onFx);
        window.removeEventListener(CAB_DYNAMICS_EVENT, onDyn);
      };
    }, []);

    const applyMaster = useCallback(() => {
      const g = graphRef.current;
      if (!g) return;
      const t = g.ctx.currentTime;
      const lin = dockMuted ? 0 : 1;
      g.master.gain.cancelScheduledValues(t);
      g.master.gain.setValueAtTime(lin, t);
    }, [dockMuted]);

    const setDeckGainsImmediate = useCallback(
      (lead: 0 | 1, leadAssetDb: number, softStart = false) => {
        const g = graphRef.current;
        if (!g) return;
        const t = g.ctx.currentTime;
        const linLead = combinedLinear(stationGainDb, leadAssetDb);
        const follow = (lead ^ 1) as 0 | 1;
        const leadGn = lead === 0 ? g.g0 : g.g1;
        const followGn = follow === 0 ? g.g0 : g.g1;
        g.g0.gain.cancelScheduledValues(t);
        g.g1.gain.cancelScheduledValues(t);
        followGn.gain.setValueAtTime(0, t);
        if (softStart) {
          // Evita click/zumbido al arrancar o tras seek a cueStart.
          leadGn.gain.setValueAtTime(0, t);
          leadGn.gain.linearRampToValueAtTime(linLead, t + 0.08);
        } else {
          leadGn.gain.setValueAtTime(linLead, t);
        }
      },
      [stationGainDb],
    );

    const stopTransition = useCallback(() => {
      transitionRef.current = null;
      crossfadeGenRef.current += 1;
    }, []);

    /** Corta el deck entrante si un spot diferido se insertó a mitad del crossfade. */
    const abortIncomingCrossfade = useCallback(() => {
      const tr = transitionRef.current;
      stopTransition();
      if (!tr) return;
      const followEl = getDeckAudio(tr.inDeck);
      followEl?.pause();
      followEl?.removeAttribute("src");
      followEl?.load();
      const g = graphRef.current;
      if (g) {
        const t = g.ctx.currentTime;
        const inGn = tr.inDeck === 0 ? g.g0 : g.g1;
        const outGn = tr.outDeck === 0 ? g.g0 : g.g1;
        inGn.gain.cancelScheduledValues(t);
        inGn.gain.setValueAtTime(0, t);
        outGn.gain.cancelScheduledValues(t);
        outGn.gain.setValueAtTime(combinedLinear(stationGainDb, currentPlaybackGainDb), t);
      }
      leadDeckRef.current = tr.outDeck;
      onLeadAssetIdChangeRef.current?.(currentAssetId);
    }, [currentAssetId, currentPlaybackGainDb, stationGainDb, stopTransition]);

    const hardReloadCurrent = useCallback(async (shouldPlay = false) => {
      stopTransition();
      stopVtOverlay();
      vtBridgeHandoffRef.current = false;
      vtBridgeIgnoreAssetIdRef.current = null;
      const g = ensureGraph();
      const lead = leadDeckRef.current;
      const leadEl = getDeckAudio(lead);
      const follow = (lead ^ 1) as 0 | 1;
      const followEl = getDeckAudio(follow);
      if (!g || !leadEl || !followEl) return;
      // Silenciar siempre el deck secundario (evita canción mezclada con locución/intro).
      followEl.pause();
      followEl.removeAttribute("src");
      followEl.load();
      setDeckGainsImmediate(lead, currentPlaybackGainDb, true);
      leadEl.src = streamSrc(currentAssetId);
      leadEl.load();
      seekedToCueRef.current = null;
      onLeadAssetIdChangeRef.current?.(currentAssetId);
      applyMaster();
      const gAfter = graphRef.current;
      if (gAfter) {
        applyDuckGain(gAfter, false);
        // Evita que el AGC arranque amplificado tras un silencio (zumbido al inicio).
        try {
          gAfter.agcGain.gain.setValueAtTime(1, gAfter.ctx.currentTime);
        } catch {
          /* */
        }
      }
      if (shouldPlay) {
        try {
          await leadEl.play();
        } catch {
          /* gesto del operador requerido */
        }
      }
      const cues = currentCuesRef.current;
      if (cues && cues.cueStartSec > 0.05) {
        const seek = () => {
          if (seekedToCueRef.current === currentAssetId) return;
          if (leadEl.readyState >= 1) {
            try {
              leadEl.currentTime = cues.cueStartSec;
              seekedToCueRef.current = currentAssetId;
            } catch {
              /* */
            }
          }
        };
        seek();
        leadEl.addEventListener("loadedmetadata", seek, { once: true });
      } else {
        seekedToCueRef.current = currentAssetId;
      }
    }, [applyDuckGain, applyMaster, currentAssetId, currentPlaybackGainDb, ensureGraph, setDeckGainsImmediate, stopTransition, stopVtOverlay]);

    useEffect(() => {
      applyMaster();
    }, [applyMaster]);

    useEffect(() => {
      const g = graphRef.current;
      if (!g) return;
      applyDuckGain(g);
    }, [applyDuckGain, referenceDuckDb]);

    useEffect(() => {
      if (transitionRef.current) return;
      setDeckGainsImmediate(leadDeckRef.current, currentPlaybackGainDb);
    }, [currentPlaybackGainDb, setDeckGainsImmediate, stationGainDb]);

    useEffect(() => {
      if (prevCurrentIdRef.current === null) {
        prevCurrentIdRef.current = currentAssetId;
        return;
      }
      if (currentAssetId === prevCurrentIdRef.current) return;

      // Skip intermedio del bridge: la cola pasa por el VT un instante; no recargar decks.
      if (
        vtBridgeHandoffRef.current &&
        vtBridgeIgnoreAssetIdRef.current &&
        currentAssetId === vtBridgeIgnoreAssetIdRef.current
      ) {
        return;
      }

      const tr = transitionRef.current;
      prevCurrentIdRef.current = currentAssetId;
      if (tr && tr.expectedNextId === currentAssetId) {
        const g = graphRef.current;
        const outEl = getDeckAudio(tr.outDeck);
        const inDeck = tr.inDeck;
        outEl?.pause();
        outEl?.removeAttribute("src");
        outEl?.load();
        stopTransition();
        vtBridgeHandoffRef.current = false;
        vtBridgeIgnoreAssetIdRef.current = null;
        leadDeckRef.current = inDeck;
        seekedToCueRef.current = currentAssetId;
        onLeadAssetIdChangeRef.current?.(currentAssetId);
        if (g) {
          const t = g.ctx.currentTime;
          const inGn = inDeck === 0 ? g.g0 : g.g1;
          const outGn = tr.outDeck === 0 ? g.g0 : g.g1;
          outGn.gain.cancelScheduledValues(t);
          outGn.gain.setValueAtTime(0, t);
          inGn.gain.cancelScheduledValues(t);
          inGn.gain.setValueAtTime(combinedLinear(stationGainDb, currentPlaybackGainDb), t);
        }
        return;
      }
      // Cambio inesperado (p. ej. locución tras XF a otra canción por Cr.p.): silenciar ambos decks.
      abortIncomingCrossfade();
      leadDeckRef.current = 0;
      void hardReloadCurrent(transmissionArmedRef.current);
    }, [
      abortIncomingCrossfade,
      currentAssetId,
      currentPlaybackGainDb,
      hardReloadCurrent,
      stationGainDb,
      stopTransition,
    ]);

    // Prefetch bloqueado (locución/intro/jingle encolados): no dejar que el XF mezcle la canción B encima.
    useEffect(() => {
      if (!transitionRef.current) return;
      if (!nextAssetId) abortIncomingCrossfade();
    }, [nextAssetId, abortIncomingCrossfade]);

    const startVoiceTrackOverlay = useCallback(async () => {
      const bridge = voiceTrackBridgeRef.current;
      if (!bridge || vtOverlayStartedRef.current) return;
      const g = ensureGraph();
      const vtEl = aVtRef.current;
      if (!g || !vtEl) return;

      const lead = leadDeckRef.current;
      const outEl = getDeckAudio(lead);
      if (!outEl) return;
      const fileDur = Number.isFinite(outEl.duration) && outEl.duration > 0 ? outEl.duration : 0;
      const cues =
        currentCuesRef.current ??
        (fileDur > 0 ? { cueStartSec: 0, cueEndSec: fileDur } : null);
      if (!cues) return;
      const triggerAt = voiceTrackOverlayTriggerAt(cues, bridge.outroWindowSec);
      if (outEl.currentTime + 0.05 < triggerAt) return;

      vtOverlayStartedRef.current = true;
      bridgeDuckDbRef.current = bridge.duckDb;
      applyDuckGain(g);

      vtEl.src = streamSrc(bridge.assetId);
      vtEl.load();
      const t = g.ctx.currentTime;
      g.vtGain.gain.cancelScheduledValues(t);
      g.vtGain.gain.setValueAtTime(combinedLinear(stationGainDb, bridge.gainDb), t);
      try {
        await vtEl.play();
      } catch {
        stopVtOverlay();
      }
    }, [applyDuckGain, ensureGraph, stationGainDb, stopVtOverlay]);

    const startVoiceTrackHandoff = useCallback(async () => {
      const bridge = voiceTrackBridgeRef.current;
      if (!bridge || !nextAssetId || vtBridgeHandoffRef.current || transitionRef.current) return;
      const g = ensureGraph();
      const lead = leadDeckRef.current;
      const outEl = getDeckAudio(lead);
      const inDeck = (lead ^ 1) as 0 | 1;
      const inEl = getDeckAudio(inDeck);
      if (!g || !outEl || !inEl) return;

      const fileDur = Number.isFinite(outEl.duration) && outEl.duration > 0 ? outEl.duration : 0;
      const cues =
        currentCuesRef.current ??
        (fileDur > 0 ? { cueStartSec: 0, cueEndSec: fileDur } : null);
      if (!cues) return;
      if (outEl.currentTime + 0.08 < cues.cueEndSec) return;

      vtBridgeHandoffRef.current = true;
      vtBridgeIgnoreAssetIdRef.current = bridge.assetId;
      if (!vtOverlayStartedRef.current) {
        void startVoiceTrackOverlay();
      }

      const gen = crossfadeGenRef.current + 1;
      crossfadeGenRef.current = gen;

      const fadeDur = Math.min(1.2, Math.max(0.35, bridge.outroWindowSec * 0.35));
      const t0 = g.ctx.currentTime;
      const outGn = lead === 0 ? g.g0 : g.g1;
      const inGn = inDeck === 0 ? g.g0 : g.g1;
      const nextCues = nextCuesRef.current;
      const nextStart = nextCues?.cueStartSec ?? 0;

      inEl.src = streamSrc(nextAssetId);
      inEl.load();
      const seekNext = () => {
        if (nextStart > 0.05) {
          try {
            inEl.currentTime = nextStart;
          } catch {
            /* */
          }
        }
      };
      inEl.addEventListener("loadedmetadata", seekNext, { once: true });
      try {
        await inEl.play();
        seekNext();
      } catch {
        vtBridgeHandoffRef.current = false;
        return;
      }
      if (gen !== crossfadeGenRef.current) return;

      transitionRef.current = { gen, outDeck: lead, inDeck, expectedNextId: nextAssetId };
      onLeadAssetIdChangeRef.current?.(nextAssetId);

      const outLin = combinedLinear(stationGainDb, currentPlaybackGainDb);
      const inLin = combinedLinear(stationGainDb, nextPlaybackGainDb);
      outGn.gain.cancelScheduledValues(t0);
      inGn.gain.cancelScheduledValues(t0);
      outGn.gain.setValueAtTime(outLin, t0);
      outGn.gain.linearRampToValueAtTime(0, t0 + fadeDur);
      inGn.gain.setValueAtTime(0, t0);
      inGn.gain.linearRampToValueAtTime(inLin, t0 + fadeDur);

      window.setTimeout(() => {
        if (gen !== crossfadeGenRef.current) return;
        if (transitionRef.current?.gen !== gen) return;
        const skipBridge = onRequestSkipVoiceTrackBridgeRef.current;
        if (skipBridge) void skipBridge();
        else void onRequestSkip();
      }, Math.ceil(fadeDur * 1000) + 80);
    }, [
      currentPlaybackGainDb,
      ensureGraph,
      nextAssetId,
      nextPlaybackGainDb,
      onRequestSkip,
      startVoiceTrackOverlay,
      stationGainDb,
    ]);

    const startCrossfade = useCallback(async () => {
      // Sin siguiente o XF desactivado (p. ej. locución a continuación): no mezclar.
      if (!nextAssetId || transitionRef.current || crossfadeSec <= 0.05) return;
      if (voiceTrackBridgeRef.current) return;
      const g = ensureGraph();
      const lead = leadDeckRef.current;
      const outEl = getDeckAudio(lead);
      const inDeck = (lead ^ 1) as 0 | 1;
      const inEl = getDeckAudio(inDeck);
      if (!g || !outEl || !inEl) return;

      const fileDur = Number.isFinite(outEl.duration) && outEl.duration > 0 ? outEl.duration : 0;
      const rawCues =
        currentCuesRef.current ??
        (fileDur > 0 ? { cueStartSec: 0, cueEndSec: fileDur } : null);
      if (!rawCues) return;
      const cues = fileDur > 0 ? clampCuesToFileDuration(rawCues, fileDur) : rawCues;

      const ct = outEl.currentTime;
      const overlap = crossfadeOverlapSec(cues.cueEndSec, cues.cueStartSec, crossfadeSec);
      const triggerAt = mixTriggerAt(cues.cueEndSec, cues.cueStartSec, overlap);
      if (ct + 0.05 < triggerAt) return;

      const remToCueEnd = Math.max(0.12, cues.cueEndSec - ct);
      // Fundido de duración estándar (= solape configurado), acotado al resto de pista.
      const fadeDur = Math.min(overlap, remToCueEnd);

      const gen = crossfadeGenRef.current + 1;
      crossfadeGenRef.current = gen;

      const t0 = g.ctx.currentTime;
      const outGn = lead === 0 ? g.g0 : g.g1;
      const inGn = inDeck === 0 ? g.g0 : g.g1;

      const nextCues = nextCuesRef.current;
      const nextStart = nextCues?.cueStartSec ?? 0;

      inEl.src = streamSrc(nextAssetId);
      inEl.load();
      const seekNext = () => {
        if (nextStart > 0.05) {
          try {
            inEl.currentTime = nextStart;
          } catch {
            /* */
          }
        }
      };
      inEl.addEventListener("loadedmetadata", seekNext, { once: true });
      try {
        await inEl.play();
        seekNext();
      } catch {
        return;
      }
      if (gen !== crossfadeGenRef.current) return;

      transitionRef.current = { gen, outDeck: lead, inDeck, expectedNextId: nextAssetId };
      onLeadAssetIdChangeRef.current?.(nextAssetId);

      const outLin = combinedLinear(stationGainDb, currentPlaybackGainDb);
      const inLin = combinedLinear(stationGainDb, nextPlaybackGainDb);
      outGn.gain.cancelScheduledValues(t0);
      inGn.gain.cancelScheduledValues(t0);
      outGn.gain.setValueAtTime(outLin, t0);
      outGn.gain.linearRampToValueAtTime(0, t0 + fadeDur);
      inGn.gain.setValueAtTime(0, t0);
      inGn.gain.linearRampToValueAtTime(inLin, t0 + fadeDur);

      window.setTimeout(() => {
        if (gen !== crossfadeGenRef.current) return;
        if (transitionRef.current?.gen !== gen) return;
        void onRequestSkip();
      }, Math.ceil(fadeDur * 1000) + 100);
    }, [
      crossfadeSec,
      currentPlaybackGainDb,
      ensureGraph,
      nextAssetId,
      nextPlaybackGainDb,
      onRequestSkip,
      stationGainDb,
    ]);

    const onLeadTimeUpdate = useCallback(() => {
      const ld = leadDeckRef.current;
      const el = getDeckAudio(ld);
      if (!el) return;
      const fileDur = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0;
      const rawCues =
        currentCuesRef.current ??
        (fileDur > 0 ? { cueStartSec: 0, cueEndSec: fileDur } : null);
      const cues = rawCues && fileDur > 0 ? clampCuesToFileDuration(rawCues, fileDur) : rawCues;
      const c = el.currentTime;

      // Seek inicial a cueStart si aún no se aplicó
      if (
        cues &&
        cues.cueStartSec > 0.05 &&
        seekedToCueRef.current !== currentAssetId &&
        el.readyState >= 1 &&
        c < cues.cueStartSec - 0.2
      ) {
        try {
          el.currentTime = cues.cueStartSec;
          seekedToCueRef.current = currentAssetId;
        } catch {
          /* */
        }
      }

      // Archivo ya acabó (p. ej. durationSec de BD > duración real): no esperar cueEnd fantasma.
      if (el.ended || (fileDur > 0.5 && c >= fileDur - 0.05 && !transitionRef.current)) {
        if (voiceTrackBridgeRef.current) {
          void startVoiceTrackHandoff();
          return;
        }
        void onRequestSkip();
        return;
      }

      const usableDur = cues ? Math.max(0.1, cues.cueEndSec - cues.cueStartSec) : fileDur;
      const rel =
        cues != null ? Math.max(0, c - cues.cueStartSec) : c;
      onLeadTick(rel, usableDur);

      const bridge = voiceTrackBridgeRef.current;
      if (bridge && cues && !transitionRef.current) {
        void startVoiceTrackOverlay();
        if (c >= cues.cueEndSec - 0.04) {
          void startVoiceTrackHandoff();
          return;
        }
        return;
      }

      // Fin de cueEnd: si no hay siguiente o crossfade desactivado (locución a continuación), skip limpio
      if (cues && c >= cues.cueEndSec - 0.04) {
        if (transitionRef.current) return;
        if (crossfadeSec > 0.05 && nextAssetId) {
          void startCrossfade();
        } else {
          void onRequestSkip();
        }
        return;
      }

      if (crossfadeSec > 0.05 && nextAssetId) void startCrossfade();
    }, [
      crossfadeSec,
      currentAssetId,
      nextAssetId,
      onLeadTick,
      onRequestSkip,
      startCrossfade,
      startVoiceTrackHandoff,
      startVoiceTrackOverlay,
    ]);

    const onDeckEnded = useCallback(
      (deck: 0 | 1) => {
        if (deck !== leadDeckRef.current) return;
        if (transitionRef.current) return;
        if (voiceTrackBridgeRef.current) {
          void startVoiceTrackHandoff();
          return;
        }
        void onRequestSkip();
      },
      [onRequestSkip, startVoiceTrackHandoff],
    );

    const onVtEnded = useCallback(() => {
      const g = graphRef.current;
      bridgeDuckDbRef.current = null;
      if (g) applyDuckGain(g);
      const vtEl = aVtRef.current;
      vtEl?.removeAttribute("src");
      vtEl?.load();
      if (g) {
        const t = g.ctx.currentTime;
        g.vtGain.gain.cancelScheduledValues(t);
        g.vtGain.gain.setValueAtTime(0, t);
      }
      vtOverlayStartedRef.current = false;
    }, [applyDuckGain]);

    useImperativeHandle(
      ref,
      () => ({
        play: async () => {
          transmissionArmedRef.current = true;
          const g = ensureGraph();
          if (g?.ctx.state === "suspended") await g.ctx.resume();
          const lead = leadDeckRef.current;
          let el = getDeckAudio(lead);
          if (el && !el.src && !el.getAttribute("src")) {
            await hardReloadCurrent(false);
            el = getDeckAudio(leadDeckRef.current);
          }
          if (el) await el.play().catch(() => {});
        },
        pause: () => {
          transmissionArmedRef.current = false;
          getDeckAudio(0)?.pause();
          getDeckAudio(1)?.pause();
          stopVtOverlay();
        },
        getLeadAudio: () => getDeckAudio(leadDeckRef.current),
      }),
      [ensureGraph, hardReloadCurrent, stopVtOverlay],
    );

    useEffect(() => {
      if (initRef.current) return;
      initRef.current = true;
      void hardReloadCurrent(false);
      // eslint-disable-next-line react-hooks/exhaustive-deps -- arranque único sin autoplay
    }, []);

    /** Medición tipo VU en el bus post-master (incluye mute y ganancias). */
    useEffect(() => {
      let raf = 0;
      let stopped = false;
      const buf = new Float32Array(2048);
      const tick = () => {
        if (stopped) return;
        raf = requestAnimationFrame(tick);
        const g = graphRef.current;
        if (!g?.analyser) {
          onBusMeterFrameRef.current?.({ peak01: 0, peak01L: 0, peak01R: 0, dbFs: null });
          return;
        }
        g.analyser.getFloatTimeDomainData(buf);
        const halves = splitWaveformHalfPeaks(buf);
        let peak = halves.peakL;
        if (halves.peakR > peak) peak = halves.peakR;
        const instantMono = Math.min(1, peak * 1.15);
        const instantL = Math.min(1, halves.peakL * 1.15);
        const instantR = Math.min(1, halves.peakR * 1.15);
        const prev = vuSmoothRef.current;
        const smoothMono = instantMono > prev ? instantMono : prev * 0.94;
        vuSmoothRef.current = smoothMono;
        const prevL = vuSmoothLRef.current;
        const prevR = vuSmoothRRef.current;
        const smoothL = instantL > prevL ? instantL : prevL * 0.94;
        const smoothR = instantR > prevR ? instantR : prevR * 0.94;
        vuSmoothLRef.current = smoothL;
        vuSmoothRRef.current = smoothR;
        const smooth = Math.max(smoothMono, smoothL, smoothR);
        const pct = Math.min(100, Math.round(smooth * 100));
        const elFill = vuFillRef.current;
        const elDb = vuDbRef.current;
        if (elFill) elFill.style.width = `${pct}%`;
        let db: number | null = null;
        if (elDb) {
          db = smooth > 1e-5 ? 20 * Math.log10(smooth) : null;
          elDb.textContent = db != null && Number.isFinite(db) ? `${db.toFixed(1)} dBFS` : "—";
        }
        ipcTickRef.current += 1;
        tryPushCabMeterIpc(smooth, db, ipcTickRef.current);
        onBusMeterFrameRef.current?.({
          peak01: smooth,
          peak01L: vuSmoothLRef.current,
          peak01R: vuSmoothRRef.current,
          dbFs: db,
        });

        const dyn = loadCabDynamics();
        if (dyn.agcEnabled && g.agcGain) {
          const target = 0.28;
          const cur = g.agcGain.gain.value;
          if (smooth < target * 0.45 && cur < 3.5) {
            g.agcGain.gain.value = Math.min(3.5, cur * 1.015);
          } else if (smooth > target * 1.4 && cur > 0.35) {
            g.agcGain.gain.value = Math.max(0.35, cur * 0.985);
          }
        }
      };
      raf = requestAnimationFrame(tick);
      return () => {
        stopped = true;
        cancelAnimationFrame(raf);
      };
    }, []);

    return (
      <div className="cab-ref-wrap">
        <div className="cab-bus-meter" aria-label="Nivel del bus de referencia Web Audio" title="Pico aproximado en el bus (post-ganancias). No es medición broadcast calibrada.">
          <span className="cab-bus-meter-label mono small">VU</span>
          <div className="cab-bus-meter-track">
            <div ref={vuFillRef} className="cab-bus-meter-fill" style={{ width: "0%" }} />
          </div>
          <span ref={vuDbRef} className="cab-bus-meter-db mono small muted">
            —
          </span>
        </div>
        <div className="cab-ref-decks">
        <audio
          ref={a0Ref}
          className="station-player-audio cab-ref-deck"
          crossOrigin="anonymous"
          preload="auto"
          onTimeUpdate={() => {
            if (leadDeckRef.current === 0) onLeadTimeUpdate();
          }}
          onLoadedMetadata={() => {
            if (leadDeckRef.current === 0) onLeadTimeUpdate();
          }}
          onEnded={() => onDeckEnded(0)}
        />
        <audio
          ref={a1Ref}
          className="station-player-audio cab-ref-deck"
          crossOrigin="anonymous"
          preload="auto"
          onTimeUpdate={() => {
            if (leadDeckRef.current === 1) onLeadTimeUpdate();
          }}
          onLoadedMetadata={() => {
            if (leadDeckRef.current === 1) onLeadTimeUpdate();
          }}
          onEnded={() => onDeckEnded(1)}
        />
        <audio
          ref={aVtRef}
          className="station-player-audio cab-ref-vt"
          crossOrigin="anonymous"
          preload="auto"
          onEnded={onVtEnded}
        />
        </div>
      </div>
    );
  },
);
