import type {
  ApiLibraryCheckTracksResult,
  ApiLibraryVerifyResult,
} from "@radioflow/shared";

export type MusicLibraryToolMode = "process" | "check" | "verify" | null;

type ScopeSummary = {
  label: string;
  assetIds: string[];
};

type Props = {
  mode: MusicLibraryToolMode;
  scope: ScopeSummary;
  busy: boolean;
  checkResult: ApiLibraryCheckTracksResult | null;
  verifyResult: ApiLibraryVerifyResult | null;
  onClose: () => void;
  onRunProcess: (opts: {
    kind: "loudness_batch" | "bpm_detect" | "trim_silence" | "transcode_mp3";
    apply: boolean;
    targetLufs: number;
  }) => void;
  onRunCheck: (opts: { compareArtists: boolean; compareAlbums: boolean }) => void;
  onRunVerify: (dryRun: boolean) => void;
};

export function MusicLibraryToolsDialog({
  mode,
  scope,
  busy,
  checkResult,
  verifyResult,
  onClose,
  onRunProcess,
  onRunCheck,
  onRunVerify,
}: Props) {
  if (!mode) return null;

  return (
    <div className="music-library-tool-overlay" role="presentation" onClick={onClose}>
      <div
        className="card music-library-tool-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ml-tool-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="music-library-tool-dialog-head">
          <h2 id="ml-tool-title" className="music-library-tool-dialog-title">
            {mode === "process" ? "Procesar pistas" : mode === "check" ? "Comprobar pistas" : "Verificar biblioteca"}
          </h2>
          <button type="button" className="btn btn-compact ghost" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        </header>

        <p className="muted small">
          Ámbito: <strong>{scope.label}</strong>
          {scope.assetIds.length > 0 ? ` (${scope.assetIds.length} pista(s))` : ""}
        </p>

        {mode === "process" ? (
          <div className="music-library-tool-body">
            <p className="small">
              <em>Tools → Process tracks</em>: normalización EBU R128, detección de BPM
              (tags TBPM o análisis de audio con ffmpeg), cues Start/End y transcodificación.
            </p>
            <div className="row tight" style={{ flexWrap: "wrap", gap: "0.5rem", marginTop: "0.75rem" }}>
              <button
                type="button"
                className="btn primary btn-compact"
                disabled={busy || scope.assetIds.length === 0}
                onClick={() => onRunProcess({ kind: "loudness_batch", apply: true, targetLufs: -16 })}
              >
                Normalizar (−16 LUFS)
              </button>
              <button
                type="button"
                className="btn btn-compact"
                disabled={busy || scope.assetIds.length === 0}
                onClick={() => onRunProcess({ kind: "loudness_batch", apply: false, targetLufs: -16 })}
              >
                Medir loudness (sin aplicar)
              </button>
              <button
                type="button"
                className="btn btn-compact"
                disabled={busy || scope.assetIds.length === 0}
                onClick={() => onRunProcess({ kind: "bpm_detect", apply: false, targetLufs: -16 })}
              >
                Detectar BPM (tags + audio)
              </button>
              <button
                type="button"
                className="btn primary btn-compact"
                disabled={busy || scope.assetIds.length === 0}
                onClick={() => onRunProcess({ kind: "trim_silence", apply: false, targetLufs: -16 })}
                title="Analiza silencios y guarda Cue Start/End (). No modifica el archivo."
              >
                Detectar cues (sin recortar)
              </button>
              <button
                type="button"
                className="btn btn-compact"
                disabled={busy || scope.assetIds.length === 0}
                onClick={() => onRunProcess({ kind: "trim_silence", apply: true, targetLufs: -16 })}
                title="Reescribe el archivo quitando silencios (destructivo)."
              >
                Recortar silencios (archivo)
              </button>
              <button
                type="button"
                className="btn btn-compact"
                disabled={busy || scope.assetIds.length === 0}
                onClick={() => onRunProcess({ kind: "transcode_mp3", apply: false, targetLufs: -16 })}
              >
                Simular MP3 192k
              </button>
              <button
                type="button"
                className="btn btn-compact"
                disabled={busy || scope.assetIds.length === 0}
                onClick={() => onRunProcess({ kind: "transcode_mp3", apply: true, targetLufs: -16 })}
              >
                Convertir a MP3 192k
              </button>
            </div>
            {scope.assetIds.length === 0 ? (
              <p className="error small">Seleccione pistas en la tabla o filtre una vista con resultados.</p>
            ) : null}
          </div>
        ) : null}

        {mode === "check" ? (
          <div className="music-library-tool-body">
            <p className="small">
              <em>Check music tracks</em>: archivos ilegibles, duración y discrepancias de tags.
            </p>
            <div className="row tight" style={{ flexWrap: "wrap", gap: "0.5rem", marginTop: "0.75rem" }}>
              <button
                type="button"
                className="btn primary btn-compact"
                disabled={busy}
                onClick={() => onRunCheck({ compareArtists: false, compareAlbums: false })}
              >
                Comprobar título / duración
              </button>
              <button
                type="button"
                className="btn btn-compact"
                disabled={busy}
                onClick={() => onRunCheck({ compareArtists: true, compareAlbums: true })}
              >
                Incluir artista y álbum
              </button>
            </div>
            {checkResult ? (
              <div className="music-library-tool-results">
                <p className="small">
                  Inspeccionadas: {checkResult.inspected} · Con problemas: {checkResult.withIssues}
                  {checkResult.truncated ? " (lista truncada)" : ""}
                </p>
                {checkResult.issues.length === 0 ? (
                  <p className="muted small">Sin incidencias en el ámbito elegido.</p>
                ) : (
                  <ul className="music-library-tool-issue-list">
                    {checkResult.issues.slice(0, 40).map((row) => (
                      <li key={row.assetId}>
                        <strong>{row.title}</strong>
                        <span className="muted small"> — {row.issues.join(", ")}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
          </div>
        ) : null}

        {mode === "verify" ? (
          <div className="music-library-tool-body">
            <p className="small">
              <em>Verify</em>: detecta entradas del catálogo cuyo archivo ya no existe en la
              bóveda.
            </p>
            <div className="row tight" style={{ flexWrap: "wrap", gap: "0.5rem", marginTop: "0.75rem" }}>
              <button type="button" className="btn btn-compact" disabled={busy} onClick={() => onRunVerify(true)}>
                Simular (dry-run)
              </button>
              <button type="button" className="btn primary btn-compact" disabled={busy} onClick={() => onRunVerify(false)}>
                Quitar huérfanas
              </button>
            </div>
            {verifyResult ? (
              <div className="music-library-tool-results">
                <p className="small">
                  Revisadas: {verifyResult.inspected} · Huérfanas: {verifyResult.orphanCount}
                  {verifyResult.dryRun ? " (simulación)" : ` · Eliminadas: ${verifyResult.removed}`}
                </p>
                {verifyResult.samples.length > 0 ? (
                  <ul className="music-library-tool-issue-list">
                    {verifyResult.samples.slice(0, 20).map((s) => (
                      <li key={s.id}>
                        {s.title} <span className="muted mono small">{s.path}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted small">Todas las entradas resuelven a un archivo en disco.</p>
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export type { ScopeSummary };
