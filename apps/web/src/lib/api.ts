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
  const data = text ? JSON.parse(text) : null;
  if (!r.ok) {
    const msg = data?.error ?? r.statusText;
    throw new Error(typeof msg === "string" ? msg : "Error de API");
  }
  return data as T;
}
