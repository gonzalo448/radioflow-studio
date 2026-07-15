/** URL http(s) de audio/stream almacenada en MediaAsset.path (RB-044). */
export function isRemoteStreamPath(storedPath: string): boolean {
  return /^https?:\/\//i.test(storedPath.trim());
}

/** Normaliza y valida una URL de stream remoto. */
export function normalizeRemoteStreamUrl(raw: string): string {
  const trimmed = raw.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("URL inválida");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Solo se admiten URLs http:// o https://");
  }
  if (!url.hostname) throw new Error("URL sin host");
  return url.toString();
}

export function titleFromStreamUrl(url: string, fallback?: string): string {
  const t = (fallback ?? "").trim();
  if (t) return t;
  try {
    const u = new URL(url);
    const base = u.pathname.split("/").filter(Boolean).pop() ?? "";
    const name = decodeURIComponent(base.replace(/\.(mp3|aac|ogg|m3u8?|pls)$/i, "")).replace(/[_-]+/g, " ").trim();
    if (name) return name;
    return u.hostname;
  } catch {
    return "Stream remoto";
  }
}

export function guessMimeFromStreamUrl(url: string): string {
  const lower = url.toLowerCase().split("?")[0] ?? url;
  if (lower.endsWith(".aac")) return "audio/aac";
  if (lower.endsWith(".ogg") || lower.endsWith(".opus")) return "audio/ogg";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".flac")) return "audio/flac";
  return "audio/mpeg";
}
