import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { apiFetch } from "../lib/api";
import type { ApiSettings, ApiSongRequest, ApiSongRequestCreateBody, SongRequestStatus } from "@radioflow/shared";

const STATUS_LABEL: Record<SongRequestStatus, string> = {
  pending: "Pendiente",
  approved: "Aprobado",
  rejected: "Rechazado",
  played: "En cola / emitido",
};

type MatchAsset = { id: string; title: string; artist: string | null };

export function RequestsPage() {
  const { token, user } = useAuth();
  const [searchParams] = useSearchParams();
  const showProtection = searchParams.get("protection") === "1";
  const canModerate =
    Boolean(token) && (user?.role === "admin" || user?.role === "editor" || user?.role === "dj");

  const [tab, setTab] = useState<"public" | "moderate">("public");
  const [filter, setFilter] = useState<SongRequestStatus | "all">("pending");
  const [rows, setRows] = useState<ApiSongRequest[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [listenerName, setListenerName] = useState("");
  const [listenerContact, setListenerContact] = useState("");
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [message, setMessage] = useState("");

  const [matchByRequest, setMatchByRequest] = useState<Record<string, MatchAsset[]>>({});
  const [artistCooldown, setArtistCooldown] = useState(0);
  const [titleCooldown, setTitleCooldown] = useState(60);
  const [settingsMsg, setSettingsMsg] = useState<string | null>(null);
  const [settingsBusy, setSettingsBusy] = useState(false);

  useEffect(() => {
    if (!token || !canModerate) return;
    void apiFetch<ApiSettings>("/api/settings", { token }).then((s) => {
      setArtistCooldown(s.songRequestArtistCooldownMin ?? 0);
      setTitleCooldown(s.songRequestTitleCooldownMin ?? 60);
    });
  }, [token, canModerate]);

  const load = useCallback(async () => {
    if (!canModerate) {
      setRows([]);
      return;
    }
    try {
      const q = filter === "all" ? "" : `?status=${filter}`;
      const data = await apiFetch<ApiSongRequest[]>(`/api/requests${q}`, { token: token! });
      setRows(data);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error al cargar pedidos");
      setRows([]);
    }
  }, [canModerate, filter, token]);

  useEffect(() => {
    if (tab === "moderate") void load();
  }, [tab, load]);

  useEffect(() => {
    if (canModerate) setTab("moderate");
  }, [canModerate]);

  async function onSubmitPublic(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    const body: ApiSongRequestCreateBody = {
      listenerName: listenerName.trim() || undefined,
      listenerContact: listenerContact.trim() || undefined,
      title: title.trim(),
      artist: artist.trim() || undefined,
      message: message.trim() || undefined,
    };
    try {
      await apiFetch<ApiSongRequest>("/api/requests", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setMsg("Pedido enviado. El equipo lo revisará pronto.");
      setTitle("");
      setArtist("");
      setMessage("");
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "No se pudo enviar");
    }
  }

  async function searchMatch(req: ApiSongRequest) {
    const q = [req.title, req.artist].filter(Boolean).join(" ");
    if (q.length < 2) return;
    try {
      const hits = await apiFetch<MatchAsset[]>(
        `/api/requests/match-assets?q=${encodeURIComponent(q)}`,
        { token: token! },
      );
      setMatchByRequest((prev) => ({ ...prev, [req.id]: hits }));
    } catch {
      setMatchByRequest((prev) => ({ ...prev, [req.id]: [] }));
    }
  }

  async function patchRequest(id: string, body: { status?: SongRequestStatus; assetId?: string | null }) {
    setBusyId(id);
    setErr(null);
    try {
      await apiFetch<ApiSongRequest>(`/api/requests/${id}`, {
        method: "PATCH",
        token: token!,
        body: JSON.stringify(body),
      });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    } finally {
      setBusyId(null);
    }
  }

  async function enqueue(id: string) {
    setBusyId(id);
    setErr(null);
    setMsg(null);
    try {
      await apiFetch(`/api/requests/${id}/enqueue`, { method: "POST", token: token! });
      setMsg("Pista encolada justo después del tema al aire.");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo encolar");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="card">
      <h1>Pedidos de canciones</h1>
      <p className="muted">
        Los oyentes pueden pedir temas; DJ, editor o admin vinculan la pista de la librería y la mandan a la cola de la{" "}
        <Link to="/station">cabina</Link>.
      </p>

      <div className="inline-grid" style={{ gap: "0.5rem", marginBottom: "1rem" }}>
        <button
          type="button"
          className={`btn ${tab === "public" ? "primary" : "ghost"}`}
          onClick={() => setTab("public")}
        >
          Enviar pedido
        </button>
        {canModerate && (
          <button
            type="button"
            className={`btn ${tab === "moderate" ? "primary" : "ghost"}`}
            onClick={() => setTab("moderate")}
          >
            Moderación
          </button>
        )}
      </div>

      {err && <p className="error">{err}</p>}
      {msg && <p className="badge">{msg}</p>}

      {tab === "public" && (
        <form className="form" onSubmit={onSubmitPublic}>
          <div className="inline-grid">
            <label>
              Su nombre (opcional)
              <input value={listenerName} onChange={(e) => setListenerName(e.target.value)} maxLength={120} />
            </label>
            <label>
              Contacto (opcional)
              <input
                value={listenerContact}
                onChange={(e) => setListenerContact(e.target.value)}
                placeholder="email o teléfono"
                maxLength={200}
              />
            </label>
          </div>
          <label>
            Canción *
            <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={300} />
          </label>
          <label>
            Artista
            <input value={artist} onChange={(e) => setArtist(e.target.value)} maxLength={300} />
          </label>
          <label>
            Mensaje para el locutor
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} maxLength={1000} />
          </label>
          <button type="submit" className="btn primary">
            Enviar pedido
          </button>
          <p className="muted small">
            Hay un límite de pedidos por conexión para evitar spam (por defecto 5 cada 15 minutos en la API).
          </p>
        </form>
      )}

      {tab === "moderate" && canModerate && (
        <>
          <label className="mt">
            Filtrar
            <select
              className="select"
              value={filter}
              onChange={(e) => setFilter(e.target.value as SongRequestStatus | "all")}
            >
              <option value="pending">Pendientes</option>
              <option value="approved">Aprobados</option>
              <option value="rejected">Rechazados</option>
              <option value="played">Emitidos / en cola</option>
              <option value="all">Todos</option>
            </select>
          </label>
          <ul className="list mt">
            {rows.map((r) => (
              <li key={r.id}>
                <div>
                  <strong>{r.title}</strong>
                  {r.artist ? <span className="muted"> · {r.artist}</span> : null}
                  <div className="muted small">
                    {STATUS_LABEL[r.status]}
                    {r.listenerName ? ` · ${r.listenerName}` : ""}
                    {r.message ? ` · «${r.message}»` : ""}
                    {" · "}
                    {new Date(r.createdAt).toLocaleString()}
                  </div>
                  {r.asset ? (
                    <div className="small">
                      Vinculado: <strong>{r.asset.title}</strong>
                      {r.asset.artist ? ` — ${r.asset.artist}` : ""}
                    </div>
                  ) : null}
                </div>
                <div className="inline-grid" style={{ gap: "0.35rem", marginTop: "0.5rem" }}>
                  <button type="button" className="btn ghost" disabled={busyId === r.id} onClick={() => void searchMatch(r)}>
                    Buscar en librería
                  </button>
                  {matchByRequest[r.id]?.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      className="btn"
                      disabled={busyId === r.id}
                      onClick={() => void patchRequest(r.id, { assetId: a.id, status: "approved" })}
                    >
                      Vincular: {a.title}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="btn primary"
                    disabled={busyId === r.id || !r.assetId}
                    onClick={() => void enqueue(r.id)}
                  >
                    Encolar en cabina
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={busyId === r.id}
                    onClick={() => void patchRequest(r.id, { status: "rejected" })}
                  >
                    Rechazar
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {rows.length === 0 && <p className="muted">No hay pedidos con este filtro.</p>}
        </>
      )}

      {tab === "moderate" && !canModerate && (
        <p className="muted">
          <Link to="/login">Inicia sesión</Link> como DJ, editor o admin para moderar pedidos.
        </p>
      )}

      {showProtection && canModerate ? (
        <div className="card mt song-request-protection-panel">
          <h2 className="small">Protección repetición pedidos</h2>
          <p className="muted small">Bloquea pedidos públicos duplicados por artista o título en la ventana indicada.</p>
          <div className="row tight" style={{ flexWrap: "wrap", gap: "1rem", marginTop: "0.75rem" }}>
            <label className="field">
              <span className="muted small">Mismo artista (min, 0=off)</span>
              <input
                type="number"
                min={0}
                max={10080}
                value={artistCooldown}
                onChange={(e) => setArtistCooldown(Number(e.target.value) || 0)}
              />
            </label>
            <label className="field">
              <span className="muted small">Mismo título (min, 0=off)</span>
              <input
                type="number"
                min={0}
                max={10080}
                value={titleCooldown}
                onChange={(e) => setTitleCooldown(Number(e.target.value) || 0)}
              />
            </label>
          </div>
          {settingsMsg ? <p className="muted small mt">{settingsMsg}</p> : null}
          <button
            type="button"
            className="btn primary btn-compact mt"
            disabled={settingsBusy}
            onClick={() => {
              if (!token) return;
              setSettingsBusy(true);
              setSettingsMsg(null);
              void apiFetch<ApiSettings>("/api/settings", {
                method: "PATCH",
                token,
                body: JSON.stringify({
                  songRequestArtistCooldownMin: artistCooldown,
                  songRequestTitleCooldownMin: titleCooldown,
                }),
              })
                .then(() => setSettingsMsg("Guardado."))
                .catch((e) => setSettingsMsg(e instanceof Error ? e.message : "Error"))
                .finally(() => setSettingsBusy(false));
            }}
          >
            {settingsBusy ? "Guardando…" : "Guardar"}
          </button>
        </div>
      ) : null}
    </section>
  );
}
