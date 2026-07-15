import { FormEvent, useEffect, useState } from "react";
import type { ApiLibraryFolderRow, ApiPlaylistGenerateResult, ApiPlaylistGeneratorPreset } from "@radioflow/shared";
import { apiFetch } from "../../lib/api";
import {
  defaultGeneratorFormState,
  formStateToGenerateBody,
  generateBodyToFormState,
  validateGeneratorFormState,
} from "../../lib/playlist-generator-form";
import { loadGeneratorPresets, saveCustomGeneratorPreset } from "../../lib/playlist-generator-presets";
import { PlaylistGeneratorConfigFields } from "./PlaylistGeneratorConfigFields";

type Props = {
  open: boolean;
  token: string;
  onClose: () => void;
  onGenerated: (result: ApiPlaylistGenerateResult) => void;
};

export function PlaylistGeneratorDialog({ open, token, onClose, onGenerated }: Props) {
  const [genres, setGenres] = useState<string[]>([]);
  const [folders, setFolders] = useState<ApiLibraryFolderRow[]>([]);
  const [presets, setPresets] = useState<ApiPlaylistGeneratorPreset[]>([]);
  const [form, setForm] = useState(defaultGeneratorFormState);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setPresets(loadGeneratorPresets());
    void Promise.all([
      apiFetch<{ genres: string[] }>("/api/library/genres"),
      apiFetch<{ folders: ApiLibraryFolderRow[] }>("/api/library/folders", { token }),
    ]).then(([g, f]) => {
      setGenres(g.genres);
      setFolders(f.folders);
    });
  }, [open, token]);

  if (!open) return null;

  function applyPreset(preset: ApiPlaylistGeneratorPreset) {
    setForm(generateBodyToFormState(preset.config));
  }

  function savePreset() {
    const label = window.prompt("Nombre del preset", form.name.trim() || "Mi rotación");
    if (!label?.trim()) return;
    const validation = validateGeneratorFormState(form);
    if (validation) {
      window.alert(validation);
      return;
    }
    const preset: ApiPlaylistGeneratorPreset = {
      id: `custom-${Date.now()}`,
      name: label.trim(),
      config: formStateToGenerateBody(form),
    };
    saveCustomGeneratorPreset(preset);
    setPresets(loadGeneratorPresets());
    window.alert(`Preset «${preset.name}» guardado en este navegador.`);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const validation = validateGeneratorFormState(form);
    if (validation) {
      setError(validation);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = formStateToGenerateBody(form);
      const result = await apiFetch<ApiPlaylistGenerateResult>("/api/playlists/generate", {
        method: "POST",
        token,
        body: JSON.stringify(body),
      });
      onGenerated(result);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo generar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="music-library-tool-overlay" role="presentation" onClick={onClose}>
      <div
        className="card music-library-tool-dialog playlist-generator-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pl-gen-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="music-library-tool-dialog-head">
          <h2 id="pl-gen-title" className="music-library-tool-dialog-title">
            Generador de playlist (Pro)
          </h2>
          <button type="button" className="btn btn-compact ghost" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        </header>

        <p className="muted small">
          Generador Pro: duración objetivo, rotación ponderada por categorías, separación de artistas y
          presets reutilizables.
        </p>

        <form onSubmit={(e) => void onSubmit(e)}>
          <PlaylistGeneratorConfigFields
            state={form}
            onChange={setForm}
            genres={genres}
            folders={folders}
            presets={presets}
            onApplyPreset={applyPreset}
            onSavePreset={savePreset}
          />

          {error ? <p className="error small mt">{error}</p> : null}

          <div className="row tight" style={{ marginTop: "0.85rem" }}>
            <button type="submit" className="btn primary btn-compact" disabled={busy}>
              {busy ? "Generando…" : "Generar playlist"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
