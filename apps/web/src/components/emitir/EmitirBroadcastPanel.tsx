import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { apiFetch } from "../../lib/api";
import { openAzuraRadioInBrowser } from "../../lib/azura-radio-url";
import {
  getLocalEncoderStatus,
  hasDesktopEncoderBridge,
  startLocalEncoder,
  stopLocalEncoder,
} from "../../lib/broadcast-encoder";
import { isDesktopShell } from "../../lib/desktop-product";
import { BroadcastStatusPanel } from "../BroadcastStatusPanel";
import type {
  ApiBroadcastConfigPatchBody,
  ApiSettings,
  ApiStreamingTarget,
  ApiStreamingTargetCreateBody,
  StreamProtocol,
} from "@radioflow/shared";

const PROTOCOL_HINTS: Record<StreamProtocol, string> = {
  icecast: "Icecast 2 — host, puerto, mount y contraseña de fuente.",
  shoutcast: "Shoutcast — host, puerto y contraseña DJ/source.",
  azuracast: "AzuraCast: host, puerto, mount y contraseña del panel de la estación.",
};

export function EmitirBroadcastPanel() {
  const { token, user } = useAuth();
  const canEditBroadcast =
    user?.role === "admin" || user?.role === "editor" || user?.role === "dj";
  const canCreateTarget = user?.role === "admin" || user?.role === "editor";
  const desktopEncoder = hasDesktopEncoderBridge();

  const [settings, setSettings] = useState<ApiSettings | null>(null);
  const [targets, setTargets] = useState<ApiStreamingTarget[]>([]);
  const [localRunning, setLocalRunning] = useState(false);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [newName, setNewName] = useState("Icecast local");
  const [newProtocol, setNewProtocol] = useState<StreamProtocol>("icecast");
  const [newHost, setNewHost] = useState("localhost");
  const [newPort, setNewPort] = useState(8001);
  const [newMount, setNewMount] = useState("/stream");
  const [newPassword, setNewPassword] = useState("");
  const [newTls, setNewTls] = useState(false);
  const [newPublicBaseUrl, setNewPublicBaseUrl] = useState("");
  const [newSourceUser, setNewSourceUser] = useState("source");
  const [icecastAdminPassword, setIcecastAdminPassword] = useState(() => {
    try {
      return localStorage.getItem("radioflow.emitir.icecastAdminPassword") ?? "";
    } catch {
      return "";
    }
  });
  const [icecastAdminUser, setIcecastAdminUser] = useState(() => {
    try {
      return localStorage.getItem("radioflow.emitir.icecastAdminUser") ?? "admin";
    } catch {
      return "admin";
    }
  });
  const autoStartTriedRef = useRef(false);

  function encoderMetaOpts() {
    return {
      icecastAdminUser: icecastAdminUser.trim() || "admin",
      icecastAdminPassword: icecastAdminPassword.trim(),
    };
  }

  function persistAdminPassword(value: string) {
    setIcecastAdminPassword(value);
    try {
      if (value.trim()) localStorage.setItem("radioflow.emitir.icecastAdminPassword", value.trim());
      else localStorage.removeItem("radioflow.emitir.icecastAdminPassword");
    } catch {
      /* ignore */
    }
  }

  function persistAdminUser(value: string) {
    setIcecastAdminUser(value);
    try {
      const v = value.trim() || "admin";
      localStorage.setItem("radioflow.emitir.icecastAdminUser", v);
    } catch {
      /* ignore */
    }
  }

  const load = useCallback(async () => {
    try {
      const st = await apiFetch<ApiSettings>("/api/settings");
      setSettings(st);
      if (token) {
        const [tgs, local] = await Promise.all([
          apiFetch<ApiStreamingTarget[]>("/api/streaming/targets", { token }),
          getLocalEncoderStatus(),
        ]);
        setTargets(tgs);
        setLocalRunning(Boolean(local?.running));
        // Prefill formulario con el destino activo para que no parezca “vacío” al reabrir.
        const primary = tgs.find((t) => t.id === st.activeStreamingTargetId) ?? tgs[0];
        if (primary) {
          setNewName(primary.name);
          setNewProtocol(primary.protocol);
          setNewHost(primary.host);
          setNewPort(primary.port);
          setNewMount(primary.mountPath || "/radio.mp3");
          setNewSourceUser(primary.sourceUser || "source");
          setNewTls(Boolean(primary.tls));
          setNewPublicBaseUrl(primary.publicBaseUrl ?? "");
          setNewPassword("");
        }
      } else {
        setTargets([]);
        setLocalRunning(false);
      }
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo cargar");
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  // Si ya hay servidor(es) guardados, activar el primario y reanudar el encoder.
  useEffect(() => {
    if (autoStartTriedRef.current) return;
    if (!token || !desktopEncoder || !settings) return;
    if (targets.length === 0) return;
    autoStartTriedRef.current = true;
    if (localRunning) return;

    void (async () => {
      let activeId = settings.activeStreamingTargetId;
      const activeOk = activeId ? targets.some((t) => t.id === activeId) : false;
      if (!activeOk) activeId = targets[0]!.id;

      if (!activeOk || !settings.broadcastEnabled) {
        const ok = await saveBroadcastConfig({
          activeStreamingTargetId: activeId,
          broadcastEnabled: true,
          extraStreamingTargetIds: (settings.extraStreamingTargetIds ?? []).filter((id) => id !== activeId),
        });
        if (!ok) return;
      }

      const res = await startLocalEncoder(token, {
        icecastAdminUser: icecastAdminUser.trim() || "admin",
        icecastAdminPassword: icecastAdminPassword.trim(),
      });
      if (res.error) {
        setErr(res.error);
        return;
      }
      setLocalRunning(Boolean(res.running));
      setMsg("Encoder reanudado automáticamente con el servidor guardado.");
    })();
    // saveBroadcastConfig es estable en la práctica vía closure; evitar reintentos en bucle.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- arranque único al cargar Emitir
  }, [token, desktopEncoder, settings, targets, localRunning, icecastAdminUser, icecastAdminPassword]);

  useEffect(() => {
    if (!desktopEncoder) return;
    const id = window.setInterval(() => {
      void getLocalEncoderStatus().then((s) => setLocalRunning(Boolean(s?.running)));
    }, 4000);
    return () => window.clearInterval(id);
  }, [desktopEncoder]);

  async function saveBroadcastConfig(patch: ApiBroadcastConfigPatchBody, successMsg?: string) {
    if (!token || !canEditBroadcast) return false;
    setSaving(true);
    setErr(null);
    try {
      const next = await apiFetch<ApiSettings>("/api/streaming/broadcast-config", {
        method: "PATCH",
        token,
        body: JSON.stringify(patch),
      });
      setSettings(next);
      if (successMsg) setMsg(successMsg);
      return true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo guardar");
      return false;
    } finally {
      setSaving(false);
    }
  }

  function applyAzuraCastPreset() {
    setNewName("AzuraCast · RadioFlow Studio");
    setNewProtocol("azuracast");
    setNewHost("192.168.1.26");
    setNewPort(8150);
    setNewMount("/radio.mp3");
    setNewSourceUser("source");
    setNewPassword("kjcxRwDt");
    setNewTls(false);
    setNewPublicBaseUrl("https://azura.radioritmonline.com/listen/radioflow_studio");
    persistAdminUser("admin");
    persistAdminPassword("F3wnHyXW");
    setErr(null);
    setAdding(false);
    setMsg("Preset AzuraCast listo (fuente + admin metadatos). Pulse «Añadir servidor».");
  }

  async function onAddEncoder(e?: FormEvent) {
    e?.preventDefault();
    if (!token) {
      setErr("Inicie sesión para añadir un servidor.");
      return;
    }
    if (!canCreateTarget) {
      setErr(`Su rol (${user?.role ?? "—"}) no puede crear destinos. Use editor o admin.`);
      return;
    }
    if (!newName.trim() || !newHost.trim()) {
      setErr("Nombre y servidor son obligatorios.");
      return;
    }
    if (!newPassword.trim()) {
      setErr("Indique la contraseña de fuente.");
      return;
    }
    setAdding(true);
    setErr(null);
    try {
      const body: ApiStreamingTargetCreateBody = {
        name: newName.trim(),
        protocol: newProtocol,
        host: newHost.trim(),
        port: Number(newPort) > 0 ? Number(newPort) : 8150,
        mountPath: newMount.trim() || "/radio.mp3",
        sourceUser: newSourceUser.trim() || "source",
        sourcePassword: newPassword.trim(),
        publicBaseUrl: newPublicBaseUrl.trim() || null,
        tls: newTls,
        enabled: true,
      };
      const created = await apiFetch<ApiStreamingTarget>("/api/streaming/targets", {
        method: "POST",
        token,
        body: JSON.stringify(body),
      });
      setTargets((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setNewPassword("");
      // Persistir destino activo en la API (antes solo quedaba en memoria React).
      const ok = await saveBroadcastConfig(
        {
          activeStreamingTargetId: created.id,
          broadcastEnabled: true,
          extraStreamingTargetIds: (settings?.extraStreamingTargetIds ?? []).filter((id) => id !== created.id),
        },
        `Servidor «${created.name}» guardado y activo. Quedará listo al reabrir la app.`,
      );
      if (!ok) {
        setSettings((s) =>
          s
            ? {
                ...s,
                activeStreamingTargetId: created.id,
                broadcastEnabled: true,
              }
            : s,
        );
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo crear el destino");
    } finally {
      setAdding(false);
    }
  }

  async function selectPrimaryTarget(targetId: string) {
    if (!settings || !canEditBroadcast) return;
    setSettings((s) =>
      s
        ? {
            ...s,
            activeStreamingTargetId: targetId,
            extraStreamingTargetIds: (s.extraStreamingTargetIds ?? []).filter((id) => id !== targetId),
          }
        : s,
    );
    await saveBroadcastConfig(
      {
        activeStreamingTargetId: targetId,
        broadcastEnabled: settings.broadcastEnabled || true,
        extraStreamingTargetIds: (settings.extraStreamingTargetIds ?? []).filter((id) => id !== targetId),
      },
      "Servidor activo guardado.",
    );
  }

  async function onSaveAndStart(e: FormEvent) {
    e.preventDefault();
    if (!settings) return;
    const ok = await saveBroadcastConfig(
      {
        broadcastEnabled: true,
        activeStreamingTargetId: settings.activeStreamingTargetId,
        extraStreamingTargetIds: settings.extraStreamingTargetIds,
        rdsEnabled: settings.rdsEnabled,
        rdsText: settings.rdsText,
      },
      "Emisión configurada.",
    );
    if (!ok || !token) return;
    if (desktopEncoder && settings.activeStreamingTargetId && !localRunning) {
      const res = await startLocalEncoder(token, encoderMetaOpts());
      if (res.error) setErr(res.error);
      else {
        setLocalRunning(Boolean(res.running));
        setMsg(
          icecastAdminPassword.trim()
            ? "Emisión iniciada. Metadatos (título/artista) se envían a Icecast/AzuraCast."
            : "Emisión iniciada. Sin contraseña admin Icecast: AzuraCast no mostrará título/artista.",
        );
      }
    } else if (!settings.activeStreamingTargetId) {
      setErr("Elija o cree un servidor Icecast antes de iniciar.");
    } else if (!desktopEncoder) {
      setMsg("Configuración guardada. Arranque el encoder (ver aviso abajo).");
    }
  }

  async function toggleEncoder() {
    if (!token) return;
    setSaving(true);
    setErr(null);
    try {
      if (localRunning) {
        await stopLocalEncoder();
        setLocalRunning(false);
        setMsg("Encoder detenido.");
      } else {
        if (!settings?.activeStreamingTargetId) {
          setErr("Configure un servidor Icecast primero.");
          return;
        }
        const res = await startLocalEncoder(token, encoderMetaOpts());
        if (res.error) {
          setErr(res.error);
          return;
        }
        setLocalRunning(Boolean(res.running));
        setMsg(
          icecastAdminPassword.trim()
            ? "Encoder conectando… metadatos activos."
            : "Encoder conectando… (falta contraseña admin para metadatos en AzuraCast)",
        );
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo controlar el encoder");
    } finally {
      setSaving(false);
    }
  }

  const hasTarget = targets.length > 0;
  const hasPrimary = Boolean(settings?.activeStreamingTargetId);
  const stepCabina = "En cabina pulse Reproducir (Playout).";
  const stepServer = hasPrimary ? "Servidor Icecast listo." : "Falta servidor Icecast.";
  const stepEncoder = localRunning ? "Encoder publicando." : "Encoder parado.";

  return (
    <div className="emitir-panel">
      <ol className="emitir-steps" aria-label="Pasos para emitir">
        <li className={hasPrimary ? "emitir-step emitir-step--ok" : "emitir-step emitir-step--pending"}>
          <span className="emitir-step-num">1</span>
          <div>
            <strong>Servidor Icecast</strong>
            <p className="muted small">{stepServer}</p>
          </div>
        </li>
        <li className="emitir-step emitir-step--info">
          <span className="emitir-step-num">2</span>
          <div>
            <strong>Cabina al aire</strong>
            <p className="muted small">
              {stepCabina}{" "}
              <Link to="/station" className="small">
                Ir a cabina
              </Link>
            </p>
          </div>
        </li>
        <li className={localRunning ? "emitir-step emitir-step--ok" : "emitir-step emitir-step--pending"}>
          <span className="emitir-step-num">3</span>
          <div>
            <strong>Publicar a Internet</strong>
            <p className="muted small">{stepEncoder}</p>
          </div>
        </li>
      </ol>

      <BroadcastStatusPanel />

      <section className="emitir-section tile">
        <h2 className="h3">Servidor Icecast</h2>
        <p className="muted small">
          Todo en un solo lugar: cree el destino, márquelo como primario e inicie la emisión. Ejemplo local:{" "}
          <code className="mono">localhost:8001/stream</code>
        </p>

        {!token ? (
          <div className="emitir-login-hint mt">
            <p className="muted small">
              Para guardar la emisión e iniciar el encoder necesita <strong>iniciar sesión</strong> (su usuario
              de esta instalación).
            </p>
            <Link to="/login" state={{ from: "/emitir" }} className="btn primary btn-compact">
              Iniciar sesión
            </Link>
          </div>
        ) : !canEditBroadcast ? (
          <p className="badge small mt">
            Su rol ({user?.role ?? "—"}) no puede configurar emisión. Use un usuario editor, DJ o admin.
          </p>
        ) : null}

        {token && hasTarget && settings ? (
          <ul className="emitir-encoder-list mt">
            {targets.map((t) => {
              const isPrimary = settings.activeStreamingTargetId === t.id;
              return (
                <li key={t.id} className="emitir-encoder-row">
                  <label className="checkbox-row">
                    <input
                      type="radio"
                      name="emitir-primary"
                      checked={isPrimary}
                      disabled={!canEditBroadcast || saving}
                      onChange={() => void selectPrimaryTarget(t.id)}
                    />
                    <span>
                      <strong>{t.name}</strong>{" "}
                      <span className="muted mono small">
                        {t.protocol} · {t.host}:{t.port}
                        {t.mountPath}
                      </span>
                    </span>
                  </label>
                  {isPrimary ? <span className="badge small">Activo</span> : null}
                  <p className="muted small">{PROTOCOL_HINTS[t.protocol]}</p>
                </li>
              );
            })}
          </ul>
        ) : null}

        {token && !canCreateTarget ? (
          <p className="badge small mt">
            Su rol ({user?.role ?? "—"}) no puede añadir destinos. Inicie sesión como <strong>editor</strong> o{" "}
            <strong>admin</strong>.
          </p>
        ) : null}

        {token && canCreateTarget ? (
          <div className="form inline-grid mt">
            <p className="muted small" style={{ gridColumn: "1 / -1" }}>
              {hasTarget
                ? "El servidor ya está guardado. No hace falta añadirlo de nuevo: el encoder se reanuda solo al abrir la app. Aquí solo si quiere añadir otro destino."
                : "Crear su primer servidor Icecast / AzuraCast"}
            </p>
            <div className="row tight" style={{ gridColumn: "1 / -1" }}>
              <button type="button" className="btn btn-compact ghost" onClick={applyAzuraCastPreset}>
                Rellenar AzuraCast (RadioFlow Studio)
              </button>
            </div>
            <label>
              Nombre
              <input value={newName} onChange={(e) => setNewName(e.target.value)} />
            </label>
            <label>
              Protocolo
              <select value={newProtocol} onChange={(e) => setNewProtocol(e.target.value as StreamProtocol)}>
                <option value="icecast">Icecast</option>
                <option value="shoutcast">Shoutcast</option>
                <option value="azuracast">AzuraCast</option>
              </select>
            </label>
            <label>
              Servidor
              <input value={newHost} onChange={(e) => setNewHost(e.target.value)} />
            </label>
            <label>
              Puerto
              <input
                type="number"
                value={Number.isFinite(newPort) ? newPort : ""}
                min={1}
                max={65535}
                onChange={(e) => setNewPort(Number(e.target.value) || 0)}
              />
            </label>
            <label>
              Mount
              <input value={newMount} onChange={(e) => setNewMount(e.target.value)} />
            </label>
            <label>
              Usuario fuente
              <input value={newSourceUser} onChange={(e) => setNewSourceUser(e.target.value)} placeholder="source" />
            </label>
            <label>
              Contraseña fuente
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="off"
              />
            </label>
            <label>
              Usuario admin Icecast
              <input
                value={icecastAdminUser}
                onChange={(e) => persistAdminUser(e.target.value)}
                placeholder="admin"
              />
            </label>
            <label>
              Contraseña admin (metadatos)
              <input
                type="password"
                value={icecastAdminPassword}
                onChange={(e) => persistAdminPassword(e.target.value)}
                placeholder="Para título/artista en AzuraCast"
                autoComplete="off"
              />
            </label>
            <label className="checkbox-row" style={{ alignSelf: "end" }}>
              <input type="checkbox" checked={newTls} onChange={(e) => setNewTls(e.target.checked)} />
              TLS (icecasts / HTTPS al publicar)
            </label>
            <label style={{ gridColumn: "1 / -1" }}>
              URL pública de escucha (base HTTPS, sin el mount)
              <input
                value={newPublicBaseUrl}
                onChange={(e) => setNewPublicBaseUrl(e.target.value)}
                placeholder="https://azura.radioritmonline.com/listen/radioflow_studio"
              />
            </label>
            <button
              type="button"
              className="btn primary btn-compact"
              disabled={adding}
              onClick={() => void onAddEncoder()}
            >
              {adding ? "Añadiendo…" : "Añadir servidor"}
            </button>
          </div>
        ) : null}
      </section>

      {settings ? (
        <section className="emitir-section tile">
          <h2 className="h3">Iniciar emisión</h2>
          {!token ? (
            <p className="muted small">
              Inicie sesión arriba para activar estos controles.
            </p>
          ) : null}
          <label className="field mt">
            <span className="muted small">Contraseña admin Icecast (metadatos AzuraCast)</span>
            <input
              type="password"
              value={icecastAdminPassword}
              onChange={(e) => persistAdminPassword(e.target.value)}
              placeholder="admin password del mount (no la de fuente)"
              autoComplete="off"
              disabled={!token}
            />
          </label>
          <form onSubmit={(e) => void onSaveAndStart(e)}>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={settings.broadcastEnabled ?? false}
                disabled={!canEditBroadcast || saving}
                onChange={(e) =>
                  setSettings((s) => (s ? { ...s, broadcastEnabled: e.target.checked } : s))
                }
              />
              Emisión habilitada
            </label>
            <div className="row tight mt">
              <button
                type="submit"
                className="btn primary"
                disabled={!token || !canEditBroadcast || saving}
                title={!token ? "Inicie sesión primero" : undefined}
              >
                Guardar e iniciar emisión
              </button>
              {desktopEncoder ? (
                <button
                  type="button"
                  className={`btn${localRunning ? " ghost" : ""}`}
                  disabled={!token || saving}
                  title={!token ? "Inicie sesión primero" : undefined}
                  onClick={() => void toggleEncoder()}
                >
                  {localRunning ? "Detener encoder" : "Solo iniciar encoder"}
                </button>
              ) : null}
              {localRunning ? (
                <p className="muted small mt">
                  Si aparecen ventanas negras de FFmpeg, pulse <strong>Detener encoder</strong>, cierre la app
                  por completo y vuelva a abrirla antes de reintentar.
                </p>
              ) : null}
              <Link to="/listen" className="btn ghost">
                Reproductor local
              </Link>
              <button type="button" className="btn ghost" onClick={() => void openAzuraRadioInBrowser()}>
                Abrir reproductor web
              </button>
            </div>
          </form>
          {!desktopEncoder && isDesktopShell() ? (
            <p className="muted small mt">
              El encoder integrado requiere reiniciar la app instalada. Mientras tanto, desde el proyecto:{" "}
              <code className="mono">npm run dev:encoder</code>
            </p>
          ) : null}
          {!desktopEncoder && !isDesktopShell() ? (
            <p className="muted small mt">
              Arranque el encoder: <code className="mono">npm run dev:encoder</code> con{" "}
              <code>ENABLE_FFMPEG=1</code>.
            </p>
          ) : null}
        </section>
      ) : null}

      {settings && token && canEditBroadcast ? (
        <details className="emitir-section tile">
          <summary className="h3" style={{ cursor: "pointer" }}>
            Metadatos del stream (opcional)
          </summary>
          <form
            className="mt"
            onSubmit={(e) => {
              e.preventDefault();
              void saveBroadcastConfig({
                rdsEnabled: settings.rdsEnabled,
                rdsText: settings.rdsText,
              });
            }}
          >
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={settings.rdsEnabled}
                disabled={saving}
                onChange={(e) => setSettings({ ...settings, rdsEnabled: e.target.checked })}
              />
              Enviar metadatos al servidor
            </label>
            <label className="field mt">
              <span className="muted small">Plantilla</span>
              <input
                value={settings.rdsText ?? ""}
                placeholder="{artist} — {title}"
                disabled={saving}
                onChange={(e) => setSettings({ ...settings, rdsText: e.target.value || null })}
              />
            </label>
            <button type="submit" className="btn btn-compact primary mt" disabled={saving}>
              Guardar metadatos
            </button>
          </form>
        </details>
      ) : null}

      <p className="muted small">
        Grabación de stream y opciones avanzadas:{" "}
        <Link to="/streaming">Streaming avanzado</Link> · Nombre y logo:{" "}
        <Link to="/settings">Marca</Link>
      </p>

      {msg ? <p className="badge mt">{msg}</p> : null}
      {err ? <p className="error mt">{err}</p> : null}
    </div>
  );
}
