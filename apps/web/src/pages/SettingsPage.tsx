import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { apiFetch } from "../lib/api";
import { absoluteApiUrl } from "../lib/absolute-api-url";
import { apiUrl } from "../lib/api-base";
import { dispatchSettingsBranding, applyStationTitle } from "../lib/settings-branding";
import { StationLogo } from "../components/StationLogo";
import { filesFromAbsolutePaths, isRadioflowDesktop } from "../lib/desktop-native";
import type { ApiAuthOk, ApiSettings, ApiSettingsPatchBody, ApiStreamingTarget } from "@radioflow/shared";

export function SettingsPage() {
  const { token, user, logout } = useAuth();
  const location = useLocation();
  const [s, setS] = useState<ApiSettings | null>(null);
  const [streamTargets, setStreamTargets] = useState<Pick<ApiStreamingTarget, "id" | "name">[]>([]);
  const [bootErr, setBootErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [m3uCopied, setM3uCopied] = useState<string | null>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const canEdit = user?.role === "admin" || user?.role === "editor";
  const streamM3uUrl = absoluteApiUrl("/api/programacion/stream.m3u");
  const currentM3uUrl = absoluteApiUrl("/api/programacion/actual?format=m3u&absolute=1");

  useEffect(() => {
    apiFetch<ApiSettings>("/api/settings")
      .then((data) => {
        setS(data);
        setBootErr(null);
      })
      .catch((e) => setBootErr(e instanceof Error ? e.message : "Error"));
  }, []);

  useEffect(() => {
    if (!token || !canEdit) return;
    apiFetch<ApiStreamingTarget[]>("/api/streaming/targets", { token })
      .then((rows) => setStreamTargets(rows.map((r) => ({ id: r.id, name: r.name }))))
      .catch(() => setStreamTargets([]));
  }, [token, canEdit]);

  useEffect(() => {
    const id = location.hash.replace(/^#/, "");
    if (!id || !s) return;
    const t = window.setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
    return () => window.clearTimeout(t);
  }, [location.hash, s]);

  async function uploadLogoFile(file: File) {
    if (!token || !canEdit) return;
    setLogoBusy(true);
    setMsg(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const r = await fetch(apiUrl("/api/settings/logo"), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body,
      });
      const updated = (await r.json()) as ApiSettings | { error?: string };
      if (!r.ok) throw new Error("error" in updated ? updated.error : r.statusText);
      setS(updated as ApiSettings);
      dispatchSettingsBranding({ logoUrl: (updated as ApiSettings).logoUrl });
      setMsg("Logo de la emisora actualizado");
      setTimeout(() => setMsg(null), 2000);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "No se pudo subir el logo");
    } finally {
      setLogoBusy(false);
    }
  }

  async function pickStationLogoNative() {
    const path = await window.radioflow?.nativeFs?.openImageDialog?.();
    if (!path) return;
    const files = await filesFromAbsolutePaths([path]);
    const file = files[0];
    if (file) await uploadLogoFile(file);
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!token || !s) return;
    try {
      const body: ApiSettingsPatchBody = {
        stationName: s.stationName,
        tagline: s.tagline,
        primaryColor: s.primaryColor,
        logoUrl: s.logoUrl,
        activeStreamingTargetId: s.activeStreamingTargetId ?? null,
        extraStreamingTargetIds: s.extraStreamingTargetIds ?? [],
        rdsText: s.rdsText ?? null,
        rdsEnabled: s.rdsEnabled ?? false,
        autoDjNoRepeatArtistLastN: s.autoDjNoRepeatArtistLastN ?? 0,
        autoDjNoRepeatTrackLastN: s.autoDjNoRepeatTrackLastN ?? 0,
        autoDjMinUpcomingTracks: s.autoDjMinUpcomingTracks ?? 0,
        autoIntroFolder: s.autoIntroFolder,
        streamRecordingFolder: s.streamRecordingFolder,
        timeAnnounceFolderAbs: s.timeAnnounceFolderAbs ?? null,
        timeAnnounceIntervalMin: s.timeAnnounceIntervalMin ?? 0,
        stationIntroSourceAbs: s.stationIntroSourceAbs ?? null,
        stationIntroIntervalMin: s.stationIntroIntervalMin ?? 0,
      };
      const updated = await apiFetch<ApiSettings>("/api/settings", {
        method: "PATCH",
        token,
        body: JSON.stringify(body),
      });
      setS(updated);
      if (updated.primaryColor) {
        document.documentElement.style.setProperty("--accent", updated.primaryColor);
      }
      dispatchSettingsBranding({ stationName: updated.stationName, logoUrl: updated.logoUrl });
      applyStationTitle(updated.stationName);
      setMsg("Guardado");
      setTimeout(() => setMsg(null), 2000);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Error");
    }
  }

  async function copyM3uUrl(key: string, url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setM3uCopied(key);
      window.setTimeout(() => setM3uCopied(null), 2000);
    } catch {
      setMsg("No se pudo copiar al portapapeles");
    }
  }

  async function onLogoutAll() {
    if (!token) return;
    setLogoutBusy(true);
    try {
      await apiFetch<ApiAuthOk>("/api/auth/logout-all", { method: "POST", token });
      logout();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "No se pudo cerrar sesión en todos los dispositivos");
    } finally {
      setLogoutBusy(false);
    }
  }

  if (bootErr) return <p className="error card">{bootErr}</p>;
  if (!s) return <p>Cargando…</p>;

  return (
    <div className="card settings-page">
      <div className="settings-page-head">
        <h1>Marca</h1>
        <p className="muted">
          Afecta al panel (variable CSS <code>--accent</code>), metadatos públicos y el destino que el encoder puede
          resolver vía API (token dj+).
        </p>
        {!canEdit && <p className="badge">Solo lectura · editor o admin para cambiar</p>}
        {msg && <p className={msg === "Guardado" ? "badge" : "error"}>{msg}</p>}
        {token && (
          <div className="row">
            <button type="button" className="btn" disabled={logoutBusy} onClick={onLogoutAll}>
              Cerrar sesión en todos los dispositivos
            </button>
          </div>
        )}
      </div>

      <div className="settings-page-scroll">
        <form className="form" onSubmit={onSave}>
          <fieldset>
            <legend>Cabecera</legend>
            <label>
              Nombre de la emisora
              <input
                value={s.stationName}
                disabled={!canEdit}
                onChange={(e) => {
                  const stationName = e.target.value;
                  setS({ ...s, stationName });
                  dispatchSettingsBranding({ stationName });
                }}
              />
            </label>
            <label>
              Logo de la emisora
              <div className="settings-station-logo-row">
                <StationLogo
                  logoUrl={s.logoUrl}
                  stationName={s.stationName}
                  className="settings-station-logo-preview"
                />
                {canEdit && token ? (
                  <>
                    <button
                      type="button"
                      className="btn btn-compact"
                      disabled={logoBusy}
                      onClick={() => {
                        if (isRadioflowDesktop() && window.radioflow?.nativeFs?.openImageDialog) {
                          void pickStationLogoNative();
                        } else {
                          logoInputRef.current?.click();
                        }
                      }}
                    >
                      {logoBusy ? "Subiendo…" : "Elegir imagen…"}
                    </button>
                    <input
                      ref={logoInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void uploadLogoFile(file);
                        e.target.value = "";
                      }}
                    />
                  </>
                ) : null}
              </div>
              <span className="muted small">
                Aparece arriba a la derecha, del mismo tamaño que el logo de RadioFlow.
              </span>
            </label>
            <label>
              URL del logo (opcional)
              <input
                value={s.logoUrl ?? ""}
                disabled={!canEdit}
                onChange={(e) => {
                  const logoUrl = e.target.value || null;
                  setS({ ...s, logoUrl });
                  dispatchSettingsBranding({ logoUrl });
                }}
              />
            </label>
            <label>
              Eslogan
              <input value={s.tagline ?? ""} disabled={!canEdit} onChange={(e) => setS({ ...s, tagline: e.target.value || null })} />
            </label>
            <label>
              Color primario (hex)
              <input
                value={s.primaryColor ?? ""}
                disabled={!canEdit}
                onChange={(e) => setS({ ...s, primaryColor: e.target.value || null })}
              />
            </label>
          </fieldset>
          {canEdit && token && streamTargets.length > 0 ? (
            <>
              <label>
                Destino activo para el encoder (FFmpeg)
                <select
                  className="select"
                  value={s.activeStreamingTargetId ?? ""}
                  disabled={!canEdit}
                  onChange={(e) =>
                    setS({ ...s, activeStreamingTargetId: e.target.value ? e.target.value : null })
                  }
                >
                  <option value="">Ninguno — solo variable de entorno del encoder</option>
                  {streamTargets.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <fieldset className="mt">
                <legend>Destinos secundarios simultáneos</legend>
                <p className="muted small">
                  El encoder emite la misma señal al destino primario y a los marcados aquí (hasta 5).
                </p>
                {streamTargets
                  .filter((t) => t.id !== s.activeStreamingTargetId)
                  .map((t) => {
                    const checked = (s.extraStreamingTargetIds ?? []).includes(t.id);
                    return (
                      <label key={t.id} className="checkbox-row">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const prev = s.extraStreamingTargetIds ?? [];
                            const next = e.target.checked
                              ? [...prev, t.id]
                              : prev.filter((id) => id !== t.id);
                            setS({ ...s, extraStreamingTargetIds: next });
                          }}
                        />
                        {t.name}
                      </label>
                    );
                  })}
              </fieldset>
              <fieldset className="mt">
                <legend>Failover de streaming</legend>
                <p className="muted small">
                  Cadena de respaldos (hasta 5, en orden). Si el destino activo pierde fuente Icecast, avanza al
                  siguiente. Reconfigure el encoder tras cada cambio de URL.
                </p>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={s.streamingFailoverEnabled ?? false}
                    onChange={(e) => setS({ ...s, streamingFailoverEnabled: e.target.checked })}
                  />
                  Activar failover automático
                </label>
                <div className="mt">
                  <span className="muted small">Cadena de respaldo (orden = prioridad)</span>
                  {streamTargets
                    .filter((t) => t.id !== s.activeStreamingTargetId)
                    .map((t) => {
                      const chain = s.streamingFailoverBackupTargetIds ?? [];
                      const idx = chain.indexOf(t.id);
                      const checked = idx >= 0;
                      return (
                        <label key={t.id} className="checkbox-row">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={!s.streamingFailoverEnabled}
                            onChange={(e) => {
                              const prev = s.streamingFailoverBackupTargetIds ?? [];
                              let next: string[];
                              if (e.target.checked) {
                                next = prev.length >= 5 ? prev : [...prev, t.id];
                              } else {
                                next = prev.filter((id) => id !== t.id);
                              }
                              setS({
                                ...s,
                                streamingFailoverBackupTargetIds: next,
                                streamingFailoverBackupTargetId: next[0] ?? null,
                              });
                            }}
                          />
                          {checked ? (
                            <span className="mono muted small" style={{ marginRight: 6 }}>
                              {idx + 1}.
                            </span>
                          ) : null}
                          {t.name}
                        </label>
                      );
                    })}
                </div>
                <label className="checkbox-row mt">
                  <input
                    type="checkbox"
                    checked={s.streamingFailoverAutoRevert ?? true}
                    disabled={!s.streamingFailoverEnabled}
                    onChange={(e) => setS({ ...s, streamingFailoverAutoRevert: e.target.checked })}
                  />
                  Volver al primario cuando la fuente se recupere
                </label>
              </fieldset>
            </>
          ) : null}
          {canEdit && token && streamTargets.length === 0 && (
            <div className="settings-streaming-hint tile mt">
              <h3 className="h3">Salida a Internet (Icecast)</h3>
              <p className="muted small">
                <strong>Marca</strong> solo elige el destino activo cuando ya existe uno. Para crear Icecast (host,
                puerto, mount) use la barra de accesos rápidos <strong>Streaming ◉</strong> o{" "}
                <strong>Configuración → Destinos Icecast…</strong>.
              </p>
              <p className="mt">
                <Link to="/streaming" className="btn btn-compact primary">
                  Ir a Destinos de streaming
                </Link>
              </p>
            </div>
          )}
          {canEdit && token ? (
            <fieldset className="mt">
              <legend>RDS</legend>
              <p className="muted small">
                Sidecar <code>rds.txt</code> junto a Now Playing. Plantilla:{" "}
                <code>{"{title}"}</code>, <code>{"{artist}"}</code>, <code>{"{station}"}</code>.
              </p>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={s.rdsEnabled ?? false}
                  onChange={(e) => setS({ ...s, rdsEnabled: e.target.checked })}
                />
                Activar export RDS
              </label>
              <label>
                Texto RDS
                <input
                  value={s.rdsText ?? ""}
                  disabled={!canEdit}
                  placeholder="{artist} - {title} · {station}"
                  onChange={(e) => setS({ ...s, rdsText: e.target.value || null })}
                />
              </label>
            </fieldset>
          ) : null}
          {canEdit && token ? (
            <fieldset className="mt">
              <legend>Operación al aire</legend>
              <label>
                Carpeta auto intro (bajo uploads/)
                <input
                  value={s.autoIntroFolder ?? "intros"}
                  disabled={!canEdit}
                  placeholder="intros"
                  maxLength={64}
                  onChange={(e) => setS({ ...s, autoIntroFolder: e.target.value })}
                />
              </label>
              <label className="mt">
                Carpeta grabaciones de stream (bajo uploads/)
                <input
                  value={s.streamRecordingFolder ?? "recordings"}
                  disabled={!canEdit}
                  placeholder="recordings"
                  maxLength={64}
                  onChange={(e) => setS({ ...s, streamRecordingFolder: e.target.value })}
                />
              </label>
              <div className="mt" id="track-list-repeat">
                <div className="muted small">
                  AutoDJ: protección anti repetición (aplica al expandir <em>track lists</em> en la cola)
                </div>
                <div className="row tight mt">
                  <label className="field" style={{ minWidth: "14rem" }}>
                    <span className="label">No repetir artista (últimas N)</span>
                    <input
                      type="number"
                      min={0}
                      max={50}
                      value={s.autoDjNoRepeatArtistLastN ?? 0}
                      onChange={(e) =>
                        setS({
                          ...s,
                          autoDjNoRepeatArtistLastN: Math.max(0, Math.min(50, Number(e.target.value) || 0)),
                        })
                      }
                    />
                  </label>
                  <label className="field" style={{ minWidth: "14rem" }}>
                    <span className="label">No repetir tema (últimas N)</span>
                    <input
                      type="number"
                      min={0}
                      max={200}
                      value={s.autoDjNoRepeatTrackLastN ?? 0}
                      onChange={(e) =>
                        setS({
                          ...s,
                          autoDjNoRepeatTrackLastN: Math.max(0, Math.min(200, Number(e.target.value) || 0)),
                        })
                      }
                    />
                  </label>
                </div>
              </div>
              <div className="mt">
                <div className="muted small">AutoDJ: cola mínima</div>
                <label className="field mt" style={{ maxWidth: "22rem" }}>
                  <span className="label">Mantener al menos N canciones futuras en cola</span>
                  <input
                    type="number"
                    min={0}
                    max={200}
                    value={s.autoDjMinUpcomingTracks ?? 0}
                    onChange={(e) =>
                      setS({
                        ...s,
                        autoDjMinUpcomingTracks: Math.max(0, Math.min(200, Number(e.target.value) || 0)),
                      })
                    }
                  />
                </label>
              </div>
              <p className="muted small">
                Etiquetas de campos personalizados de biblioteca: configúrelas en{" "}
                <Link to="/library">Biblioteca → Campos personalizados</Link>.
              </p>
            </fieldset>
          ) : null}
          <button type="submit" className="btn primary" disabled={!canEdit}>
            Guardar
          </button>
        </form>
        {canEdit && token ? (
          <section className="card nested settings-page-section" id="locucion-horaria">
            <h2>Locución horaria</h2>
            <p className="muted">
              Carpeta del disco con clips <code>HRS05.mp3</code> + <code>MIN30.mp3</code> (en punto:{" "}
              <code>HRS05_O.mp3</code>). Usa el reloj del equipo e inserta al terminar la canción al aire.
            </p>
            <div className="row tight" style={{ flexWrap: "wrap", gap: "0.5rem", marginTop: "0.5rem" }}>
              <input
                style={{ flex: "1 1 14rem", minWidth: 0 }}
                value={s.timeAnnounceFolderAbs ?? ""}
                placeholder="D:\HORA PERSOLALIZADA DE RADIO RITMO"
                maxLength={1024}
                onChange={(e) => setS({ ...s, timeAnnounceFolderAbs: e.target.value || null })}
              />
              {isRadioflowDesktop() ? (
                <button
                  type="button"
                  className="btn btn-compact"
                  onClick={() => {
                    void (async () => {
                      const pick = window.radioflow?.nativeFs?.openDirectoryDialog;
                      if (!pick) {
                        setMsg("Reinicie la app de escritorio para activar Explorar…");
                        return;
                      }
                      const dir = await pick({ title: "Carpeta de locución horaria" });
                      if (!dir) return;
                      setS((prev) => (prev ? { ...prev, timeAnnounceFolderAbs: dir } : prev));
                      try {
                        const updated = await apiFetch<ApiSettings>("/api/settings", {
                          method: "PATCH",
                          token,
                          body: JSON.stringify({ timeAnnounceFolderAbs: dir }),
                        });
                        setS(updated);
                        setMsg(`Carpeta de locución guardada: ${dir}`);
                      } catch (e) {
                        const text = e instanceof Error ? e.message : "No se pudo guardar la carpeta";
                        setMsg(
                          /not found/i.test(text)
                            ? "API antigua sin locución horaria. Cierre y vuelva a abrir RadioFlow (npm run dev)."
                            : text,
                        );
                      }
                    })();
                  }}
                >
                  Explorar…
                </button>
              ) : (
                <p className="muted small" style={{ flex: "1 1 100%" }}>
                  En el navegador escriba la ruta a mano. En la app instalada use <strong>Explorar…</strong>.
                </p>
              )}
              <button
                type="button"
                className="btn btn-compact primary"
                disabled={!(s.timeAnnounceFolderAbs ?? "").trim()}
                title="Encola la hora actual tras la pista al aire"
                onClick={() => {
                  void (async () => {
                    try {
                      const folder = (s.timeAnnounceFolderAbs ?? "").trim();
                      if (folder) {
                        await apiFetch("/api/settings", {
                          method: "PATCH",
                          token,
                          body: JSON.stringify({
                            timeAnnounceFolderAbs: folder,
                            timeAnnounceIntervalMin: s.timeAnnounceIntervalMin ?? 0,
                          }),
                        });
                      }
                      const r = await apiFetch<{
                        ok: boolean;
                        deferred?: boolean;
                        hour: number;
                        minute: number;
                        fileNames: string[];
                        error?: string;
                      }>("/api/time-announce/play", {
                        method: "POST",
                        token,
                        body: JSON.stringify({ afterCurrent: true }),
                      });
                      setMsg(
                        r.ok
                          ? r.deferred
                            ? "Locución programada: anunciará la hora del PC al terminar la canción actual"
                            : `Locución ${String(r.hour).padStart(2, "0")}:${String(r.minute).padStart(2, "0")} encolada (${r.fileNames.join(" → ")})`
                          : r.error ?? "No se pudo anunciar",
                      );
                    } catch (e) {
                      const text = e instanceof Error ? e.message : "Error al anunciar la hora";
                      setMsg(
                        /not found/i.test(text)
                          ? "API antigua sin locución horaria. Cierre y vuelva a abrir RadioFlow (npm run dev)."
                          : text,
                      );
                    }
                  })();
                }}
              >
                Decir hora ahora
              </button>
            </div>
            <label className="mt" style={{ display: "block", maxWidth: "22rem" }}>
              Cada cuánto anunciar
              <select
                value={s.timeAnnounceIntervalMin ?? 0}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  const timeAnnounceIntervalMin =
                    v === 15 || v === 30 || v === 60 ? (v as 15 | 30 | 60) : 0;
                  setS({ ...s, timeAnnounceIntervalMin });
                  void (async () => {
                    try {
                      const updated = await apiFetch<ApiSettings>("/api/settings", {
                        method: "PATCH",
                        token,
                        body: JSON.stringify({ timeAnnounceIntervalMin }),
                      });
                      setS(updated);
                      setMsg(
                        timeAnnounceIntervalMin === 0
                          ? "Locución automática desactivada (solo manual)"
                          : `Locución automática: cada ${timeAnnounceIntervalMin} minutos`,
                      );
                    } catch (err) {
                      setMsg(err instanceof Error ? err.message : "No se pudo guardar el intervalo");
                    }
                  })();
                }}
              >
                <option value={0}>Solo manual (Decir hora ahora)</option>
                <option value={15}>Cada 15 minutos (:00, :15, :30, :45)</option>
                <option value={30}>Cada 30 minutos (:00, :30)</option>
                <option value={60}>Cada 60 minutos (en punto)</option>
              </select>
            </label>
            <p className="muted small mt">
              Con intervalo activo, al llegar el minuto correspondiente se programa la locución <strong>después</strong>{" "}
              de la canción al aire (sin cortar ni mezclar). Cuando termine la canción, suena sola la locución.
            </p>
            {msg ? <p className="badge mt">{msg}</p> : null}
          </section>
        ) : null}

        {canEdit && token ? (
          <section className="card nested settings-page-section" id="intro-emisora">
            <h2>Intro de emisora (station ID)</h2>
            <p className="muted">
              Archivo o carpeta con la identificación de la radio (). Se inserta al terminar la canción
              al aire, sin cortar. Puede ser un <code>.mp3</code> concreto o una carpeta (elige un audio al azar si hay
              varios).
            </p>
            <div className="row tight" style={{ flexWrap: "wrap", gap: "0.5rem", marginTop: "0.5rem" }}>
              <input
                style={{ flex: "1 1 14rem", minWidth: 0 }}
                value={s.stationIntroSourceAbs ?? ""}
                placeholder="P:\Intro Radio Ritmo Colombia\Radio Ritmo - Bienvenidos….mp3"
                maxLength={1024}
                onChange={(e) => setS({ ...s, stationIntroSourceAbs: e.target.value || null })}
              />
              {isRadioflowDesktop() ? (
                <>
                  <button
                    type="button"
                    className="btn btn-compact"
                    onClick={() => {
                      void (async () => {
                        const pick = window.radioflow?.nativeFs?.openAudioDialog;
                        if (!pick) {
                          setMsg("Reinicie la app de escritorio para elegir audio.");
                          return;
                        }
                        const paths = await pick();
                        const file = paths[0];
                        if (!file) return;
                        setS((prev) => (prev ? { ...prev, stationIntroSourceAbs: file } : prev));
                        try {
                          const updated = await apiFetch<ApiSettings>("/api/settings", {
                            method: "PATCH",
                            token,
                            body: JSON.stringify({ stationIntroSourceAbs: file }),
                          });
                          setS(updated);
                          setMsg(`Intro guardada: ${file}`);
                        } catch (e) {
                          setMsg(e instanceof Error ? e.message : "No se pudo guardar");
                        }
                      })();
                    }}
                  >
                    Elegir archivo…
                  </button>
                  <button
                    type="button"
                    className="btn btn-compact"
                    onClick={() => {
                      void (async () => {
                        const pick = window.radioflow?.nativeFs?.openDirectoryDialog;
                        if (!pick) return;
                        const dir = await pick({ title: "Carpeta de intro de emisora" });
                        if (!dir) return;
                        setS((prev) => (prev ? { ...prev, stationIntroSourceAbs: dir } : prev));
                        try {
                          const updated = await apiFetch<ApiSettings>("/api/settings", {
                            method: "PATCH",
                            token,
                            body: JSON.stringify({ stationIntroSourceAbs: dir }),
                          });
                          setS(updated);
                          setMsg(`Carpeta de intro: ${dir}`);
                        } catch (e) {
                          setMsg(e instanceof Error ? e.message : "No se pudo guardar");
                        }
                      })();
                    }}
                  >
                    Explorar carpeta…
                  </button>
                </>
              ) : (
                <p className="muted small" style={{ flex: "1 1 100%" }}>
                  Escriba la ruta al archivo o carpeta. En la app instalada use <strong>Elegir archivo…</strong>.
                </p>
              )}
              <button
                type="button"
                className="btn btn-compact primary"
                disabled={!(s.stationIntroSourceAbs ?? "").trim()}
                title="Encola la intro tras la pista al aire"
                onClick={() => {
                  void (async () => {
                    try {
                      const source = (s.stationIntroSourceAbs ?? "").trim();
                      if (source) {
                        await apiFetch("/api/settings", {
                          method: "PATCH",
                          token,
                          body: JSON.stringify({
                            stationIntroSourceAbs: source,
                            stationIntroIntervalMin: s.stationIntroIntervalMin ?? 0,
                          }),
                        });
                      }
                      const r = await apiFetch<{
                        ok: boolean;
                        deferred?: boolean;
                        fileName?: string;
                        error?: string;
                      }>("/api/station-intro/play", {
                        method: "POST",
                        token,
                        body: JSON.stringify({ afterCurrent: true }),
                      });
                      setMsg(
                        r.ok
                          ? r.deferred
                            ? `Intro programada (${r.fileName ?? "audio"}) al terminar la canción actual`
                            : `Intro encolada: ${r.fileName ?? ""}`
                          : r.error ?? "No se pudo encolar la intro",
                      );
                    } catch (e) {
                      setMsg(e instanceof Error ? e.message : "Error al encolar intro");
                    }
                  })();
                }}
              >
                Reproducir intro ahora
              </button>
            </div>
            <label className="mt" style={{ display: "block", maxWidth: "22rem" }}>
              Cada cuánto reproducir
              <select
                value={s.stationIntroIntervalMin ?? 0}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  const stationIntroIntervalMin =
                    v === 15 || v === 30 || v === 60 ? (v as 15 | 30 | 60) : 0;
                  setS({ ...s, stationIntroIntervalMin });
                  void (async () => {
                    try {
                      const updated = await apiFetch<ApiSettings>("/api/settings", {
                        method: "PATCH",
                        token,
                        body: JSON.stringify({ stationIntroIntervalMin }),
                      });
                      setS(updated);
                      setMsg(
                        stationIntroIntervalMin === 0
                          ? "Intro automática desactivada (solo manual)"
                          : `Intro automática: cada ${stationIntroIntervalMin} minutos`,
                      );
                    } catch (err) {
                      setMsg(err instanceof Error ? err.message : "No se pudo guardar el intervalo");
                    }
                  })();
                }}
              >
                <option value={0}>Solo manual (Reproducir intro ahora)</option>
                <option value={15}>Cada 15 minutos (:00, :15, :30, :45)</option>
                <option value={30}>Cada 30 minutos (:00, :30)</option>
                <option value={60}>Cada 60 minutos (en punto)</option>
              </select>
            </label>
            <p className="muted small mt">
              Si también tiene locución horaria activa en el mismo minuto, la intro suena primero y luego la hora.
            </p>
          </section>
        ) : null}

        <section className="card nested settings-page-section">
          <h2>Liquidsoap (legacy, opt-in)</h2>
        <p className="muted small">
          <strong>Path por defecto al aire:</strong> encoder → Icecast (menú Emitir / Streaming). Liquidsoap es
          opcional para stacks externos con M3U; la regeneración automática está{" "}
          <strong>apagada</strong> salvo que configures <code>LIQUIDSOAP_M3U_POLL_MS</code> o el perfil Docker{" "}
          <code>liquidsoap-cron</code>.
        </p>
        <p className="muted small">
          La parrilla operativa moderna vive en <strong>/schedule</strong>. Estas URLs leen la tabla{" "}
          <code>programacion</code> (legacy) que alimenta generadores tipo <code>npm run liquidsoap:*</code> en el
          repo. En el servidor, revise <code>PROGRAMACION_TZ</code> para la zona horaria de la grilla. Si Liquidsoap
          corre en Docker, la URL debe apuntar al host que ve el contenedor (no un <code>localhost</code> que no
          resuelva dentro del contenedor).
        </p>
        <p className="muted small">
          <Link to="/streaming">Ir a Streaming / Emitir</Link>
          {" · "}
          <Link to="/help#liquidsoap-y-cabina">Ayuda: encoder por defecto vs Liquidsoap</Link>
        </p>
        <div className="form" style={{ gap: "0.75rem" }}>
          <div>
            <div className="muted small" style={{ marginBottom: "0.25rem" }}>
              Playlist completa (stream.m3u)
            </div>
            <div className="row" style={{ alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
              <code className="small" style={{ wordBreak: "break-all", flex: "1 1 12rem" }}>
                {streamM3uUrl}
              </code>
              <button type="button" className="btn" onClick={() => void copyM3uUrl("stream", streamM3uUrl)}>
                {m3uCopied === "stream" ? "Copiado" : "Copiar"}
              </button>
            </div>
          </div>
          <div>
            <div className="muted small" style={{ marginBottom: "0.25rem" }}>
              Solo ítem actual (M3U con URL absoluta de audio)
            </div>
            <div className="row" style={{ alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
              <code className="small" style={{ wordBreak: "break-all", flex: "1 1 12rem" }}>
                {currentM3uUrl}
              </code>
              <button type="button" className="btn" onClick={() => void copyM3uUrl("current", currentM3uUrl)}>
                {m3uCopied === "current" ? "Copiado" : "Copiar"}
              </button>
            </div>
          </div>
        </div>
        </section>
      </div>
    </div>
  );
}
