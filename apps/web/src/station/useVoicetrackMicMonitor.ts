import { useCallback, useRef } from "react";
import { dbToLinear } from "./reference-duck";

/** Monitor local de voz (mic → auriculares) durante grabación de voicetrack. */
export function useVoicetrackMicMonitor() {
  const ctxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);

  const stop = useCallback(() => {
    try {
      sourceRef.current?.disconnect();
    } catch {
      /* ya desconectado */
    }
    sourceRef.current = null;
    try {
      gainRef.current?.disconnect();
    } catch {
      /* */
    }
    gainRef.current = null;
    const ctx = ctxRef.current;
    ctxRef.current = null;
    if (ctx && ctx.state !== "closed") void ctx.close();
  }, []);

  const setGainDb = useCallback((gainDb: number) => {
    if (gainRef.current) gainRef.current.gain.value = dbToLinear(gainDb);
  }, []);

  const start = useCallback(
    (stream: MediaStream, gainDb: number) => {
      stop();
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const gain = ctx.createGain();
      gain.gain.value = dbToLinear(gainDb);
      source.connect(gain);
      gain.connect(ctx.destination);
      void ctx.resume();
      ctxRef.current = ctx;
      sourceRef.current = source;
      gainRef.current = gain;
    },
    [stop],
  );

  return { start, stop, setGainDb };
}
