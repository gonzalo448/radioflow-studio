import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { apiFetch } from "../lib/api";
import { getStoredApiOrigin } from "../lib/api-base";
import { openAppDataFolder } from "../lib/desktop-native";
import { checkDesktopUpdates, isCabMeterHudVisible, toggleCabMeterHud } from "../lib/desktop-updates";
import { isDesktopProduct, isDesktopShell } from "../lib/desktop-product";
import { isRadioflowDesktop } from "../lib/desktop-native";

type HealthReady = {
  ready: boolean;
  database: string;
};

type HealthMeta = {
  background?: {
    mode: string;
    libraryProcessWorker: boolean;
    libraryProcessWorkerPollMs: number;
    cueDetectBackfill: boolean;
    audioFfmpeg: boolean;
    audioFfprobe: boolean;
    embeddedStandalone: boolean;
  };
};

export function DesktopStatusPage() {
  const { token, user } = useAuth();
  const [userDataPath, setUserDataPath] = useState<string | null>(null);
  const apiOrigin = getStoredApiOrigin() ?? "—";
  const [ready, setReady] = useState<HealthReady | null>(null);
  const [meta, setMeta] = useState<HealthMeta | null>(null);
  const [hudVisible, setHudVisible] = useState<boolean | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const desktopShell = isDesktopShell();
  const embedded = isDesktopProduct();
  const nativeFs = isRadioflowDesktop();

  useEffect(() => {
    void window.radioflow?.paths?.userData?.().then(setUserDataPath).catch(() => setUserDataPath(null));
    void isCabMeterHudVisible().then(setHudVisible);
  }, []);

  useEffect(() => {
    if (!token) return;
    void apiFetch<HealthReady>("/api/health/ready", { token })
      .then(setReady)
      .catch(() => setReady(null));
    void apiFetch<HealthMeta>("/api/health/meta", { token })
      .then(setMeta)
      .catch(() => setMeta(null));
  }, [token]);

  const onOpenData = useCallback(async () => {
    const res = await openAppDataFolder();
    if (!res.ok) setMsg(res.message ?? "No se pudo abrir la carpeta");
    else setMsg(`Carpeta abierta: ${res.path}`);
  }, []);

  const onCheckUpdates = useCallback(async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await checkDesktopUpdates();
      if (r.status === "unavailable") {
        setMsg("Actualizaciones solo en la aplicación Electron empaquetada.");
      } else if (r.status === "dev") {
        setMsg("Modo desarrollo: sin canal de actualizaciones.");
      } else if (r.status === "error") {
        setMsg(r.error ?? "Error al comprobar actualizaciones.");
      } else {
        setMsg(`Estado: ${r.status}${r.version ? ` · ${r.version}` : ""}`);
      }
    } finally {
      setBusy(false);
    }
  }, []);

  const onToggleHud = useCallback(async () => {
    const next = await toggleCabMeterHud();
    if (next == null) {
      setMsg("Medidor VU flotante solo en RadioFlow Desktop.");
      return;
    }
    setHudVisible(next);
  }, []);

  if (!desktopShell) {
    return (
      <section className="card">
        <h1>Escritorio</h1>
        <p className="muted">Esta pantalla está pensada para la aplicación de escritorio (Electron).</p>
        <Link to="/help">Ayuda</Link>
      </section>
    );
  }

  return (
    <section className="card desktop-status-page">
      <h1>RadioFlow Desktop</h1>
      <p className="muted">Estado del instalador, API embebida, medidor VU y actualizaciones.</p>

      <dl className="desktop-status-dl mt">
        <div>
          <dt className="muted small">Modo producto</dt>
          <dd>{embedded ? "Instalador (API SQLite embebida)" : "Cliente contra servidor remoto"}</dd>
        </div>
        <div>
          <dt className="muted small">Explorador nativo</dt>
          <dd>{nativeFs ? "Disponible" : "No detectado"}</dd>
        </div>
        <div>
          <dt className="muted small">URL del API</dt>
          <dd className="mono">{apiOrigin}</dd>
        </div>
        {userDataPath ? (
          <div>
            <dt className="muted small">Carpeta de datos</dt>
            <dd className="mono small">{userDataPath}</dd>
          </div>
        ) : null}
        {ready ? (
          <div>
            <dt className="muted small">API / base de datos</dt>
            <dd>
              {ready.ready ? "Lista" : "No lista"} · DB {ready.database}
            </dd>
          </div>
        ) : null}
        {meta?.background ? (
          <div>
            <dt className="muted small">Workers biblioteca (B2)</dt>
            <dd>
              {meta.background.libraryProcessWorker ? "Activos" : "Inactivos"} · modo {meta.background.mode}
              {meta.background.libraryProcessWorker
                ? ` · poll ${meta.background.libraryProcessWorkerPollMs} ms`
                : ""}
              {" · "}
              FFmpeg {meta.background.audioFfmpeg ? "on" : "off"}
              {" · "}
              cues {meta.background.cueDetectBackfill ? "on" : "off"}
            </dd>
          </div>
        ) : null}
        {user ? (
          <div>
            <dt className="muted small">Sesión</dt>
            <dd>
              {user.email} ({user.role})
            </dd>
          </div>
        ) : null}
        {hudVisible != null ? (
          <div>
            <dt className="muted small">Medidor VU flotante</dt>
            <dd>{hudVisible ? "Visible" : "Oculto"}</dd>
          </div>
        ) : null}
      </dl>

      <div className="row tight mt" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
        <button type="button" className="btn btn-compact" onClick={() => void onOpenData()}>
          Abrir carpeta de datos…
        </button>
        <button type="button" className="btn btn-compact" onClick={() => void onToggleHud()}>
          {hudVisible ? "Ocultar medidor VU" : "Mostrar medidor VU"}
        </button>
        <button type="button" className="btn btn-compact primary" disabled={busy} onClick={() => void onCheckUpdates()}>
          {busy ? "Comprobando…" : "Buscar actualizaciones…"}
        </button>
        {!embedded ? (
          <Link to="/conexion" className="btn btn-compact ghost">
            Servidor API…
          </Link>
        ) : null}
        <Link to="/station" className="btn btn-compact ghost">
          Cabina
        </Link>
      </div>

      {msg ? <p className="muted small mt">{msg}</p> : null}

      <p className="muted small mt">
        Teclas cart <strong>1–0</strong> globales en la aplicación instalada. Playout headless activo cuando la API corre en modo{" "}
        <code className="mono">full</code> (instalador embebido).
      </p>
    </section>
  );
}
