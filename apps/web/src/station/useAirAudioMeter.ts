import { useEffect, useRef, type RefObject } from "react";
import type { CabBusMeterFrame } from "./CabReferencePlayer";
import { splitWaveformHalfPeaks } from "./vu-waveform-peaks";

type AirMeterGraph = {
  ctx: AudioContext;
  src: MediaElementAudioSourceNode;
  gain: GainNode;
  analyser: AnalyserNode;
};

/**
 * VU aproximado en el audio del `<audio>` nativo (sin motor Web Audio cabina).
 * Un solo `MediaElementSource` por elemento; se limpia al desactivar o cambiar pista.
 * Cadena: elemento → ganancia (mute) → analizador → salida, para que el medidor refleje lo escuchado.
 */
export function useAirAudioMeter(
  mediaRef: RefObject<HTMLMediaElement | null>,
  enabled: boolean,
  muted: boolean,
  resetKey: string,
  onFrame: (sample: CabBusMeterFrame) => void,
) {
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  const graphRef = useRef<AirMeterGraph | null>(null);

  useEffect(() => {
    if (!enabled) {
      onFrameRef.current({ peak01: 0, peak01L: 0, peak01R: 0, dbFs: null });
      return;
    }

    const el = mediaRef.current;
    if (!el) {
      onFrameRef.current({ peak01: 0, peak01L: 0, peak01R: 0, dbFs: null });
      return;
    }

    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    let ctx: AudioContext;
    try {
      ctx = new Ctx();
    } catch {
      onFrameRef.current({ peak01: 0, peak01L: 0, peak01R: 0, dbFs: null });
      return;
    }

    let src: MediaElementAudioSourceNode;
    try {
      src = ctx.createMediaElementSource(el);
    } catch {
      void ctx.close().catch(() => {});
      onFrameRef.current({ peak01: 0, peak01L: 0, peak01R: 0, dbFs: null });
      return;
    }

    const gain = ctx.createGain();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.55;
    src.connect(gain);
    gain.connect(analyser);
    analyser.connect(ctx.destination);

    graphRef.current = { ctx, src, gain, analyser };

    const t0 = ctx.currentTime;
    gain.gain.setValueAtTime(muted ? 0 : 1, t0);

    const buf = new Float32Array(analyser.fftSize);
    let raf = 0;
    let vuSmooth = 0;
    let vuSmoothL = 0;
    let vuSmoothR = 0;
    let stopped = false;

    const tick = () => {
      if (stopped) return;
      raf = requestAnimationFrame(tick);
      analyser.getFloatTimeDomainData(buf);
      const halves = splitWaveformHalfPeaks(buf);
      let peak = halves.peakL;
      if (halves.peakR > peak) peak = halves.peakR;
      const instantMono = Math.min(1, peak * 1.15);
      const instantL = Math.min(1, halves.peakL * 1.15);
      const instantR = Math.min(1, halves.peakR * 1.15);
      vuSmooth = instantMono > vuSmooth ? instantMono : vuSmooth * 0.94;
      vuSmoothL = instantL > vuSmoothL ? instantL : vuSmoothL * 0.94;
      vuSmoothR = instantR > vuSmoothR ? instantR : vuSmoothR * 0.94;
      const overall = Math.max(vuSmooth, vuSmoothL, vuSmoothR);
      const db = overall > 1e-5 ? 20 * Math.log10(overall) : null;
      onFrameRef.current({ peak01: overall, peak01L: vuSmoothL, peak01R: vuSmoothR, dbFs: db });
    };

    const onPlay = () => {
      if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    };
    el.addEventListener("play", onPlay);

    raf = requestAnimationFrame(tick);

    return () => {
      stopped = true;
      el.removeEventListener("play", onPlay);
      cancelAnimationFrame(raf);
      graphRef.current = null;
      try {
        src.disconnect();
        gain.disconnect();
        analyser.disconnect();
      } catch {
        /* ya desconectado */
      }
      void ctx.close().catch(() => {});
      onFrameRef.current({ peak01: 0, peak01L: 0, peak01R: 0, dbFs: null });
    };
  }, [enabled, resetKey, mediaRef]);

  useEffect(() => {
    const g = graphRef.current;
    if (!g) return;
    const t = g.ctx.currentTime;
    g.gain.gain.cancelScheduledValues(t);
    g.gain.gain.setValueAtTime(muted ? 0 : 1, t);
  }, [muted]);
}
