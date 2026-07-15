import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { ApiPublicNowPlaying } from "@radioflow/shared";
import { apiUrl } from "../lib/api-base";
import {
  DEFAULT_AZURA_HOST,
  DEFAULT_STATION,
  detectLocalDevHost,
  radioFlowNowPlayingUrls,
} from "../radio/live-stream-urls";
import { RadioPageErrorBoundary } from "../radio/RadioPageErrorBoundary";
import { useLiveStreamPlayer } from "../radio/useLiveStreamPlayer";
import "./AzuraRadioPage.css";

const POLL_MS = 4_000;
/** Splash de marca antes del reproductor (ms). */
const SPLASH_MS = 8_000;
const SPLASH_FADE_MS = 450;

type AzuraNowPlaying = {
  is_online?: boolean;
  station?: {
    name?: string;
    shortcode?: string;
    description?: string;
    listen_url?: string;
    mounts?: Array<{ url?: string; is_default?: boolean; path?: string }>;
  };
  listeners?: { current?: number; unique?: number; total?: number };
};

function nowPlayingFetchUrl(host: string, station: string): string {
  if (detectLocalDevHost()) {
    return `/azura-proxy/api/nowplaying/${encodeURIComponent(station)}`;
  }
  return `${host.replace(/\/$/, "")}/api/nowplaying/${encodeURIComponent(station)}`;
}

function pickBestNowPlaying(candidates: Array<ApiPublicNowPlaying | null>): ApiPublicNowPlaying | null {
  const valid = candidates.filter((c): c is ApiPublicNowPlaying => Boolean(c?.now?.title?.trim()));
  if (valid.length === 0) return null;
  return valid.find((c) => c.playing && c.now) ?? valid[0]!;
}

async function fetchJsonSilent<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function withArtCacheBust(url: string, token: string): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}v=${encodeURIComponent(token)}`;
}

function resolveRadioFlowArt(
  rfNow: {
    assetId?: string | null;
    coverUrl?: string | null;
    stationLogoUrl?: string | null;
    startedAt?: string | null;
  } | null,
): string | null {
  if (!rfNow) return null;
  const local = detectLocalDevHost();
  const id = rfNow.assetId?.trim();
  const bust = rfNow.startedAt?.trim() || id || "1";
  if (id) {
    const path = `/api/library/assets/${encodeURIComponent(id)}/cover`;
    const href = local ? path : apiUrl(path);
    return withArtCacheBust(href, bust);
  }
  const raw = rfNow.coverUrl?.trim();
  if (raw) {
    try {
      const u = new URL(raw, typeof window !== "undefined" ? window.location.href : "http://local/");
      if (/\/api\/library\/assets\/[^/]+\/cover$/i.test(u.pathname)) {
        const href = local ? u.pathname : raw;
        return withArtCacheBust(href, bust);
      }
    } catch {
      /* keep raw */
    }
    return withArtCacheBust(raw, bust);
  }
  const logo = rfNow.stationLogoUrl?.trim();
  return logo ? withArtCacheBust(logo, bust) : null;
}

function useRadioPwaMeta(stationName: string) {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = stationName;

    const ensure = (rel: string, attrs: Record<string, string>) => {
      let el = document.head.querySelector(`link[data-radio-pwa="${rel}"]`) as HTMLLinkElement | null;
      if (!el) {
        el = document.createElement("link");
        el.dataset.radioPwa = rel;
        document.head.appendChild(el);
      }
      Object.entries(attrs).forEach(([k, v]) => el!.setAttribute(k, v));
    };

    ensure("manifest", { rel: "manifest", href: "/radio.webmanifest" });
    ensure("apple-touch-icon", { rel: "apple-touch-icon", href: "/radio-icon.svg" });

    let theme = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
    if (!theme) {
      theme = document.createElement("meta");
      theme.name = "theme-color";
      document.head.appendChild(theme);
    }
    const prevTheme = theme.content;
    theme.content = "#0b0d10";

    let apple = document.querySelector('meta[name="apple-mobile-web-app-capable"]') as HTMLMetaElement | null;
    if (!apple) {
      apple = document.createElement("meta");
      apple.name = "apple-mobile-web-app-capable";
      apple.content = "yes";
      document.head.appendChild(apple);
    }

    if ("serviceWorker" in navigator) {
      if (detectLocalDevHost()) {
        void navigator.serviceWorker.getRegistrations().then((regs) => {
          for (const reg of regs) void reg.unregister();
        });
      } else {
        void navigator.serviceWorker.register("/radio-sw.js").catch(() => {
          /* ignore */
        });
      }
    }

    return () => {
      document.title = prevTitle;
      theme!.content = prevTheme;
    };
  }, [stationName]);
}

function AzuraRadioPageInner() {
  const [params] = useSearchParams();
  const host = (params.get("host")?.trim() || DEFAULT_AZURA_HOST).replace(/\/$/, "");
  const station = params.get("station")?.trim() || DEFAULT_STATION;
  const streamOverride = params.get("stream")?.trim() || "";
  const embed = params.get("embed") === "1" || params.get("embed") === "true";
  const skipSplash = embed || params.get("splash") === "0";

  const [splashPhase, setSplashPhase] = useState<"show" | "fade" | "done">(
    skipSplash ? "done" : "show",
  );
  const [np, setNp] = useState<AzuraNowPlaying | null>(null);
  const [rfNp, setRfNp] = useState<ApiPublicNowPlaying | null>(null);

  const {
    audioRef,
    wantPlay,
    volume,
    setVolume,
    audioErr,
    togglePlay,
    onAudioPlaying,
    onAudioError,
  } = useLiveStreamPlayer(streamOverride);

  useEffect(() => {
    if (skipSplash) return;
    const fadeId = window.setTimeout(() => setSplashPhase("fade"), SPLASH_MS);
    const doneId = window.setTimeout(() => setSplashPhase("done"), SPLASH_MS + SPLASH_FADE_MS);
    return () => {
      window.clearTimeout(fadeId);
      window.clearTimeout(doneId);
    };
  }, [skipSplash]);

  const npUrl = nowPlayingFetchUrl(host, station);

  const loadNp = useCallback(async () => {
    try {
      const res = await fetch(npUrl, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setNp((await res.json()) as AzuraNowPlaying);
    } catch {
      /* metadatos Azura opcionales */
    }

    const local = detectLocalDevHost();
    const npUrls = radioFlowNowPlayingUrls(
      { isLocalDev: local },
      local ? undefined : apiUrl("/api/public/now-playing"),
    );
    const results = await Promise.all(npUrls.map((u) => fetchJsonSilent<ApiPublicNowPlaying>(u)));
    const best = pickBestNowPlaying(results);
    if (best?.now?.title?.trim()) setRfNp(best);
  }, [npUrl]);

  useEffect(() => {
    void loadNp();
    const id = window.setInterval(() => void loadNp(), POLL_MS);
    return () => window.clearInterval(id);
  }, [loadNp]);

  const rfNow = rfNp?.now;
  const title = rfNow?.title?.trim() || "";
  const artist = rfNow?.artist?.trim() || "";
  const album = rfNow?.album?.trim() || "";
  const artSrc = resolveRadioFlowArt(rfNow ?? null);
  const stationName =
    rfNow?.stationName?.trim() || np?.station?.name?.trim() || "RadioFlow Studio";
  const online = Boolean(rfNp?.playing) || Boolean(np?.is_online) || Boolean(title);
  const listeners = np?.listeners?.current ?? np?.listeners?.total ?? null;

  useRadioPwaMeta(stationName);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const artwork = artSrc
      ? [
          { src: artSrc, sizes: "512x512", type: "image/jpeg" },
          { src: artSrc, sizes: "256x256", type: "image/jpeg" },
        ]
      : [{ src: "/radio-icon.svg", sizes: "any", type: "image/svg+xml" }];
    navigator.mediaSession.metadata = new MediaMetadata({
      title: title || stationName,
      artist: artist || stationName,
      album: album || stationName,
      artwork,
    });
    navigator.mediaSession.playbackState = wantPlay ? "playing" : "paused";
  }, [title, artist, album, artSrc, stationName, wantPlay]);

  const showSplash = splashPhase !== "done";

  return (
    <div className={`radio-app${embed ? " radio-app--embed" : ""}${wantPlay ? " radio-app--on" : ""}`}>
      {/* Audio siempre montado: el splash no debe desmontar el elemento (HMR / fase splash). */}
      <audio
        ref={audioRef}
        className="radio-app-audio"
        preload="none"
        playsInline
        onPlaying={onAudioPlaying}
        onError={onAudioError}
      />

      {showSplash ? (
        <div
          className={`radio-splash${splashPhase === "fade" ? " radio-splash--out" : ""}`}
          role="status"
          aria-label="RadioFlow Studio"
        >
          <div className="radio-splash-backdrop" aria-hidden />
          <figure className="radio-splash-hero">
            <img
              src="./welcome-hero.png"
              alt="RadioFlow Studio"
              className="radio-splash-logo"
              width={720}
              height={720}
              decoding="async"
              draggable={false}
            />
          </figure>
        </div>
      ) : null}

      {!showSplash || splashPhase === "fade" ? (
        <div className={`radio-player${splashPhase === "fade" ? " radio-player--enter" : ""}`}>
          <div className={`radio-app-atmosphere${artSrc ? " radio-app-atmosphere--art" : ""}`} aria-hidden>
            {artSrc ? (
              <img
                key={artSrc}
                src={artSrc}
                alt=""
                className="radio-app-atmosphere-img"
                draggable={false}
              />
            ) : null}
          </div>
          <div className="radio-app-veil" aria-hidden />

          <header className="radio-app-topbar">
            <img
              src="./radioflow-logo.png"
              alt="RadioFlow Studio"
              className="radio-app-topbar-logo"
              decoding="async"
              draggable={false}
            />
            <p className="radio-app-status">
              <span className={`radio-app-live${online ? " radio-app-live--on" : ""}`} aria-hidden />
              {online ? "En vivo" : "Fuera de aire"}
              {typeof listeners === "number" ? ` · ${listeners} oyente${listeners === 1 ? "" : "s"}` : ""}
            </p>
          </header>

          <main className="radio-app-stage">
            <h1 className="radio-app-brand">{stationName}</h1>
            <p className="radio-app-tagline">Tu Música, Tu Radio, Tu Control…</p>

            <figure className="radio-app-cover">
              {artSrc ? (
                <img key={artSrc} src={artSrc} alt="" width={480} height={480} draggable={false} />
              ) : (
                <div className="radio-app-cover-empty" aria-hidden />
              )}
            </figure>

            <div className="radio-app-now" aria-live="polite">
              <p className="radio-app-title">{title || (online ? "En emisión" : "Sin señal")}</p>
              <p className="radio-app-artist">{artist || "\u00a0"}</p>
              {album ? <p className="radio-app-album">{album}</p> : null}
            </div>

            <div className="radio-app-transport">
              <button
                type="button"
                className="radio-app-play"
                onClick={() => void togglePlay()}
                aria-label={wantPlay ? "Pausar" : "Reproducir"}
                aria-pressed={wantPlay}
              >
                {wantPlay ? (
                  <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden>
                    <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" />
                    <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden>
                    <path d="M8 5.5v13l11-6.5L8 5.5z" fill="currentColor" />
                  </svg>
                )}
              </button>

              <label className="radio-app-volume">
                <span className="sr-only">Volumen</span>
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden className="radio-app-volume-icon">
                  <path
                    d="M4 9v6h3l4 4V5L7 9H4zm11.5 3a3.5 3.5 0 0 0-1.8-3.1v6.2A3.5 3.5 0 0 0 15.5 12z"
                    fill="currentColor"
                  />
                </svg>
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

            {audioErr && !wantPlay ? (
              <p className="radio-app-error" role="alert">
                {audioErr}
              </p>
            ) : null}
          </main>
        </div>
      ) : null}
    </div>
  );
}

export function AzuraRadioPage() {
  return (
    <RadioPageErrorBoundary label="el reproductor">
      <AzuraRadioPageInner />
    </RadioPageErrorBoundary>
  );
}
