export type IcecastProbeResult = {
  listenUrl: string | null;
  listeners: number | null;
  streamTitle: string | null;
  sourceConnected: boolean | null;
  error: string | null;
};

export function buildListenUrl(host: string, port: number, mountPath: string, tls: boolean, publicBaseUrl: string | null): string {
  if (publicBaseUrl?.trim()) {
    const base = publicBaseUrl.replace(/\/$/, "");
    const mount = mountPath.startsWith("/") ? mountPath : `/${mountPath}`;
    return `${base}${mount}`;
  }
  const scheme = tls ? "https" : "http";
  const mount = mountPath.startsWith("/") ? mountPath : `/${mountPath}`;
  return `${scheme}://${host}:${port}${mount}`;
}

function normalizeMount(mountPath: string): string {
  const m = mountPath.trim();
  if (!m) return "/";
  return m.startsWith("/") ? m : `/${m}`;
}

function pickSource(json: unknown, mountPath: string): Record<string, unknown> | null {
  if (!json || typeof json !== "object") return null;
  const icestats = (json as { icestats?: unknown }).icestats;
  if (!icestats || typeof icestats !== "object") return null;
  const source = (icestats as { source?: unknown }).source;
  const want = normalizeMount(mountPath).toLowerCase();

  const asList: Record<string, unknown>[] = [];
  if (Array.isArray(source)) {
    for (const s of source) {
      if (s && typeof s === "object") asList.push(s as Record<string, unknown>);
    }
  } else if (source && typeof source === "object") {
    asList.push(source as Record<string, unknown>);
  }

  if (asList.length === 0) return null;

  const byMount = asList.find((s) => {
    const listenurl = typeof s.listenurl === "string" ? s.listenurl : "";
    const mount = typeof s.mount === "string" ? s.mount : "";
    const pathGuess =
      mount ||
      (() => {
        try {
          return new URL(listenurl).pathname;
        } catch {
          return listenurl;
        }
      })();
    return normalizeMount(pathGuess).toLowerCase() === want;
  });
  return byMount ?? asList[0] ?? null;
}

/** Consulta status-json de Icecast (sin credenciales admin). */
export async function probeIcecastStatus(opts: {
  host: string;
  port: number;
  mountPath: string;
  tls: boolean;
  publicBaseUrl: string | null;
}): Promise<IcecastProbeResult> {
  const listenUrl = buildListenUrl(opts.host, opts.port, opts.mountPath, opts.tls, opts.publicBaseUrl);
  const scheme = opts.tls ? "https" : "http";
  const statusUrl = `${scheme}://${opts.host}:${opts.port}/status-json.xsl`;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(statusUrl, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) {
      return { listenUrl, listeners: null, streamTitle: null, sourceConnected: null, error: `HTTP ${res.status}` };
    }
    const json = (await res.json()) as unknown;
    const src = pickSource(json, opts.mountPath);
    if (!src) {
      return {
        listenUrl,
        listeners: 0,
        streamTitle: null,
        sourceConnected: false,
        error: null,
      };
    }
    const listeners =
      typeof src.listeners === "number"
        ? src.listeners
        : typeof src.listener === "number"
          ? src.listener
          : null;
    const streamTitle = typeof src.title === "string" ? src.title : null;
    const connected =
      typeof src.connected === "number"
        ? src.connected > 0
        : true;
    return {
      listenUrl,
      listeners,
      streamTitle,
      sourceConnected: connected,
      error: null,
    };
  } catch (e) {
    return {
      listenUrl,
      listeners: null,
      streamTitle: null,
      sourceConnected: null,
      error: e instanceof Error ? e.message : "Error al consultar Icecast",
    };
  }
}
