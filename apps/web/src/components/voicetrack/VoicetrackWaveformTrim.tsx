import { useEffect, useMemo, useState } from "react";
import { computeWaveformPeaks } from "../../lib/voicetrack-audio-trim";

type Props = {
  blob: Blob;
  durationSec: number;
  startSec: number;
  endSec: number;
  disabled?: boolean;
  onChange: (next: { startSec: number; endSec: number }) => void;
};

export function VoicetrackWaveformTrim({ blob, durationSec, startSec, endSec, disabled, onChange }: Props) {
  const [peaks, setPeaks] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void computeWaveformPeaks(blob, 140)
      .then((p) => {
        if (!cancelled) setPeaks(p);
      })
      .catch(() => {
        if (!cancelled) setPeaks([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [blob]);

  const dur = Math.max(0.1, durationSec);
  const startPct = (startSec / dur) * 100;
  const endPct = (endSec / dur) * 100;

  const selectionLabel = useMemo(() => {
    const len = Math.max(0, endSec - startSec);
    return `${len.toFixed(1)} s seleccionados`;
  }, [startSec, endSec]);

  return (
    <div className="voicetrack-waveform-trim">
      <div className="voicetrack-waveform-canvas-wrap" aria-hidden={loading}>
        {loading ? (
          <span className="muted small">Generando forma de onda…</span>
        ) : (
          <div className="voicetrack-waveform-bars">
            {peaks.map((p, i) => {
              const x = (i / Math.max(1, peaks.length - 1)) * 100;
              const inSel = x >= startPct && x <= endPct;
              return (
                <div
                  key={i}
                  className={`voicetrack-waveform-bar${inSel ? " voicetrack-waveform-bar--sel" : ""}`}
                  style={{ height: `${Math.max(4, p * 100)}%` }}
                />
              );
            })}
          </div>
        )}
      </div>
      <div className="voicetrack-trim-sliders">
        <label className="muted small field-inline">
          Inicio (s)
          <input
            type="range"
            min={0}
            max={dur}
            step={0.05}
            value={startSec}
            disabled={disabled || loading}
            onChange={(e) => {
              const v = Number(e.target.value);
              onChange({ startSec: v, endSec: Math.max(v + 0.05, endSec) });
            }}
          />
          <span className="mono">{startSec.toFixed(2)}</span>
        </label>
        <label className="muted small field-inline">
          Fin (s)
          <input
            type="range"
            min={0}
            max={dur}
            step={0.05}
            value={endSec}
            disabled={disabled || loading}
            onChange={(e) => {
              const v = Number(e.target.value);
              onChange({ startSec: Math.min(startSec, v - 0.05), endSec: v });
            }}
          />
          <span className="mono">{endSec.toFixed(2)}</span>
        </label>
      </div>
      <p className="muted small">{selectionLabel} · total {dur.toFixed(1)} s</p>
    </div>
  );
}
