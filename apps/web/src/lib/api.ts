export async function apiFetch<T>(
  path: string,
  init?: RequestInit & { token?: string | null },
): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.token) headers.set("Authorization", `Bearer ${init.token}`);
  if (!headers.has("Content-Type") && init?.body && typeof init.body === "string") {
    headers.set("Content-Type", "application/json");
  }
  const r = await fetch(path, { ...init, headers });
  if (r.status === 204) return undefined as T;
  const text = await r.text();
  let data: { error?: string } | unknown | null = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      if (!r.ok) throw new Error(r.statusText || `Error ${r.status}`);
      throw new Error("Respuesta no válida del servidor");
    }
  }
  if (!r.ok) {
    const msg =
      data && typeof data === "object" && data !== null && "error" in data
        ? (data as { error?: string }).error
        : null;
    throw new Error(typeof msg === "string" ? msg : r.statusText || "Error de API");
  }
  return data as T;
}
