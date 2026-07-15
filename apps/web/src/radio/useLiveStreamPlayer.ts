import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  detectLocalDevHost,
  shouldReconnectOnMediaError,
  streamCandidates,
  type LiveStreamEnv,
} from "./live-stream-urls";

const SESSION_KEY = "radioflow.radio.wantPlay";

/**
 * Reproductor de stream Icecast/AzuraCast.
 *
 * INVARIANTES (no romper):
 * - El botón UI = wantPlay (intención del usuario), NUNCA onPause/onError del <audio>.
 * - No llamar audio.load() vacío tras quitar src (Firefox + Icecast aborta).
 * - Volumen al valor del usuario al conectar (nunca fade que deje volume=0).
 * - onError solo reconecta si shouldReconnectOnMediaError(...).
 * - Generación playGen invalida reconnects viejos tras stop o nuevo play.
 */
export function useLiveStreamPlayer(streamOverride = "") {
  const env: LiveStreamEnv = useMemo(
    () => ({ isLocalDev: detectLocalDevHost() }),
    [],
  );
  const streamUrls = useMemo(
    () => streamCandidates(streamOverride, env),
    [streamOverride, env],
  );

  const [wantPlay, setWantPlay] = useState(false);
  const [volume, setVolume] = useState(0.9);
  const [audioErr, setAudioErr] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement>(null);
  const wantPlayRef = useRef(wantPlay);
  const volumeRef = useRef(volume);
  const streamUrlsRef = useRef(streamUrls);
  const playGenRef = useRef(0);
  const reconnectTimer = useRef<number | null>(null);
  const activeUrlRef = useRef("");

  wantPlayRef.current = wantPlay;
  volumeRef.current = volume;
  streamUrlsRef.current = streamUrls;

  const persistWantPlay = useCallback((v: boolean) => {
    try {
      if (v) sessionStorage.setItem(SESSION_KEY, "1");
      else sessionStorage.removeItem(SESSION_KEY);
    } catch {
      /* private mode */
    }
  }, []);

  const clearReconnect = useCallback(() => {
    if (reconnectTimer.current != null) {
      window.clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
  }, []);

  useEffect(() => () => clearReconnect(), [clearReconnect]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.volume = volume;
  }, [volume]);

  const stopPlayback = useCallback(() => {
    playGenRef.current += 1;
    wantPlayRef.current = false;
    setWantPlay(false);
    persistWantPlay(false);
    clearReconnect();
    const el = audioRef.current;
    if (el) el.pause();
    setAudioErr(null);
  }, [clearReconnect, persistWantPlay]);

  const connectUrl = useCallback(async (gen: number, url: string): Promise<boolean> => {
    const el = audioRef.current;
    if (!el || gen !== playGenRef.current || !wantPlayRef.current) return false;
    try {
      if (activeUrlRef.current !== url || !el.src) {
        el.src = url;
        activeUrlRef.current = url;
      }
      el.volume = volumeRef.current;
      await el.play();
      if (gen !== playGenRef.current || !wantPlayRef.current) return false;
      el.volume = volumeRef.current;
      setAudioErr(null);
      return true;
    } catch (e) {
      if (e instanceof DOMException && e.name === "NotAllowedError") {
        wantPlayRef.current = false;
        setWantPlay(false);
        persistWantPlay(false);
        setAudioErr("Pulse reproducir de nuevo para autorizar el audio.");
        return false;
      }
      return false;
    }
  }, [persistWantPlay]);

  const scheduleReconnect = useCallback(() => {
    if (!wantPlayRef.current) return;
    if (reconnectTimer.current != null) return;
    const gen = playGenRef.current;
    reconnectTimer.current = window.setTimeout(() => {
      reconnectTimer.current = null;
      if (!wantPlayRef.current || gen !== playGenRef.current) return;
      const urls = streamUrlsRef.current;
      const cur = activeUrlRef.current;
      const idx = Math.max(0, urls.indexOf(cur));
      const next = urls[(idx + 1) % Math.max(1, urls.length)] ?? urls[0];
      if (!next) return;
      activeUrlRef.current = "";
      void connectUrl(gen, next).then((ok) => {
        if (!ok && wantPlayRef.current && gen === playGenRef.current) scheduleReconnect();
      });
    }, 1_200);
  }, [connectUrl]);

  const startPlayback = useCallback(async () => {
    const el = audioRef.current;
    if (!el) return;

    const gen = ++playGenRef.current;
    clearReconnect();
    setAudioErr(null);
    wantPlayRef.current = true;
    setWantPlay(true);
    persistWantPlay(true);

    const urls = streamUrlsRef.current;
    for (const url of urls) {
      if (gen !== playGenRef.current || !wantPlayRef.current) return;
      activeUrlRef.current = "";
      const ok = await connectUrl(gen, url);
      if (ok) return;
    }

    if (gen !== playGenRef.current || !wantPlayRef.current) return;
    scheduleReconnect();
  }, [clearReconnect, connectUrl, scheduleReconnect, persistWantPlay]);

  const startPlaybackRef = useRef(startPlayback);
  startPlaybackRef.current = startPlayback;

  // Tras HMR / remount: si había play activo en esta pestaña, reenganchar una sola vez.
  useEffect(() => {
    let saved = false;
    try {
      saved = sessionStorage.getItem(SESSION_KEY) === "1";
    } catch {
      /* ignore */
    }
    if (!saved) return;
    const id = window.setTimeout(() => {
      void startPlaybackRef.current();
    }, 150);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.setActionHandler("play", () => {
      void startPlayback();
    });
    navigator.mediaSession.setActionHandler("pause", () => {
      stopPlayback();
    });
    return () => {
      navigator.mediaSession.setActionHandler("play", null);
      navigator.mediaSession.setActionHandler("pause", null);
    };
  }, [startPlayback, stopPlayback]);

  function togglePlay() {
    if (wantPlayRef.current) {
      stopPlayback();
      return;
    }
    void startPlayback();
  }

  function onAudioPlaying() {
    if (wantPlayRef.current) setAudioErr(null);
  }

  function onAudioError() {
    if (
      !shouldReconnectOnMediaError({
        wantPlay: wantPlayRef.current,
        paused: audioRef.current?.paused ?? true,
        readyState: audioRef.current?.readyState ?? 0,
      })
    ) {
      return;
    }
    scheduleReconnect();
  }

  return {
    audioRef,
    wantPlay,
    volume,
    setVolume,
    audioErr,
    togglePlay,
    startPlayback,
    stopPlayback,
    onAudioPlaying,
    onAudioError,
    streamUrls,
  };
}
