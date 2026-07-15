import { FormEvent, useEffect, useMemo, useState } from "react";
import type {
  ApiLibraryFolderRow,
  ApiPlaylistGeneratorPreset,
  ApiSchedulerEvent,
  ApiSchedulerEventCreateBody,
  SchedulerCommand,
} from "@radioflow/shared";
import { apiFetch } from "../../lib/api";
import { PlaylistGeneratorConfigFields } from "../playlist/PlaylistGeneratorConfigFields";
import {
  formStateToGenerateBody,
  generateBodyToFormState,
  validateGeneratorFormState,
  type GeneratorFormState,
} from "../../lib/playlist-generator-form";
import {
  initialGenFormForTemplate,
  runAtFromSchedulePreset,
  schedulePresetLabel,
  SCHEDULER_WIZARD_TEMPLATES,
  templateById,
  type SchedulePreset,
  type SchedulerWizardTemplateId,
} from "../../lib/scheduler-event-wizard-templates";

type Props = {
  open: boolean;
  token: string;
  playlists: { id: string; name: string }[];
  assets: { id: string; title: string; artist: string | null }[];
  genres: string[];
  folders: ApiLibraryFolderRow[];
  presets: ApiPlaylistGeneratorPreset[];
  onClose: () => void;
  onCreated: () => void;
};

const STEPS = ["Plantilla", "Configurar", "Revisar"] as const;

export function SchedulerEventWizard({
  open,
  token,
  playlists,
  assets,
  genres,
  folders,
  presets,
  onClose,
  onCreated,
}: Props) {
  const [step, setStep] = useState(0);
  const [templateId, setTemplateId] = useState<SchedulerWizardTemplateId>("generate_hour_block");
  const [name, setName] = useState("");
  const [schedulePreset, setSchedulePreset] = useState<SchedulePreset>("manual");
  const [customRunAt, setCustomRunAt] = useState("");
  const [repeatIntervalMin, setRepeatIntervalMin] = useState(0);
  const [playlistId, setPlaylistId] = useState("");
  const [replaceQueue, setReplaceQueue] = useState(true);
  const [assetId, setAssetId] = useState("");
  const [command, setCommand] = useState<SchedulerCommand>("STATION_SKIP");
  const [genForm, setGenForm] = useState<GeneratorFormState>(() => initialGenFormForTemplate(templateById("generate_hour_block")));
  const [adSpotCount, setAdSpotCount] = useState(2);
  const [adPathPrefix, setAdPathPrefix] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const template = useMemo(() => templateById(templateId), [templateId]);

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setTemplateId("generate_hour_block");
    setName(templateById("generate_hour_block").defaultName);
    setSchedulePreset("manual");
    setCustomRunAt("");
    setRepeatIntervalMin(0);
    setReplaceQueue(true);
    setGenForm(initialGenFormForTemplate(templateById("generate_hour_block")));
    setAdSpotCount(2);
    setAdPathPrefix("");
    setCommand("STATION_SKIP");
    setError(null);
    setBusy(false);
    if (playlists[0]) {
      setPlaylistId(playlists[0].id);
    }
    if (assets[0]) {
      setAssetId(assets[0].id);
    }
  }, [open, playlists, assets]);

  useEffect(() => {
    if (!open) return;
    const t = templateById(templateId);
    setName(t.defaultName);
    setReplaceQueue(t.defaultReplaceQueue ?? true);
    setGenForm(initialGenFormForTemplate(t));
    setCommand(t.defaultCommand ?? "STATION_SKIP");
    setAdSpotCount(t.defaultAdSpotCount ?? 2);
  }, [templateId, open]);

  function buildPayload(): Record<string, unknown> {
    if (template.actionType === "GENERATE_AND_PLAY_PLAYLIST") {
      return { generate: formStateToGenerateBody(genForm), replaceQueue };
    }
    if (template.actionType === "PLAY_AD_BREAK") {
      return {
        ...(adSpotCount > 0 ? { spotCount: adSpotCount } : {}),
        ...(adPathPrefix.trim() ? { pathPrefix: adPathPrefix.trim() } : {}),
      };
    }
    if (template.actionType === "TIME_ANNOUNCE") {
      return { afterCurrent: true };
    }
    if (template.actionType === "PLAY_PLAYLIST") {
      return { playlistId, replaceQueue };
    }
    if (template.actionType === "PLAY_ASSET") {
      return { assetId };
    }
    if (template.actionType === "RUN_COMMAND") {
      if (command === "QUEUE_FROM_PLAYLIST_REPLACE" || command === "QUEUE_FROM_PLAYLIST_APPEND") {
        return { command, args: { playlistId } };
      }
      return { command };
    }
    return {};
  }

  function canAdvanceFromConfigure(): string | null {
    if (template.fields.includes("generator")) {
      const v = validateGeneratorFormState(genForm);
      if (v) return v;
    }
    if (template.fields.includes("playlist") && !playlistId) {
      return "Elija una lista.";
    }
    if (template.fields.includes("asset") && !assetId) {
      return "Elija una pista.";
    }
    if (schedulePreset === "custom" && !customRunAt.trim()) {
      return "Indique fecha y hora personalizada.";
    }
    return null;
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setBusy(true);
    setError(null);
    const runAt = runAtFromSchedulePreset(schedulePreset, customRunAt);
    const body: ApiSchedulerEventCreateBody = {
      name: name.trim() || template.defaultName,
      actionType: template.actionType,
      runAt,
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
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear el evento");
    } finally {
      setBusy(false);
    }
  }

  const reviewRunAt = runAtFromSchedulePreset(schedulePreset, customRunAt);
  const playlistName = playlists.find((p) => p.id === playlistId)?.name ?? "—";
  const assetLabel = assets.find((a) => a.id === assetId);

  if (!open) return null;

  return (
    <div className="music-library-tool-overlay" role="presentation" onClick={onClose}>
      <div
        className="card music-library-tool-dialog scheduler-event-wizard"
        role="dialog"
        aria-modal="true"
        aria-labelledby="scheduler-wizard-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="music-library-tool-dialog-head">
          <h2 id="scheduler-wizard-title" className="music-library-tool-dialog-title">
            Asistente de eventos
          </h2>
          <button type="button" className="btn btn-compact ghost" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        </header>

        <nav className="scheduler-wizard-steps muted small" aria-label="Pasos del asistente">
          {STEPS.map((label, i) => (
            <span key={label} className={i === step ? "scheduler-wizard-step-active" : ""}>
              {i + 1}. {label}
            </span>
          ))}
        </nav>

        {step === 0 && (
          <div className="scheduler-wizard-template-grid">
            {SCHEDULER_WIZARD_TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`scheduler-wizard-template-card${templateId === t.id ? " is-selected" : ""}`}
                onClick={() => setTemplateId(t.id)}
              >
                <strong>{t.title}</strong>
                <span className="muted small">{t.description}</span>
              </button>
            ))}
          </div>
        )}

        {step === 1 && (
          <div className="scheduler-wizard-config">
            <label className="muted small" style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
              Nombre del evento
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
            </label>

            <fieldset className="voicetrack-duck-fieldset mt">
              <legend className="muted small">Cuándo ejecutar</legend>
              <div className="scheduler-wizard-schedule-grid">
                {(["manual", "in_5", "in_15", "in_60", "tomorrow_7", "custom"] as SchedulePreset[]).map((p) => (
                  <label key={p} className="scheduler-wizard-schedule-opt">
                    <input
                      type="radio"
                      name="sched-preset"
                      checked={schedulePreset === p}
                      onChange={() => setSchedulePreset(p)}
                    />
                    {schedulePresetLabel(p)}
                  </label>
                ))}
              </div>
              {schedulePreset === "custom" ? (
                <label className="muted small mt" style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                  Fecha y hora
                  <input type="datetime-local" value={customRunAt} onChange={(e) => setCustomRunAt(e.target.value)} />
                </label>
              ) : null}
            </fieldset>

            <label className="muted small mt" style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
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

            {template.fields.includes("generator") ? (
              <div className="scheduler-gen-panel card nested mt">
                <h3 className="small">Generador Pro</h3>
                <PlaylistGeneratorConfigFields
                  compact
                  state={genForm}
                  onChange={setGenForm}
                  genres={genres}
                  folders={folders}
                  presets={presets}
                  onApplyPreset={(p) => setGenForm(generateBodyToFormState(p.config))}
                />
              </div>
            ) : null}

            {template.fields.includes("playlist") ? (
              <label className="muted small mt" style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                Playlist
                <select className="select" value={playlistId} onChange={(e) => setPlaylistId(e.target.value)}>
                  {playlists.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {template.fields.includes("replaceQueue") ? (
              <label className="checkbox-row mt">
                <input type="checkbox" checked={replaceQueue} onChange={(e) => setReplaceQueue(e.target.checked)} />
                Sustituir toda la cola al aire
              </label>
            ) : null}

            {template.fields.includes("asset") ? (
              <label className="muted small mt" style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                Pista
                <select className="select" value={assetId} onChange={(e) => setAssetId(e.target.value)}>
                  {assets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.title}
                      {a.artist ? ` — ${a.artist}` : ""}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {template.fields.includes("adBreak") ? (
              <div className="scheduler-gen-panel card nested mt">
                <label className="muted small" style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                  Spots en el bloque
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={adSpotCount}
                    onChange={(e) => setAdSpotCount(Number(e.target.value) || 2)}
                  />
                </label>
                <label className="muted small mt" style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                  Carpeta override (opcional)
                  <input value={adPathPrefix} onChange={(e) => setAdPathPrefix(e.target.value)} placeholder="publicidad/" />
                </label>
              </div>
            ) : null}
          </div>
        )}

        {step === 2 && (
          <dl className="scheduler-wizard-review muted small">
            <div>
              <dt>Plantilla</dt>
              <dd>{template.title}</dd>
            </div>
            <div>
              <dt>Nombre</dt>
              <dd>{name.trim() || template.defaultName}</dd>
            </div>
            <div>
              <dt>Programación</dt>
              <dd>
                {reviewRunAt ? new Date(reviewRunAt).toLocaleString() : "Manual — usar «Ejecutar ya» en la lista"}
              </dd>
            </div>
            {template.fields.includes("playlist") ? (
              <div>
                <dt>Playlist</dt>
                <dd>{playlistName}</dd>
              </div>
            ) : null}
            {template.fields.includes("replaceQueue") ? (
              <div>
                <dt>Cola</dt>
                <dd>{replaceQueue ? "Reemplazar" : "Añadir al final"}</dd>
              </div>
            ) : null}
            {template.fields.includes("generator") ? (
              <div>
                <dt>Generador</dt>
                <dd>
                  {genForm.durationMin} min · {genForm.order === "random" ? "aleatorio" : "por título"}
                  {genForm.categoryRules.length > 0 ? ` · ${genForm.categoryRules.length} categorías` : ""}
                </dd>
              </div>
            ) : null}
            {template.fields.includes("asset") && assetLabel ? (
              <div>
                <dt>Pista</dt>
                <dd>
                  {assetLabel.title}
                  {assetLabel.artist ? ` — ${assetLabel.artist}` : ""}
                </dd>
              </div>
            ) : null}
            {template.actionType === "RUN_COMMAND" ? (
              <div>
                <dt>Comando</dt>
                <dd>{command}</dd>
              </div>
            ) : null}
          </dl>
        )}

        {error ? <p className="error small mt">{error}</p> : null}

        <footer className="scheduler-wizard-footer row tight mt">
          {step > 0 ? (
            <button type="button" className="btn btn-compact ghost" disabled={busy} onClick={() => setStep((s) => s - 1)}>
              Atrás
            </button>
          ) : (
            <span />
          )}
          {step < 2 ? (
            <button
              type="button"
              className="btn primary btn-compact"
              disabled={busy}
              onClick={() => {
                if (step === 1) {
                  const err = canAdvanceFromConfigure();
                  if (err) {
                    setError(err);
                    return;
                  }
                  setError(null);
                }
                setStep((s) => s + 1);
              }}
            >
              Siguiente
            </button>
          ) : (
            <button type="button" className="btn primary btn-compact" disabled={busy} onClick={(e) => void onCreate(e)}>
              {busy ? "Creando…" : "Crear evento"}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
