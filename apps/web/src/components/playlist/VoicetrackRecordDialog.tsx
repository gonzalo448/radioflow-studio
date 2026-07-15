import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { ApiPlaylistDetail } from "@radioflow/shared";
import { apiFetch } from "../../lib/api";
import { notifyLibraryChanged, uploadFileToLibrary } from "../../lib/local-audio-import";
import { playPlaylistItemOnAir } from "../../lib/voicetrack-play-on-air";
import { decodeAudioBlob, trimAudioBlob } from "../../lib/voicetrack-audio-trim";
import { VoicetrackWaveformTrim } from "../voicetrack/VoicetrackWaveformTrim";
import { useStationAirPlayback } from "../../station/StationAirPlaybackContext";
import { useStationLive } from "../../station/StationLiveContext";
import {
  DEFAULT_MIC_MONITOR_GAIN_DB,
  DEFAULT_VOICETRACK_DUCK_DB,
  MIC_MONITOR_GAIN_DB_MAX,
  MIC_MONITOR_GAIN_DB_MIN,
  VOICETRACK_DUCK_DB_MAX,
  VOICETRACK_DUCK_DB_MIN,
} from "../../station/reference-duck";
import { useVoicetrackMicMonitor } from "../../station/useVoicetrackMicMonitor";

const VOICETRACK_FOLDER = "voicetracks";

type Props = {
  open: boolean;
  token: string;
  playlistId: string;
  insertAfterItemId?: string | null;
  /** Sin overlay modal (página /voicetrack). */
  embedded?: boolean;
  onClose: () => void;
  onInserted: (detail: ApiPlaylistDetail) => void;
};

function pickRecorderMime(): string | undefined {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
  for (const t of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) return t;
  }
  return undefined;
}

function extForMime(mime: string): string {
  if (mime.includes("ogg")) return ".ogg";
  if (mime.includes("mp4")) return ".m4a";
  return ".webm";
}

function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function VoicetrackRecordDialog({
  open,
  token,
  playlistId,
  insertAfterItemId,
  embedded = false,
  onClose,
  onInserted,
}: Props) {
  const { setReferenceDuckDb, play, airAssetId } = useStationAirPlayback();
  const { refresh } = useStationLive();
  const micMonitor = useVoicetrackMicMonitor();

  const [title, setTitle] = useState("");
  const [label, setLabel] = useState("");
  const [duckEnabled, setDuckEnabled] = useState(true);
  const [duckDepthDb, setDuckDepthDb] = useState(DEFAULT_VOICETRACK_DUCK_DB);
  const [monitorEnabled, setMonitorEnabled] = useState(true);
  const [monitorGainDb, setMonitorGainDb] = useState(DEFAULT_MIC_MONITOR_GAIN_DB);
  const [playOnAir, setPlayOnAir] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedMime, setRecordedMime] = useState("audio/webm");
  const [audioDurationSec, setAudioDurationSec] = useState(0);
  const [trimStartSec, setTrimStartSec] = useState(0);
  const [trimEndSec, setTrimEndSec] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  const applyDuck = useCallback(
    (active: boolean) => {
      if (active && duckEnabled) {
        setReferenceDuckDb(-duckDepthDb);
        return;
      }
      setReferenceDuckDb(0);
    },
    [duckDepthDb, duckEnabled, setReferenceDuckDb],
  );

  const stopMicMonitor = useCallback(() => {
    micMonitor.stop();
  }, [micMonitor]);

  const resetRecording = useCallback(() => {
    if (timerRef.current != null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    recorderRef.current?.stop();
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    chunksRef.current = [];
    setRecording(false);
    setElapsedSec(0);
    setRecordedBlob(null);
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPreviewUrl(null);
    setAudioDurationSec(0);
    setTrimStartSec(0);
    setTrimEndSec(0);
    stopMicMonitor();
    applyDuck(false);
  }, [applyDuck, stopMicMonitor]);

  useEffect(() => {
    if (!open) {
      resetRecording();
      setReferenceDuckDb(0);
      setError(null);
      setBusy(false);
      return;
    }
    const stamp = new Date().toLocaleString("es-AR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    setTitle(`Voicetrack ${stamp}`);
    setLabel("");
    setDuckEnabled(true);
    setDuckDepthDb(DEFAULT_VOICETRACK_DUCK_DB);
    setMonitorEnabled(true);
    setMonitorGainDb(DEFAULT_MIC_MONITOR_GAIN_DB);
    setPlayOnAir(true);
    setError(null);
  }, [open, resetRecording, setReferenceDuckDb]);

  useEffect(() => () => {
    resetRecording();
    setReferenceDuckDb(0);
  }, [resetRecording, setReferenceDuckDb]);

  useEffect(() => {
    if (!open) return;
    applyDuck(recording);
  }, [open, recording, applyDuck]);

  useEffect(() => {
    if (!recording || !monitorEnabled) return;
    micMonitor.setGainDb(monitorGainDb);
  }, [recording, monitorEnabled, monitorGainDb, micMonitor]);

  async function startRecording() {
    setError(null);
    resetRecording();
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Este navegador no permite grabar audio.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      if (monitorEnabled) {
        micMonitor.start(stream, monitorGainDb);
      }
      const mime = pickRecorderMime();
      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const type = recorder.mimeType || mime || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        setRecordedMime(type);
        setRecordedBlob(blob);
        void decodeAudioBlob(blob)
          .then((buf) => {
            setAudioDurationSec(buf.duration);
            setTrimStartSec(0);
            setTrimEndSec(buf.duration);
          })
          .catch(() => {
            setAudioDurationSec(0);
            setTrimStartSec(0);
            setTrimEndSec(0);
          });
        const url = URL.createObjectURL(blob);
        previewUrlRef.current = url;
        setPreviewUrl(url);
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        stopMicMonitor();
        applyDuck(false);
      };
      recorderRef.current = recorder;
      recorder.start(250);
      setRecording(true);
      setElapsedSec(0);
      timerRef.current = window.setInterval(() => setElapsedSec((s) => s + 1), 1000);
      if (duckEnabled && airAssetId) {
        void play().catch(() => {});
      }
      applyDuck(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo acceder al micrófono");
    }
  }

  function stopRecording() {
    if (timerRef.current != null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setRecording(false);
    applyDuck(false);
    stopMicMonitor();
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!recordedBlob || recordedBlob.size === 0) {
      setError("Grabe una locución antes de insertar.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let uploadBlob = recordedBlob;
      if (trimStartSec > 0.01 || trimEndSec < audioDurationSec - 0.01) {
        uploadBlob = await trimAudioBlob(recordedBlob, recordedMime, trimStartSec, trimEndSec);
      }
      const ext = extForMime(uploadBlob.type || recordedMime);
      const file = new File([uploadBlob], `voicetrack-${Date.now()}${ext}`, {
        type: uploadBlob.type || recordedMime,
      });
      const uploaded = await uploadFileToLibrary(token, file, { folderPathPrefix: VOICETRACK_FOLDER });
      const detail = await apiFetch<ApiPlaylistDetail>(
        `/api/playlists/${encodeURIComponent(playlistId)}/items/voicetrack`,
        {
          method: "POST",
          token,
          body: JSON.stringify({
            assetId: uploaded.id,
            title: title.trim() || undefined,
            label: label.trim() || undefined,
            insertAfterItemId: insertAfterItemId ?? null,
          }),
        },
      );
      notifyLibraryChanged();
      onInserted(detail);
      if (playOnAir) {
        await playPlaylistItemOnAir({
          token,
          playlistId,
          detail,
          assetId: uploaded.id,
          refresh,
          play,
        });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el voicetrack");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  const duckActive = recording && duckEnabled;

  const panel = (
    <>
      {!embedded ? (
        <header className="music-library-tool-dialog-head">
          <h2 id="vt-rec-title" className="music-library-tool-dialog-title">
            Grabar voicetrack
          </h2>
          <button type="button" className="btn btn-compact ghost" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        </header>
      ) : (
        <h2 id="vt-rec-title" className="small mt">
          Grabación
        </h2>
      )}

      <p className="muted small">
        Locución en vivo desde el micrófono. Se guarda en{" "}
        <code className="mono">uploads/voicetracks/</code> y se inserta en la lista abierta.
      </p>

        <fieldset className="voicetrack-duck-fieldset">
          <legend className="muted small">Ducking (cama musical)</legend>
          <label className="voicetrack-duck-toggle">
            <input
              type="checkbox"
              checked={duckEnabled}
              disabled={recording || busy}
              onChange={(e) => setDuckEnabled(e.target.checked)}
            />
            Bajar referencia al aire mientras grabo
          </label>
          <label className="muted small voicetrack-duck-slider">
            Profundidad
            <input
              type="range"
              min={VOICETRACK_DUCK_DB_MIN}
              max={VOICETRACK_DUCK_DB_MAX}
              step={1}
              value={duckDepthDb}
              disabled={!duckEnabled || recording || busy}
              onChange={(e) => setDuckDepthDb(Number(e.target.value))}
            />
            <span className="mono">−{duckDepthDb} dB</span>
          </label>
          {duckActive ? (
            <p className="voicetrack-duck-active small" aria-live="polite">
              Ducking activo: la pista al aire suena más baja para grabar encima.
            </p>
          ) : duckEnabled && airAssetId ? (
            <p className="muted small">Al grabar se reproduce la referencia al aire con ducking suave.</p>
          ) : duckEnabled && !airAssetId ? (
            <p className="muted small">No hay pista al aire; el ducking aplicará cuando haya referencia.</p>
          ) : null}
        </fieldset>

        <fieldset className="voicetrack-duck-fieldset">
          <legend className="muted small">Monitor en auriculares</legend>
          <label className="voicetrack-duck-toggle">
            <input
              type="checkbox"
              checked={monitorEnabled}
              disabled={recording || busy}
              onChange={(e) => setMonitorEnabled(e.target.checked)}
            />
            Escucharme en auriculares mientras grabo
          </label>
          <label className="muted small voicetrack-duck-slider">
            Ganancia mic
            <input
              type="range"
              min={MIC_MONITOR_GAIN_DB_MIN}
              max={MIC_MONITOR_GAIN_DB_MAX}
              step={1}
              value={monitorGainDb}
              disabled={!monitorEnabled || busy}
              onChange={(e) => setMonitorGainDb(Number(e.target.value))}
            />
            <span className="mono">
              {monitorGainDb > 0 ? "+" : ""}
              {monitorGainDb} dB
            </span>
          </label>
          <p className="muted small">
            La cama musical se escucha por la referencia al aire (con ducking si está activo).
          </p>
        </fieldset>

        <div className="voicetrack-rec-controls row tight" style={{ alignItems: "center", flexWrap: "wrap" }}>
          {!recording ? (
            <button type="button" className="btn primary btn-compact" onClick={() => void startRecording()} disabled={busy}>
              {recordedBlob ? "Volver a grabar" : "Grabar"}
            </button>
          ) : (
            <button type="button" className="btn btn-compact" onClick={stopRecording}>
              Detener · {formatElapsed(elapsedSec)}
            </button>
          )}
          {recordedBlob && !recording ? (
            <span className="muted small">
              {Math.max(1, Math.round(recordedBlob.size / 1024))} KB grabados
            </span>
          ) : null}
        </div>

        {previewUrl ? (
          <audio className="voicetrack-preview-audio mt" controls src={previewUrl} preload="metadata" />
        ) : null}

        {recordedBlob && !recording && audioDurationSec > 0 ? (
          <VoicetrackWaveformTrim
            blob={recordedBlob}
            durationSec={audioDurationSec}
            startSec={trimStartSec}
            endSec={trimEndSec}
            disabled={busy}
            onChange={({ startSec, endSec }) => {
              setTrimStartSec(startSec);
              setTrimEndSec(endSec);
            }}
          />
        ) : null}

        <form onSubmit={(e) => void onSubmit(e)} className="mt">
          <label className="muted small" style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            Título en biblioteca
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} autoComplete="off" />
          </label>
          <label className="muted small mt" style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            Etiqueta en lista (opcional)
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={500}
              placeholder="Ej. intro mañana"
              autoComplete="off"
            />
          </label>

          <label className="voicetrack-duck-toggle mt">
            <input
              type="checkbox"
              checked={playOnAir}
              disabled={busy || recording}
              onChange={(e) => setPlayOnAir(e.target.checked)}
            />
            Insertar y poner al aire
          </label>

          {error ? <p className="error small mt">{error}</p> : null}

          <div className="row tight" style={{ marginTop: "0.85rem" }}>
            <button type="submit" className="btn primary btn-compact" disabled={busy || !recordedBlob || recording}>
              {busy ? "Guardando…" : playOnAir ? "Insertar y al aire" : "Insertar en lista"}
            </button>
            {!embedded ? (
              <button type="button" className="btn btn-compact ghost" onClick={onClose} disabled={busy}>
                Cancelar
              </button>
            ) : null}
          </div>
        </form>
    </>
  );

  if (embedded) {
    return (
      <div className="voicetrack-record-embedded mt" aria-labelledby="vt-rec-title">
        {panel}
      </div>
    );
  }

  return (
    <div className="music-library-tool-overlay" role="presentation" onClick={onClose}>
      <div
        className="card music-library-tool-dialog voicetrack-record-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vt-rec-title"
        onClick={(e) => e.stopPropagation()}
      >
        {panel}
      </div>
    </div>
  );
}
