/**
 * Resolución de URLs del reproductor web en vivo.
 *
 * INVARIANTES (no romper sin tests):
 * 1. En local/dev usar proxies same-origin (/icecast-lan, /azura-proxy), nunca fetch cross-origin a :4000/:4001.
 * 2. Candidatos en orden estable; sin cache-bust agresivo en la URL del stream.
 * 3. Metadatos RadioFlow solo vía /api (proxy Vite); Azura solo oyentes/online.
 */

export const DEFAULT_AZURA_HOST = "https://azura.radioritmonline.com";
export const DEFAULT_STATION = "radioflow_studio";

export type LiveStreamEnv = {
  isLocalDev: boolean;
  defaultHost?: string;
  defaultStation?: string;
};

export function detectLocalDevHost(
  loc: Pick<Location, "protocol" | "hostname"> = typeof window !== "undefined"
    ? window.location
    : { protocol: "http:", hostname: "localhost" },
  isViteDev = typeof import.meta !== "undefined" && Boolean(import.meta.env?.DEV),
): boolean {
  if (!loc.protocol.startsWith("http")) return false;
  const h = loc.hostname;
  if (h === "127.0.0.1" || h === "localhost") return true;
  return isViteDev;
}

export function resolveStreamUrl(override: string, env: LiveStreamEnv): string {
  const host = (env.defaultHost ?? DEFAULT_AZURA_HOST).replace(/\/$/, "");
  const station = env.defaultStation ?? DEFAULT_STATION;

  if (override.trim()) {
    const o = override.trim();
    if (env.isLocalDev && o.includes("192.168.1.26:8150")) {
      try {
        const u = new URL(o);
        return `/icecast-lan${u.pathname || "/radio.mp3"}`;
      } catch {
        return "/icecast-lan/radio.mp3";
      }
    }
    if (env.isLocalDev && o.includes("radioritmonline.com")) {
      try {
        const u = new URL(o);
        return `/azura-proxy${u.pathname}${u.search}`;
      } catch {
        /* fallthrough */
      }
    }
    return o;
  }
  if (env.isLocalDev) return "/icecast-lan/radio.mp3";
  return `${host}/listen/${station}/radio.mp3`;
}

export function streamCandidates(override: string, env: LiveStreamEnv): string[] {
  const host = (env.defaultHost ?? DEFAULT_AZURA_HOST).replace(/\/$/, "");
  const station = env.defaultStation ?? DEFAULT_STATION;
  const urls: string[] = [];
  const push = (u: string) => {
    if (u?.trim() && !urls.includes(u)) urls.push(u);
  };
  push(resolveStreamUrl(override, env));
  if (env.isLocalDev) {
    push("/icecast-lan/radio.mp3");
    push(`/azura-proxy/listen/${station}/radio.mp3`);
  }
  push(`${host}/listen/${station}/radio.mp3`);
  return urls;
}

/** Metadatos de cabina: solo same-origin en local (evita CORS 5173→:4000). */
export function radioFlowNowPlayingUrls(env: LiveStreamEnv, absoluteApiUrl?: string): string[] {
  const urls: string[] = [];
  const push = (u: string) => {
    if (u && !urls.includes(u)) urls.push(u);
  };
  push("/api/public/now-playing");
  if (!env.isLocalDev && absoluteApiUrl?.startsWith("http")) {
    push(absoluteApiUrl);
  }
  return urls;
}

/**
 * ¿Reconectar ante error del <audio>?
 * No reconectar si el usuario no quiere play, o si el elemento sigue con datos.
 */
export function shouldReconnectOnMediaError(opts: {
  wantPlay: boolean;
  paused: boolean;
  readyState: number;
  haveCurrentData?: number;
}): boolean {
  if (!opts.wantPlay) return false;
  const have = opts.haveCurrentData ?? 2; // HTMLMediaElement.HAVE_CURRENT_DATA
  if (!opts.paused && opts.readyState >= have) return false;
  return true;
}
