import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type {
  ApiLibraryFolderRow,
  ApiPlaylistListItem,
  ApiSchedulerEvent,
  ApiSchedulerEventCreateBody,
  ApiLibraryAsset,
  SchedulerActionType,
  SchedulerCommand,
} from "@radioflow/shared";
import { useAuth } from "../auth/AuthContext";
import { apiFetch } from "../lib/api";
import { fetchLibraryAssets, LIBRARY_PICKER_PAGE_SIZE } from "../lib/fetch-library-assets";
import { PlaylistGeneratorConfigFields } from "../components/playlist/PlaylistGeneratorConfigFields";
import {
  defaultGeneratorFormState,
  formStateToGenerateBody,
  validateGeneratorFormState,
  generateBodyToFormState,
} from "../lib/playlist-generator-form";
import { loadGeneratorPresets } from "../lib/playlist-generator-presets";
import { SchedulerEventWizard } from "../components/scheduler/SchedulerEventWizard";

const ACTIONS: Array<{ id: SchedulerActionType; label: string }> = [
  { id: "GENERATE_AND_PLAY_PLAYLIST", label: "Generar playlist y poner al aire (Pro)" },
  { id: "PLAY_AD_BREAK", label: "Insertar bloque publicitario" },
  { id: "TIME_ANNOUNCE", label: "Decir la hora (locución pregrabada)" },
  { id: "PLAY_PLAYLIST", label: "Volcar playlist a la cola" },
  { id: "PLAY_ASSET", label: "Encolar una pista" },
  { id: "RUN_COMMAND", label: "Comando de estación" },
];

const COMMANDS: Array<{ id: SchedulerCommand; label: string; needsPlaylist?: boolean }> = [
  { id: "STATION_SKIP", label: "Saltar al siguiente en cabina" },
  { id: "QUEUE_FROM_PLAYLIST_REPLACE", label: "Sustituir cola desde playlist", needsPlaylist: true },
  { id: "QUEUE_FROM_PLAYLIST_APPEND", label: "Añadir playlist al final de la cola", needsPlaylist: true },
  { id: "STREAM_RECORD_START", label: "Iniciar grabación de stream" },
  { id: "STREAM_RECORD_STOP", label: "Detener grabación de stream" },
];

function payloadSummary(e: ApiSchedulerEvent): string {
  const p = e.payload;
  if (e.actionType === "GENERATE_AND_PLAY_PLAYLIST") {
    const gen = (p.generate ?? {}) as { targetDurationSec?: number; categoryRules?: unknown[] };
    const min = gen.targetDurationSec ? Math.round(gen.targetDurationSec / 60) : "?";
    const rules = Array.isArray(gen.categoryRules) ? gen.categoryRules.length : 0;
    return `generar ${min} min${rules ? ` · ${rules} cat.` : ""} · ${p.replaceQueue !== false ? "reemplazar cola" : "añadir"}`;
  }
  if (e.actionType === "PLAY_AD_BREAK") {
    const n = p.spotCount != null ? String(p.spotCount) : "default";
    return `publicidad · ${n} spot(s)${p.pathPrefix ? ` · ${String(p.pathPrefix)}` : ""}`;
  }
  if (e.actionType === "TIME_ANNOUNCE") {
    return p.afterCurrent === false ? "locución · al final de cola" : "locución · tras canción actual";
  }
  if (e.actionType === "PLAY_PLAYLIST") {
    return `playlist ${String(p.playlistId ?? "—").slice(0, 8)}… · ${p.replaceQueue ? "reemplazar" : "añadir"}`;
  }
  if (e.actionType === "PLAY_ASSET") return `pista ${String(p.assetId ?? "—").slice(0, 8)}…`;
  if (e.actionType === "RUN_COMMAND") {
    const cmd = String(p.command ?? "");
    if (cmd === "STATION_SKIP") return "skip cabina";
    return `${cmd} · playlist ${String((p.args as { playlistId?: string })?.playlistId ?? "—").slice(0, 8)}…`;
  }
  return "";
}

export function SchedulerEventsPage() {
  const { token, user } = useAuth();
  const canEdit = user?.role === "admin" || user?.role === "editor";

  const [events, setEvents] = useState<ApiSchedulerEvent[]>([]);
  const [playlists, setPlaylists] = useState<Pick<ApiPlaylistListItem, "id" | "name">[]>([]);
  const [assets, setAssets] = useState<Pick<ApiLibraryAsset, "id" | "title" | "artist">[]>([]);
  const [genres, setGenres] = useState<string[]>([]);
  const [folders, setFolders] = useState<ApiLibraryFolderRow[]>([]);
  const [presets, setPresets] = useState(loadGeneratorPresets());
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [name, setName] = useState("Bloque generado al aire");
  const [actionType, setActionType] = useState<SchedulerActionType>("GENERATE_AND_PLAY_PLAYLIST");
  const [runAt, setRunAt] = useState("");
  const [repeatIntervalMin, setRepeatIntervalMin] = useState(0);
  const [playlistId, setPlaylistId] = useState("");
  const [replaceQueue, setReplaceQueue] = useState(true);
  const [assetId, setAssetId] = useState("");
  const [command, setCommand] = useState<SchedulerCommand>("STATION_SKIP");
  const [commandPlaylistId, setCommandPlaylistId] = useState("");
  const [genForm, setGenForm] = useState(defaultGeneratorFormState);
  const [adSpotCount, setAdSpotCount] = useState(2);
  const [adPathPrefix, setAdPathPrefix] = useState("");
  const [wizardOpen, setWizardOpen] = useState(false);

  const commandNeedsPlaylist = useMemo(
    () => COMMANDS.find((c) => c.id === command)?.needsPlaylist ?? false,
    [command],
  );

  const load = useCallback(async () => {
    if (!token || !canEdit) {
      setEvents([]);
      return;
    }
    try {
      const rows = await apiFetch<ApiSchedulerEvent[]>("/api/scheduler/events", { token });
      setEvents(rows);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudieron cargar eventos");
    }
  }, [token, canEdit]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPresets(loadGeneratorPresets());
    apiFetch<ApiPlaylistListItem[]>("/api/playlists")
      .then((rows) => {
        setPlaylists(rows.map((r) => ({ id: r.id, name: r.name })));
        if (rows[0] && !playlistId) setPlaylistId(rows[0].id);
        if (rows[0] && !commandPlaylistId) setCommandPlaylistId(rows[0].id);
      })
      .catch(() => setPlaylists([]));
    fetchLibraryAssets({ take: LIBRARY_PICKER_PAGE_SIZE, sort: "title" })
      .then((rows) => {
        setAssets(rows.map((r) => ({ id: r.id, title: r.title, artist: r.artist })));
        if (rows[0] && !assetId) setAssetId(rows[0].id);
      })
      .catch(() => setAssets([]));
    apiFetch<{ genres: string[] }>("/api/library/genres")
      .then((r) => setGenres(r.genres))
      .catch(() => setGenres([]));
    if (token) {
      apiFetch<{ folders: ApiLibraryFolderRow[] }>("/api/library/folders", { token })
        .then((r) => setFolders(r.folders))
        .catch(() => setFolders([]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  function buildPayload(): Record<string, unknown> {
    if (actionType === "GENERATE_AND_PLAY_PLAYLIST") {
      return { generate: formStateToGenerateBody(genForm), replaceQueue };
    }
    if (actionType === "PLAY_AD_BREAK") {
      return {
        ...(adSpotCount > 0 ? { spotCount: adSpotCount } : {}),
        ...(adPathPrefix.trim() ? { pathPrefix: adPathPrefix.trim() } : {}),
      };
    }
    if (actionType === "TIME_ANNOUNCE") {
      return { afterCurrent: true };
    }
    if (actionType === "PLAY_PLAYLIST") {
      return { playlistId, replaceQueue };
    }
    if (actionType === "PLAY_ASSET") {
      return { assetId };
    }
    if (commandNeedsPlaylist) {
      return { command, args: { playlistId: commandPlaylistId } };
    }
    return { command };
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setMsg(null);
    setErr(null);

    if (actionType === "GENERATE_AND_PLAY_PLAYLIST") {
      const validation = validateGeneratorFormState(genForm);
      if (validation) {
        setErr(validation);
        return;
      }
    }

    const body: ApiSchedulerEventCreateBody = {
      name,
      actionType,
      runAt: runAt ? new Date(runAt).toISOString() : null,
      repeatIntervalMin: repeatIntervalMin > 0 ? repeatIntervalMin : 0,
      payload: buildPayload(),
      enabled: true,
    };
    try {
      await apiFetch<ApiSchedulerEvent>("/api/scheduler/events", {
        method: "POST",
        token,
        body: JSON.stringify(body),
      });
      setMsg("Evento creado.");
      await load();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "No se pudo crear");
    }
  }

  async function runNow(id: string) {
    if (!token) return;
    setMsg(null);
    setErr(null);
    try {
      const res = await apiFetch<{ ok: true; run: { status: string; error: string | null } }>(
        `/api/scheduler/events/${id}/run`,
        { method: "POST", token },
      );
      setMsg(res.run.status === "success" ? "Ejecutado correctamente." : `Error: ${res.run.error ?? "desconocido"}`);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo ejecutar");
    }
  }

  async function toggleEnabled(ev: ApiSchedulerEvent) {
    if (!token) return;
    try {
      await apiFetch(`/api/scheduler/events/${ev.id}`, {
        method: "PATCH",
        token,
        body: JSON.stringify({ enabled: !ev.enabled }),
      });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    }
  }

  async function remove(id: string) {
    if (!token || !window.confirm("¿Eliminar este evento?")) return;
    try {
      await apiFetch(`/api/scheduler/events/${id}`, { method: "DELETE", token });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    }
  }

  return (
    <section className="card">
      <h1>Programador de eventos</h1>
      <p className="muted">
        Acciones puntuales (generar playlist Pro, playlist, pista o comando) en fecha/hora local. Para franjas
        recurrentes use <Link to="/schedule">Parrilla</Link>. Requiere{" "}
        <code className="mono">SCHEDULER_EVENTS_POLL_MS</code> en la API.
      </p>
      {!canEdit && <p className="error">Requiere rol editor o admin.</p>}
      {err && <p className="error">{err}</p>}
      {msg && <p className="badge">{msg}</p>}

      {canEdit && token && (
        <div className="row tight mb" style={{ marginBottom: "0.75rem" }}>
          <button type="button" className="btn primary btn-compact" onClick={() => setWizardOpen(true)}>
            Asistente de eventos…
          </button>
          <span className="muted small">Plantillas: generar bloque, lista, publicidad, skip…</span>
        </div>
      )}

      {canEdit && token && (
        <form className="form inline-grid scheduler-events-form" onSubmit={onCreate}>
          <label>
            Nombre
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>
            Acción
            <select className="select" value={actionType} onChange={(e) => setActionType(e.target.value as SchedulerActionType)}>
              {ACTIONS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Ejecutar a las (opcional)
            <input type="datetime-local" value={runAt} onChange={(e) => setRunAt(e.target.value)} />
          </label>

          <label>
            Repetir
            <select
              className="select"
              value={repeatIntervalMin}
              onChange={(e) => setRepeatIntervalMin(Number(e.target.value) || 0)}
            >
              <option value={0}>Una sola vez</option>
              <option value={5}>Cada 5 min</option>
              <option value={10}>Cada 10 min</option>
              <option value={15}>Cada 15 min</option>
              <option value={30}>Cada 30 min</option>
              <option value={60}>Cada 60 min</option>
            </select>
          </label>

          {actionType === "PLAY_AD_BREAK" && (
            <div className="scheduler-gen-panel card nested">
              <h3 className="small">Bloque publicitario</h3>
              <p className="muted small">
                Usa la carpeta y reglas del <Link to="/ads">planificador de publicidad</Link> salvo override abajo.
              </p>
              <label>
                Spots en el bloque (opcional)
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={adSpotCount}
                  onChange={(e) => setAdSpotCount(Number(e.target.value) || 2)}
                />
              </label>
              <label>
                Carpeta override (opcional)
                <input
                  value={adPathPrefix}
                  onChange={(e) => setAdPathPrefix(e.target.value)}
                  placeholder="publicidad/"
                />
              </label>
            </div>
          )}

          {actionType === "TIME_ANNOUNCE" && (
            <div className="scheduler-gen-panel card nested">
              <h3 className="small">Locución horaria</h3>
              <p className="muted small">
                Al dispararse, elige los clips de la carpeta configurada según el reloj del PC e inserta la locución{" "}
                <strong>después de la canción al aire</strong> (no interrumpe). Configure la carpeta en{" "}
                <Link to="/settings">Marca</Link>.
              </p>
            </div>
          )}

          {actionType === "GENERATE_AND_PLAY_PLAYLIST" && (
            <div className="scheduler-gen-panel card nested">
              <h3 className="small">Configuración del generador Pro</h3>
              <PlaylistGeneratorConfigFields
                compact
                state={genForm}
                onChange={setGenForm}
                genres={genres}
                folders={folders}
                presets={presets}
                onApplyPreset={(p) => setGenForm(generateBodyToFormState(p.config))}
              />
              <label className="checkbox-row">
                <input type="checkbox" checked={replaceQueue} onChange={(e) => setReplaceQueue(e.target.checked)} />
                Sustituir toda la cola al poner al aire
              </label>
            </div>
          )}

          {actionType === "PLAY_PLAYLIST" && (
            <>
              <label>
                Playlist
                <select className="select" value={playlistId} onChange={(e) => setPlaylistId(e.target.value)} required>
                  {playlists.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="checkbox-row">
                <input type="checkbox" checked={replaceQueue} onChange={(e) => setReplaceQueue(e.target.checked)} />
                Sustituir toda la cola
              </label>
            </>
          )}

          {actionType === "PLAY_ASSET" && (
            <label>
              Pista
              <select className="select" value={assetId} onChange={(e) => setAssetId(e.target.value)} required>
                {assets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.title}
                    {a.artist ? ` — ${a.artist}` : ""}
                  </option>
                ))}
              </select>
            </label>
          )}

          {actionType === "RUN_COMMAND" && (
            <>
              <label>
                Comando
                <select className="select" value={command} onChange={(e) => setCommand(e.target.value as SchedulerCommand)}>
                  {COMMANDS.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              {commandNeedsPlaylist && (
                <label>
                  Playlist
                  <select
                    className="select"
                    value={commandPlaylistId}
                    onChange={(e) => setCommandPlaylistId(e.target.value)}
                    required
                  >
                    {playlists.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </>
          )}

          <button className="btn primary" type="submit">
            Crear evento
          </button>
        </form>
      )}

      <h3 className="mt">Eventos</h3>
      <ul className="list">
        {events.map((e) => (
          <li key={e.id}>
            <div>
              <strong>{e.name}</strong>{" "}
              <span className="muted">
                · {e.enabled ? "activo" : "pausado"} · {e.actionType} · {payloadSummary(e)}
              </span>
              <div className="muted small">
                Programado: {e.runAt ? new Date(e.runAt).toLocaleString() : "manual"} · Próximo:{" "}
                {e.nextRunAt ? new Date(e.nextRunAt).toLocaleString() : "—"}
                {e.repeatIntervalMin > 0 ? ` · cada ${e.repeatIntervalMin} min` : ""}
              </div>
            </div>
            {token && canEdit && (
              <div className="inline-grid" style={{ gap: "0.35rem" }}>
                <button className="btn primary" type="button" onClick={() => void runNow(e.id)}>
                  Ejecutar ya
                </button>
                <button className="btn ghost" type="button" onClick={() => void toggleEnabled(e)}>
                  {e.enabled ? "Pausar" : "Activar"}
                </button>
                <button className="btn ghost" type="button" onClick={() => void remove(e.id)}>
                  Eliminar
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {events.length === 0 && <p className="muted">Sin eventos.</p>}

      {token && canEdit ? (
        <SchedulerEventWizard
          open={wizardOpen}
          token={token}
          playlists={playlists}
          assets={assets}
          genres={genres}
          folders={folders}
          presets={presets}
          onClose={() => setWizardOpen(false)}
          onCreated={() => {
            setMsg("Evento creado desde el asistente.");
            void load();
          }}
        />
      ) : null}
    </section>
  );
}
