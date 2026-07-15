import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { apiFetch } from "../../lib/api";
import {
  CABINA_HOTKEY_LABELS,
  captureKeyCode,
  DEFAULT_CABINA_HOTKEYS,
  hotkeyDisplay,
  loadCabinaHotkeys,
  saveCabinaHotkeys,
  type CabinaHotkeyAction,
  type CabinaHotkeyConfig,
} from "../../lib/cabina-hotkeys";
import { CABINA_PROFILES } from "../../lib/cabina-profiles";
import {
  applyCabDynamicsPreset,
  loadCabDynamics,
  saveCabDynamics,
  type CabDynamics,
  type CabDynamicsPreset,
} from "../../lib/cab-dynamics";
import { useStationLive } from "../../station/StationLiveContext";
import type { ApiDtmfAction, StationMode } from "@radioflow/shared";
import {
  loadCabVoiceTrackSettings,
  saveCabVoiceTrackSettings,
} from "../../lib/cab-voice-track";

export type CabinaOptionsTab = "crossfade" | "leveling" | "processing" | "hotkeys" | "profiles" | "dtmf";

const DTMF_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "*", "#"] as const;
const DTMF_PAGES = ["A", "B", "C"] as const;
const DTMF_MODES: StationMode[] = ["AUTO", "LIVE_ASSIST", "LIVE"];

function defaultDtmfActions(): Record<string, ApiDtmfAction> {
  return {
    "5": { type: "skip" },
    "1": { type: "cart", slotKey: "1" },
    "2": { type: "cart", slotKey: "2" },
    "3": { type: "cart", slotKey: "3" },
  };
}

type Props = {
  open: boolean;
  initialTab?: CabinaOptionsTab;
  onClose: () => void;
};

export function CabinaOptionsDialog({ open, initialTab = "crossfade", onClose }: Props) {
  const { token, user } = useAuth();
  const { state, refresh } = useStationLive();
  const canEdit = user?.role === "admin" || user?.role === "editor" || user?.role === "dj";

  const [tab, setTab] = useState<CabinaOptionsTab>(initialTab);
  const [crossfadeSec, setCrossfadeSec] = useState(4);
  const [referenceGainDb, setReferenceGainDb] = useState(0);
  const [vtBridgeEnabled, setVtBridgeEnabled] = useState(true);
  const [vtDuckDb, setVtDuckDb] = useState(12);
  const [dynamics, setDynamics] = useState<CabDynamics>(() => loadCabDynamics());
  const [hotkeys, setHotkeys] = useState<CabinaHotkeyConfig>(() => loadCabinaHotkeys());
  const [recording, setRecording] = useState<CabinaHotkeyAction | null>(null);
  const [dtmfActions, setDtmfActions] = useState<Record<string, ApiDtmfAction>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const openedAtRef = useRef(0);

  const dtmfAssignedCount = useMemo(() => Object.keys(dtmfActions ?? {}).length, [dtmfActions]);
  const nowPlaying = state?.nowPlaying;

  useEffect(() => {
    if (open) openedAtRef.current = performance.now();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setTab(initialTab);
    setCrossfadeSec(state?.station.cabCrossfadeSec ?? 4);
    setReferenceGainDb(state?.station.cabReferenceGainDb ?? 0);
    const vt = loadCabVoiceTrackSettings();
    setVtBridgeEnabled(vt.bridgeEnabled);
    setVtDuckDb(vt.duckDb);
    setDynamics(loadCabDynamics());
    setHotkeys(loadCabinaHotkeys());
    setDtmfActions(state?.station.dtmfActions ?? defaultDtmfActions());
    setRecording(null);
    setMsg(null);
    setErr(null);
  }, [open, initialTab, state?.station.cabCrossfadeSec, state?.station.cabReferenceGainDb]);

  useEffect(() => {
    if (!open || !recording) return;
    const onKey = (e: KeyboardEvent) => {
      const code = captureKeyCode(e);
      if (!code) return;
      e.preventDefault();
      setHotkeys((prev) => {
        const next = { ...prev, [recording]: code };
        saveCabinaHotkeys(next);
        return next;
      });
      setRecording(null);
      setMsg("Atajo actualizado.");
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, recording]);

  async function patchStation(patch: {
    cabCrossfadeSec?: number;
    cabReferenceGainDb?: number;
    dtmfActions?: Record<string, ApiDtmfAction>;
  }) {
    if (!token || !canEdit) return;
    setBusy(true);
    setErr(null);
    try {
      await apiFetch("/api/station", {
        method: "PATCH",
        token,
        body: JSON.stringify(patch),
      });
      await refresh();
      setMsg("Guardado en la estación.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setBusy(false);
    }
  }

  function onSaveHotkeys(e: FormEvent) {
    e.preventDefault();
    saveCabinaHotkeys(hotkeys);
    setMsg("Atajos guardados.");
  }

  function onOverlayPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return;
    if (performance.now() - openedAtRef.current < 320) return;
    onClose();
  }

  if (!open) return null;

  const dialog = (
    <div className="music-library-tool-overlay" role="presentation" onPointerDown={onOverlayPointerDown}>
      <div
        className="card music-library-tool-dialog cabina-options-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cabina-opt-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="music-library-tool-dialog-head">
          <h2 id="cabina-opt-title" className="music-library-tool-dialog-title">
            Opciones de cabina
          </h2>
          <button type="button" className="btn btn-compact ghost" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        </header>

        <nav className="cabina-options-tabs row tight">
          {(
            [
              ["profiles", "Perfiles"],
              ["crossfade", "Fundidos"],
              ["leveling", "Nivelación"],
              ["processing", "Procesamiento"],
              ["hotkeys", "Teclas"],
              ["dtmf", "DTMF"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`btn btn-compact${tab === id ? " primary" : " ghost"}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>

        {!canEdit && tab !== "hotkeys" ? (
          <p className="muted small">Solo lectura · rol dj+ para cambiar fundidos y ganancia de estación.</p>
        ) : null}

        {tab === "profiles" && (
          <div className="cabina-options-panel">
            <p className="muted small">
              Perfiles de salida : aplican fundido y ganancia de cabina de un solo clic.
            </p>
            <ul className="cabina-profile-list">
              {CABINA_PROFILES.map((profile) => (
                <li key={profile.id} className="cabina-profile-row">
                  <div>
                    <strong>{profile.label}</strong>
                    <p className="muted small">{profile.description}</p>
                    <p className="muted small mono">
                      Fundido {profile.cabCrossfadeSec}s · {profile.cabReferenceGainDb > 0 ? "+" : ""}
                      {profile.cabReferenceGainDb} dB
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn btn-compact primary"
                    disabled={!canEdit || !token || busy}
                    onClick={() => {
                      setCrossfadeSec(profile.cabCrossfadeSec);
                      setReferenceGainDb(profile.cabReferenceGainDb);
                      void patchStation({
                        cabCrossfadeSec: profile.cabCrossfadeSec,
                        cabReferenceGainDb: profile.cabReferenceGainDb,
                      });
                    }}
                  >
                    Aplicar
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {tab === "crossfade" && (
          <div className="cabina-options-panel">
            <p className="muted small">
              <strong>Mix point</strong> fijo (): segundos de solapamiento antes del Cue End de
              cada pista. Las pistas con silencios de cabeza/cola usan Cue Start/End detectados en Librería →
              Procesar → «Detectar cues (sin recortar)». Así la transición dura lo mismo en todas las canciones.
            </p>
            <label className="muted small voicetrack-duck-slider">
              Solapamiento (Mix)
              <input
                type="range"
                min={0}
                max={30}
                step={0.5}
                value={crossfadeSec}
                disabled={!canEdit || busy}
                onChange={(e) => setCrossfadeSec(Number(e.target.value))}
              />
              <span className="mono">{crossfadeSec.toFixed(1)} s</span>
            </label>
            <button
              type="button"
              className="btn primary btn-compact mt"
              disabled={!canEdit || !token || busy}
              onClick={() => void patchStation({ cabCrossfadeSec: crossfadeSec })}
            >
              Aplicar mix point
            </button>

            <hr style={{ border: 0, borderTop: "1px solid var(--border, #333)", margin: "1.25rem 0" }} />
            <p className="muted small">
              <strong>Voice track</strong> : la locución se superpone al outro de la canción A y a la
              intro de la B, con ducking de la cama musical. El ítem VT no suena como pista principal.
            </p>
            <label className="voicetrack-duck-toggle">
              <input
                type="checkbox"
                checked={vtBridgeEnabled}
                onChange={(e) => {
                  const next = { ...loadCabVoiceTrackSettings(), bridgeEnabled: e.target.checked };
                  saveCabVoiceTrackSettings(next);
                  setVtBridgeEnabled(next.bridgeEnabled);
                  setVtDuckDb(next.duckDb);
                  setMsg(e.target.checked ? "Puente de voice track activado." : "Voice track como pista normal.");
                }}
              />
              Solapar voice track (outro / intro)
            </label>
            <label className="muted small voicetrack-duck-slider mt">
              Duck de cama durante VT
              <input
                type="range"
                min={6}
                max={24}
                step={1}
                value={vtDuckDb}
                disabled={!vtBridgeEnabled}
                onChange={(e) => {
                  const duckDb = Number(e.target.value);
                  setVtDuckDb(duckDb);
                  saveCabVoiceTrackSettings({ bridgeEnabled: vtBridgeEnabled, duckDb });
                }}
              />
              <span className="mono">−{vtDuckDb} dB</span>
            </label>
          </div>
        )}

        {tab === "processing" && (
          <div className="cabina-options-panel">
            <p className="muted small">
              AGC, compresor y limitador en el bus Web Audio de cabina (). Los presets se guardan en
              este navegador.
            </p>
            <label className="field">
              <span className="muted small">Preset</span>
              <select
                value={dynamics.preset}
                onChange={(e) => {
                  const preset = e.target.value as CabDynamicsPreset;
                  const next = applyCabDynamicsPreset(preset);
                  setDynamics(next);
                  setMsg(`Preset «${preset}» aplicado.`);
                }}
              >
                <option value="off">Apagado</option>
                <option value="voice">Voz / locución</option>
                <option value="broadcast">Emisión (recomendado)</option>
                <option value="loud">Contenido dinámico</option>
              </select>
            </label>
            <label className="checkbox-row mt">
              <input
                type="checkbox"
                checked={dynamics.agcEnabled}
                onChange={(e) => setDynamics((d) => ({ ...d, agcEnabled: e.target.checked, preset: "broadcast" }))}
              />
              AGC automático (ganancia lenta hacia nivel objetivo)
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={dynamics.compressorEnabled}
                onChange={(e) =>
                  setDynamics((d) => ({ ...d, compressorEnabled: e.target.checked, preset: "broadcast" }))
                }
              />
              Compresor
            </label>
            <label className="muted small voicetrack-duck-slider">
              Umbral compresor (dB)
              <input
                type="range"
                min={-40}
                max={0}
                step={1}
                value={dynamics.compressorThresholdDb}
                disabled={!dynamics.compressorEnabled}
                onChange={(e) =>
                  setDynamics((d) => ({
                    ...d,
                    compressorThresholdDb: Number(e.target.value),
                    preset: "broadcast",
                  }))
                }
              />
              <span className="mono">{dynamics.compressorThresholdDb} dB</span>
            </label>
            <label className="muted small voicetrack-duck-slider">
              Ratio
              <input
                type="range"
                min={1}
                max={12}
                step={0.5}
                value={dynamics.compressorRatio}
                disabled={!dynamics.compressorEnabled}
                onChange={(e) =>
                  setDynamics((d) => ({ ...d, compressorRatio: Number(e.target.value), preset: "broadcast" }))
                }
              />
              <span className="mono">{dynamics.compressorRatio.toFixed(1)}:1</span>
            </label>
            <label className="muted small voicetrack-duck-slider">
              Techo limitador (dBFS)
              <input
                type="range"
                min={-6}
                max={0}
                step={0.5}
                value={dynamics.limiterCeilingDb}
                onChange={(e) =>
                  setDynamics((d) => ({ ...d, limiterCeilingDb: Number(e.target.value), preset: "broadcast" }))
                }
              />
              <span className="mono">{dynamics.limiterCeilingDb.toFixed(1)} dB</span>
            </label>
            <button
              type="button"
              className="btn primary btn-compact mt"
              onClick={() => {
                saveCabDynamics(dynamics);
                setMsg("Procesamiento de audio guardado.");
              }}
            >
              Guardar procesamiento
            </button>
          </div>
        )}

        {tab === "leveling" && (
          <div className="cabina-options-panel">
            <p className="muted small">
              Ganancia del bus de referencia al aire. La nivelación por pista usa{" "}
              <code className="mono">playbackGainDb</code> (jobs loudness en{" "}
              <Link to="/library?tool=process">Procesar pistas</Link>).
            </p>
            <label className="muted small voicetrack-duck-slider">
              Ganancia estación (dB)
              <input
                type="range"
                min={-24}
                max={12}
                step={0.5}
                value={referenceGainDb}
                disabled={!canEdit || busy}
                onChange={(e) => setReferenceGainDb(Number(e.target.value))}
              />
              <span className="mono">
                {referenceGainDb > 0 ? "+" : ""}
                {referenceGainDb.toFixed(1)} dB
              </span>
            </label>
            {nowPlaying ? (
              <p className="muted small mt">
                Al aire: <strong>{nowPlaying.title}</strong>
                {(nowPlaying as { playbackGainDb?: number }).playbackGainDb != null ? (
                  <> · ganancia pista {(nowPlaying as { playbackGainDb?: number }).playbackGainDb} dB</>
                ) : null}
              </p>
            ) : null}
            <button
              type="button"
              className="btn primary btn-compact mt"
              disabled={!canEdit || !token || busy}
              onClick={() => void patchStation({ cabReferenceGainDb: referenceGainDb })}
            >
              Aplicar nivelación estación
            </button>
          </div>
        )}

        {tab === "hotkeys" && (
          <form className="cabina-options-panel" onSubmit={onSaveHotkeys}>
            <p className="muted small">Atajos globales cuando no hay foco en un campo de texto.</p>
            {(Object.keys(CABINA_HOTKEY_LABELS) as CabinaHotkeyAction[]).map((action) => (
              <div key={action} className="cabina-hotkey-row row tight" style={{ alignItems: "center" }}>
                <span className="small">{CABINA_HOTKEY_LABELS[action]}</span>
                <button
                  type="button"
                  className={`btn btn-compact mono${recording === action ? " primary" : ""}`}
                  onClick={() => setRecording(action)}
                >
                  {recording === action ? "Presione una tecla…" : hotkeyDisplay(hotkeys[action])}
                </button>
                {hotkeys[action] ? (
                  <button
                    type="button"
                    className="btn btn-compact ghost"
                    title="Desactivar atajo"
                    onClick={() => setHotkeys((h) => ({ ...h, [action]: "" }))}
                  >
                    ×
                  </button>
                ) : null}
              </div>
            ))}
            <div className="row tight mt">
              <button type="submit" className="btn btn-compact ghost">
                Guardar
              </button>
              <button
                type="button"
                className="btn btn-compact ghost"
                onClick={() => {
                  setHotkeys({ ...DEFAULT_CABINA_HOTKEYS });
                  saveCabinaHotkeys(DEFAULT_CABINA_HOTKEYS);
                  setMsg("Atajos restaurados.");
                }}
              >
                Restaurar defaults
              </button>
            </div>
          </form>
        )}

        {tab === "dtmf" && (
          <div className="cabina-options-panel">
            <p className="muted small">
              Acciones por tecla DTMF. Cuando en una playlist/cola se inserta un comando{" "}
              <strong>DTMF</strong>, al pasar ese punto se ejecuta la acción configurada aquí.
            </p>
            <p className="muted small">
              Configuradas: <strong>{dtmfAssignedCount}</strong> teclas · sin configurar: ejecutan error (no hacen nada).
            </p>

            <div className="mt">
              {DTMF_KEYS.map((k) => {
                const action = dtmfActions[k];
                const type = action?.type ?? "none";
                const set = (next: ApiDtmfAction | null) =>
                  setDtmfActions((prev) => {
                    const out = { ...(prev ?? {}) };
                    if (!next) delete out[k];
                    else out[k] = next;
                    return out;
                  });
                return (
                  <div key={k} className="row tight mt" style={{ alignItems: "center", flexWrap: "wrap" }}>
                    <span className="mono" style={{ width: 26 }}>
                      {k}
                    </span>
                    <select
                      className="input"
                      value={type}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "none") set(null);
                        else if (v === "skip") set({ type: "skip" });
                        else if (v === "cart") set({ type: "cart", slotKey: "1", pageKey: "A" });
                        else if (v === "mode") set({ type: "mode", mode: "AUTO" });
                      }}
                    >
                      <option value="none">Sin acción</option>
                      <option value="skip">Skip (siguiente)</option>
                      <option value="cart">Cart (jingle)</option>
                      <option value="mode">Cambiar modo</option>
                    </select>

                    {action?.type === "cart" ? (
                      <>
                        <select
                          className="input"
                          value={action.pageKey ?? "A"}
                          onChange={(e) => set({ type: "cart", slotKey: action.slotKey, pageKey: e.target.value })}
                        >
                          {DTMF_PAGES.map((p) => (
                            <option key={p} value={p}>
                              Página {p}
                            </option>
                          ))}
                        </select>
                        <select
                          className="input"
                          value={action.slotKey}
                          onChange={(e) =>
                            set({ type: "cart", slotKey: e.target.value, pageKey: action.pageKey })
                          }
                        >
                          {["1","2","3","4","5","6","7","8","9","0"].map((s) => (
                            <option key={s} value={s}>
                              Tecla {s}
                            </option>
                          ))}
                        </select>
                      </>
                    ) : null}

                    {action?.type === "mode" ? (
                      <select
                        className="input"
                        value={action.mode}
                        onChange={(e) => set({ type: "mode", mode: e.target.value as StationMode })}
                      >
                        {DTMF_MODES.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    ) : null}
                  </div>
                );
              })}
            </div>

            <div className="row tight mt">
              <button
                type="button"
                className="btn btn-compact primary"
                disabled={!canEdit || !token || busy}
                onClick={() => void patchStation({ dtmfActions })}
              >
                Guardar DTMF
              </button>
              <button
                type="button"
                className="btn btn-compact ghost"
                disabled={busy}
                onClick={() => {
                  setDtmfActions(defaultDtmfActions());
                  setMsg("DTMF restaurado (defaults).");
                }}
              >
                Restaurar defaults
              </button>
            </div>
            <p className="muted small mt">
              Tip: inserta comandos DTMF en una playlist desde <strong>Menú Lista → Insertar comando DTMF…</strong>.
            </p>
          </div>
        )}

        {msg ? <p className="badge small mt">{msg}</p> : null}
        {err ? <p className="error small mt">{err}</p> : null}
      </div>
    </div>
  );

  return createPortal(dialog, document.body);
}
