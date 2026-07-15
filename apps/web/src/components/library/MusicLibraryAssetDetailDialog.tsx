import { FormEvent, useEffect, useState } from "react";
import type { ApiLibraryAsset, ApiLibraryAssetPatchBody } from "@radioflow/shared";
import { apiFetch } from "../../lib/api";
import { apiUrl } from "../../lib/api-base";
import { libraryCoverUrl } from "../../lib/library-cover-url";
import { folderDisplayName } from "../../lib/library-folder";

type Props = {
  asset: ApiLibraryAsset | null;
  token: string;
  canWrite: boolean;
  onClose: () => void;
  onUpdated: (asset: ApiLibraryAsset) => void;
  onDeleted: (assetId: string) => void;
};

function fmtDur(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function isMp3Asset(asset: ApiLibraryAsset): boolean {
  if (asset.mimeType?.toLowerCase().includes("mpeg") || asset.mimeType === "audio/mp3") return true;
  return /\.mp3$/i.test(asset.path);
}

export function MusicLibraryAssetDetailDialog({ asset, token, canWrite, onClose, onUpdated, onDeleted }: Props) {
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [album, setAlbum] = useState("");
  const [genre, setGenre] = useState("");
  const [releaseYear, setReleaseYear] = useState("");
  const [id3Comment, setId3Comment] = useState("");
  const [playbackGainDb, setPlaybackGainDb] = useState("0");
  const [semanticNote, setSemanticNote] = useState("");
  const [writeToFile, setWriteToFile] = useState(false);
  const [enrichBusy, setEnrichBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!asset) return;
    setTitle(asset.title);
    setArtist(asset.artist ?? "");
    setAlbum(asset.album ?? "");
    setGenre(asset.genre ?? "");
    setReleaseYear(asset.releaseYear != null ? String(asset.releaseYear) : "");
    setId3Comment(asset.id3Comment ?? "");
    setPlaybackGainDb(String(asset.playbackGainDb ?? 0));
    setSemanticNote(asset.semanticNote ?? "");
    setWriteToFile(false);
    setMsg(null);
  }, [asset]);

  if (!asset) return null;

  const row = asset;
  const canWriteId3 = isMp3Asset(row);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canWrite) return;
    setBusy(true);
    setMsg(null);
    try {
      const gain = Number.parseFloat(playbackGainDb);
      const yearRaw = releaseYear.trim();
      const yearNum = yearRaw ? Number.parseInt(yearRaw, 10) : null;
      const body: ApiLibraryAssetPatchBody = {
        title: title.trim() || row.title,
        artist: artist.trim() || null,
        album: album.trim() || null,
        genre: genre.trim() || null,
        releaseYear: yearNum != null && Number.isFinite(yearNum) ? yearNum : null,
        id3Comment: id3Comment.trim() || null,
        playbackGainDb: Number.isFinite(gain) ? gain : 0,
        semanticNote: semanticNote.trim() || null,
      };
      let updated = await apiFetch<ApiLibraryAsset>(`/api/library/assets/${encodeURIComponent(row.id)}`, {
        method: "PATCH",
        token,
        body: JSON.stringify(body),
      });
      if (writeToFile) {
        if (!canWriteId3) {
          setMsg("Metadatos guardados en catálogo. Escritura ID3 solo disponible en MP3.");
          onUpdated(updated);
          return;
        }
        updated = await apiFetch<ApiLibraryAsset>(
          `/api/library/assets/${encodeURIComponent(row.id)}/write-to-file`,
          { method: "POST", token },
        );
        setReleaseYear(updated.releaseYear != null ? String(updated.releaseYear) : "");
        setId3Comment(updated.id3Comment ?? "");
        setMsg("Metadatos guardados y escritos al archivo MP3.");
      } else {
        setMsg("Metadatos guardados en catálogo.");
      }
      onUpdated(updated);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setBusy(false);
    }
  }

  async function syncFromFile() {
    if (!canWrite) return;
    setBusy(true);
    setMsg(null);
    try {
      const updated = await apiFetch<ApiLibraryAsset>(
        `/api/library/assets/${encodeURIComponent(row.id)}/sync-from-file`,
        { method: "POST", token },
      );
      onUpdated(updated);
      setTitle(updated.title);
      setArtist(updated.artist ?? "");
      setAlbum(updated.album ?? "");
      setGenre(updated.genre ?? "");
      setReleaseYear(updated.releaseYear != null ? String(updated.releaseYear) : "");
      setId3Comment(updated.id3Comment ?? "");
      setMsg("Metadatos releídos desde el archivo.");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Error al releer archivo");
    } finally {
      setBusy(false);
    }
  }

  async function writeId3ToFile() {
    if (!canWrite || !canWriteId3) return;
    setBusy(true);
    setMsg(null);
    try {
      const updated = await apiFetch<ApiLibraryAsset>(
        `/api/library/assets/${encodeURIComponent(row.id)}/write-to-file`,
        { method: "POST", token },
      );
      onUpdated(updated);
      setTitle(updated.title);
      setArtist(updated.artist ?? "");
      setAlbum(updated.album ?? "");
      setGenre(updated.genre ?? "");
      setReleaseYear(updated.releaseYear != null ? String(updated.releaseYear) : "");
      setId3Comment(updated.id3Comment ?? "");
      setMsg("Tags ID3 escritos al archivo y verificados.");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Error al escribir ID3");
    } finally {
      setBusy(false);
    }
  }

  async function enrichWithOllama() {
    if (!canWrite) return;
    setEnrichBusy(true);
    setMsg(null);
    try {
      const updated = await apiFetch<ApiLibraryAsset>(
        `/api/semantic/enrich/${encodeURIComponent(row.id)}`,
        { method: "POST", token },
      );
      onUpdated(updated);
      setSemanticNote(updated.semanticNote ?? "");
      setMsg("Nota y embedding generados con Ollama.");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Ollama no disponible");
    } finally {
      setEnrichBusy(false);
    }
  }

  async function deleteAsset() {
    if (!canWrite) return;
    if (
      !window.confirm(
        `¿Borrar «${row.title}»?\n\nSe eliminará del catálogo y el archivo de audio del equipo.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await apiFetch(`/api/library/assets/${encodeURIComponent(row.id)}`, { method: "DELETE", token });
      onDeleted(row.id);
      onClose();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "No se pudo eliminar");
      setBusy(false);
    }
  }

  const pathLabel = row.path.includes("/") ? folderDisplayName(row.path.split("/").slice(0, -1).join("/")) : row.path;

  return (
    <div className="music-library-tool-overlay" role="presentation" onClick={onClose}>
      <div
        className="card music-library-tool-dialog music-library-asset-detail-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ml-asset-detail-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="music-library-tool-dialog-head">
          <h2 id="ml-asset-detail-title" className="music-library-tool-dialog-title">
            Información de pista
          </h2>
          <button type="button" className="btn btn-compact ghost" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        </header>

        <div className="music-library-asset-detail-layout">
          <div className="music-library-asset-detail-cover">
            {libraryCoverUrl(row.id, row.coverPath) ? (
              <img src={libraryCoverUrl(row.id, row.coverPath)!} alt="" />
            ) : (
              <span className="music-library-thumb-ph">♪</span>
            )}
            <audio controls src={apiUrl(`/api/library/assets/${row.id}/stream`)} preload="none" className="preview-audio" />
          </div>

          <form className="music-library-asset-detail-form" onSubmit={(e) => void onSubmit(e)}>
            <label className="music-library-field">
              <span>Título</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={!canWrite || busy} />
            </label>
            <label className="music-library-field">
              <span>Artista</span>
              <input value={artist} onChange={(e) => setArtist(e.target.value)} disabled={!canWrite || busy} />
            </label>
            <label className="music-library-field">
              <span>Álbum</span>
              <input value={album} onChange={(e) => setAlbum(e.target.value)} disabled={!canWrite || busy} />
            </label>
            <label className="music-library-field">
              <span>Género</span>
              <input value={genre} onChange={(e) => setGenre(e.target.value)} disabled={!canWrite || busy} />
            </label>
            <label className="music-library-field">
              <span>Año</span>
              <input
                type="number"
                min={1900}
                max={2100}
                placeholder="YYYY"
                value={releaseYear}
                onChange={(e) => setReleaseYear(e.target.value)}
                disabled={!canWrite || busy}
              />
            </label>
            <label className="music-library-field">
              <span>Comentario ID3</span>
              <textarea
                rows={2}
                value={id3Comment}
                onChange={(e) => setId3Comment(e.target.value)}
                disabled={!canWrite || busy}
              />
            </label>
            <label className="music-library-field">
              <span>Ganancia cabina (dB)</span>
              <input
                type="number"
                step="0.1"
                value={playbackGainDb}
                onChange={(e) => setPlaybackGainDb(e.target.value)}
                disabled={!canWrite || busy}
              />
            </label>
            <label className="music-library-field">
              <span>Nota semántica (Ollama)</span>
              <textarea
                rows={3}
                value={semanticNote}
                onChange={(e) => setSemanticNote(e.target.value)}
                disabled={!canWrite || busy || enrichBusy}
              />
              {row.embeddingRef ? (
                <span className="muted tiny">Embedding indexado</span>
              ) : (
                <span className="muted tiny">Sin embedding — use «Generar con Ollama»</span>
              )}
            </label>

            {canWrite && canWriteId3 ? (
              <label className="music-library-field music-library-field-check">
                <input
                  type="checkbox"
                  checked={writeToFile}
                  onChange={(e) => setWriteToFile(e.target.checked)}
                  disabled={busy}
                />
                <span>También escribir tags al archivo MP3</span>
              </label>
            ) : null}

            <dl className="music-library-asset-tech muted small">
              <div>
                <dt>Duración</dt>
                <dd>{fmtDur(row.durationSec)}</dd>
              </div>
              <div>
                <dt>Carpeta</dt>
                <dd>{pathLabel}</dd>
              </div>
              <div>
                <dt>Ruta</dt>
                <dd className="mono">{row.path}</dd>
              </div>
              {row.mimeType ? (
                <div>
                  <dt>Formato</dt>
                  <dd>{row.mimeType}</dd>
                </div>
              ) : null}
              {row.audioBitrateKbps != null ? (
                <div>
                  <dt>Bitrate</dt>
                  <dd>{row.audioBitrateKbps} kbps</dd>
                </div>
              ) : null}
              {row.audioSampleRateHz != null ? (
                <div>
                  <dt>Sample rate</dt>
                  <dd>{row.audioSampleRateHz} Hz</dd>
                </div>
              ) : null}
              {row.audioChannels != null ? (
                <div>
                  <dt>Canales</dt>
                  <dd>{row.audioChannels}</dd>
                </div>
              ) : null}
            </dl>

            {msg ? <p className={`small ${msg.includes("Error") || msg.includes("No se") ? "error" : "muted"}`}>{msg}</p> : null}

            <div className="row tight music-library-asset-detail-actions">
              {canWrite ? (
                <>
                  <button type="submit" className="btn primary btn-compact" disabled={busy}>
                    {busy ? "…" : "Guardar"}
                  </button>
                  <button type="button" className="btn btn-compact" disabled={busy || enrichBusy} onClick={() => void enrichWithOllama()}>
                    {enrichBusy ? "Ollama…" : "Generar con Ollama"}
                  </button>
                  <button type="button" className="btn btn-compact" disabled={busy} onClick={() => void syncFromFile()}>
                    Releer ID3
                  </button>
                  {canWriteId3 ? (
                    <button type="button" className="btn btn-compact" disabled={busy} onClick={() => void writeId3ToFile()}>
                      Escribir al archivo
                    </button>
                  ) : null}
                  <button type="button" className="btn btn-compact danger" disabled={busy} onClick={() => void deleteAsset()}>
                    Borrar pista
                  </button>
                </>
              ) : null}
              <button type="button" className="btn btn-compact ghost" onClick={onClose}>
                Cerrar
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
