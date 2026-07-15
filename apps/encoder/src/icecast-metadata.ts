/**
 * Actualiza metadatos ICY en Icecast vía `/admin/metadata` (E1.4).
 * Requiere credenciales de admin (distintas de la fuente en muchos despliegues).
 */

export type IcecastMetadataInput = {
  title: string;
  artist: string | null;
  coverUrl?: string | null;
};

function parseIcecastSourceUrl(raw: string): {
  host: string;
  port: number;
  mount: string;
  tls: boolean;
} | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const normalized = trimmed.replace(/^icecasts:\/\//i, "https://").replace(/^icecast:\/\//i, "http://");
    const u = new URL(normalized);
    const tls = u.protocol === "https:";
    const host = u.hostname;
    const port = u.port ? Number(u.port) : tls ? 443 : 8000;
    const mount = u.pathname && u.pathname !== "/" ? u.pathname : "/stream";
    return { host, port, mount, tls };
  } catch {
    return null;
  }
}

/** Formato habitual Icecast: espacios como `+`. */
export function formatIcecastSongField(artist: string | null, title: string): string {
  const chunks: string[] = [];
  if (artist?.trim()) chunks.push(artist.trim());
  if (title?.trim()) chunks.push(title.trim());
  const combined = chunks.length ? chunks.join(" - ") : title.trim() || "RadioFlow";
  return combined.replace(/ /g, "+");
}

export async function pushIcecastAdminMetadata(
  icecastSourceUrl: string,
  meta: IcecastMetadataInput,
  opts: {
    adminUser: string;
    adminPassword: string;
    includeCoverUrl?: boolean;
    log?: (msg: string, extra?: unknown) => void;
  },
): Promise<{ ok: boolean; status?: number; detail?: string }> {
  const parsed = parseIcecastSourceUrl(icecastSourceUrl);
  if (!parsed) return { ok: false, detail: "URL Icecast no parseable" };
  if (!opts.adminPassword) return { ok: false, detail: "Sin RADIOFLOW_ICECAST_ADMIN_PASSWORD" };

  const scheme = parsed.tls ? "https" : "http";
  const song = formatIcecastSongField(meta.artist, meta.title);
  const params = new URLSearchParams({
    mount: parsed.mount,
    mode: "updinfo",
    charset: "UTF-8",
    song,
  });
  if (opts.includeCoverUrl && meta.coverUrl?.trim()) {
    // ICY / Icecast clásico: puede mapearse a StreamUrl (pocos clientes lo usan para artwork).
    params.set("url", meta.coverUrl.trim());
    // Icecast-KH: soporta campo explícito para artwork (no estándar, pero útil en players compatibles).
    params.set("artwork", meta.coverUrl.trim());
  }

  const adminUrl = `${scheme}://${parsed.host}:${parsed.port}/admin/metadata?${params.toString()}`;
  const auth = Buffer.from(`${opts.adminUser}:${opts.adminPassword}`, "utf8").toString("base64");

  try {
    const res = await fetch(adminUrl, {
      method: "GET",
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(8000),
    });
    const text = await res.text().catch(() => "");
    if (res.ok) {
      opts.log?.("Icecast metadata OK", { song, status: res.status });
      return { ok: true, status: res.status };
    }
    opts.log?.("Icecast metadata rechazado", { status: res.status, body: text.slice(0, 200) });
    return { ok: false, status: res.status, detail: text.slice(0, 200) || `HTTP ${res.status}` };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    opts.log?.("Icecast metadata error", detail);
    return { ok: false, detail };
  }
}
