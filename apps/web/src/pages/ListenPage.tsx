import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { ApiPublicListen, ApiPublicNowPlaying } from "@radioflow/shared";
import { apiUrl, appPublicOrigin } from "../lib/api-base";
import { isDesktopShell } from "../lib/desktop-product";
import "./ListenPage.css";

const NOW_PLAYING_POLL_MS = 5_000;

function usePublicFetch<T>(path: string, enabled = true) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!enabled) return;
    try {
      const res = await fetch(apiUrl(path), { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()) as T);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    }
  }, [enabled, path]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, error, reload: load };
}

export function ListenPage() {
  const [params] = useSearchParams();
  const streamOverride = params.get("stream")?.trim() || "";
  const embed = params.get("embed") === "1" || params.get("embed") === "true";

  const { data: listen, error: listenErr } = usePublicFetch<ApiPublicListen>("/api/public/listen");
  const [nowPlaying, setNowPlaying] = useState<ApiPublicNowPlaying | null>(null);
  const [npErr, setNpErr] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(0.85);
  const [audioErr, setAudioErr] = useState<string | null>(null);

  const listenUrl = streamOverride || listen?.listenUrl || "";

  useEffect(() => {
    if (listen?.primaryColor) {
      document.documentElement.style.setProperty("--listen-accent", listen.primaryColor);
    }
    if (listen?.stationName) {
      document.title = embed ? listen.stationName : `${listen.stationName} · Escuchar`;
    }
  }, [embed, listen?.primaryColor, listen?.stationName]);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch(apiUrl("/api/public/now-playing"), { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (!cancelled) {
          setNowPlaying((await res.json()) as ApiPublicNowPlaying);
          setNpErr(null);
        }
      } catch (e) {
        if (!cancelled) setNpErr(e instanceof Error ? e.message : "Error");
      }
    }
    void poll();
    const id = window.setInterval(() => void poll(), NOW_PLAYING_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.volume = volume;
  }, [volume, listenUrl]);

  const now = nowPlaying?.now;
  const coverSrc = now?.coverUrl || listen?.stationLogoUrl || null;
  const embedSrc = useMemo(() => {
    const origin = appPublicOrigin();
    const q = streamOverride ? `?stream=${encodeURIComponent(streamOverride)}&embed=1` : "?embed=1";
    return `${origin}/listen${q}`;
  }, [streamOverride]);

  async function togglePlay() {
    const el = audioRef.current;
    if (!el || !listenUrl) return;
    setAudioErr(null);
    try {
      if (playing) {
        el.pause();
        setPlaying(false);
      } else {
        await el.play();
        setPlaying(true);
      }
    } catch (e) {
      setAudioErr(e instanceof Error ? e.message : "No se pudo reproducir");
      setPlaying(false);
    }
  }

  async function copyEmbed() {
    const code = `<iframe src="${embedSrc}" width="360" height="480" style="border:0;border-radius:12px" allow="autoplay" title="${listen?.stationName ?? "Radio"}"></iframe>`;
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className={`listen-page${embed ? " listen-page--embed" : ""}`}>
      {!embed && isDesktopShell() ? (
        <nav className="listen-back" aria-label="Volver">
          <Link to="/station" className="listen-back-btn">
            ← Cabina
          </Link>
        </nav>
      ) : null}
      <div className="listen-card">
        <header className="listen-header">
          {listen?.stationLogoUrl ? (
            <img className="listen-station-logo" src={listen.stationLogoUrl} alt="" width={40} height={40} />
          ) : (
            <span className="listen-station-logo-ph" aria-hidden>
              ♫
            </span>
          )}
          <div className="listen-header-text">
            <h1 className="listen-station-name">{listen?.stationName ?? "RadioFlow"}</h1>
            {listen?.tagline ? <p className="listen-tagline">{listen.tagline}</p> : null}
          </div>
        </header>

        <figure className="listen-cover-wrap">
          {coverSrc ? (
            <img className="listen-cover" src={coverSrc} alt="" width={320} height={320} />
          ) : (
            <div className="listen-cover listen-cover--empty" aria-hidden>
              ♫
            </div>
          )}
        </figure>

        <div className="listen-track" aria-live="polite">
          {now ? (
            <>
              <strong className="listen-title">{now.title}</strong>
              <span className="listen-artist">{now.artist?.trim() || "—"}</span>
              {now.album ? <span className="listen-album muted small">{now.album}</span> : null}
            </>
          ) : (
            <span className="listen-idle muted">{nowPlaying?.playing === false ? "Sin pista al aire" : "Cargando…"}</span>
          )}
        </div>

        {listenUrl ? (
          <>
            <audio
              ref={audioRef}
              className="listen-audio"
              src={listenUrl}
              preload="none"
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onError={() => setAudioErr("Error al conectar con el stream")}
            />
            <div className="listen-controls">
              <button type="button" className="listen-play-btn" onClick={() => void togglePlay()} aria-pressed={playing}>
                {playing ? "Pausar" : "Escuchar"}
              </button>
              <label className="listen-volume">
                <span className="sr-only">Volumen</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={volume}
                  onChange={(e) => setVolume(Number(e.target.value))}
                />
              </label>
            </div>
          </>
        ) : (
          <p className="listen-warn muted">
            {listenErr ?? "Configure un destino de streaming activo en Marca, o use ?stream=URL en la barra de dirección."}
          </p>
        )}

        {(audioErr || npErr) && <p className="listen-warn error small">{audioErr ?? npErr}</p>}

        {!embed ? (
          <footer className="listen-footer muted small">
            <p>
              Metadatos vía <code>GET /api/public/now-playing</code>
              {listen?.streamTargetName ? ` · ${listen.streamTargetName}` : ""}
            </p>
            <button type="button" className="btn btn-compact" onClick={() => void copyEmbed()}>
              Copiar iframe embebible
            </button>
          </footer>
        ) : null}
      </div>
    </div>
  );
}
