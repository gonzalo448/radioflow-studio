import { FormEvent, useEffect, useState } from "react";
import { CABINA_PROFILES } from "../lib/cabina-profiles";
import { CAB_FX_EVENT, cabFxLevelToDb, DEFAULT_CAB_FX, loadCabFx, saveCabFx } from "../lib/cab-fx";

/** Panel FX con ecualizador de 3 bandas en cadena cabina. */
export function FxPage() {
  const [levels, setLevels] = useState(() => loadCabFx());

  useEffect(() => {
    const onChange = () => setLevels(loadCabFx());
    window.addEventListener(CAB_FX_EVENT, onChange);
    return () => window.removeEventListener(CAB_FX_EVENT, onChange);
  }, []);

  function apply(next: typeof levels) {
    setLevels(next);
    saveCabFx(next);
  }

  function onReset(e: FormEvent) {
    e.preventDefault();
    apply({ ...DEFAULT_CAB_FX });
  }

  return (
    <section className="card">
      <h1>Efectos (FX)</h1>
      <p className="muted">
        Ecualizador de 3 bandas en el bus de referencia de cabina (Web Audio). Los cambios afectan la escucha local al
        aire.
      </p>
      <form className="fx-sliders mt" onSubmit={onReset}>
        {(
          [
            ["low", "Graves (200 Hz)", levels.low],
            ["mid", "Medios (1 kHz)", levels.mid],
            ["high", "Agudos (4 kHz)", levels.high],
          ] as const
        ).map(([key, label, val]) => (
          <label key={key} className="fx-slider">
            {label}
            <input
              type="range"
              min={0}
              max={100}
              value={val}
              onChange={(e) => apply({ ...levels, [key]: Number(e.target.value) })}
            />
            <span className="mono small muted">
              {cabFxLevelToDb(val) > 0 ? "+" : ""}
              {cabFxLevelToDb(val).toFixed(1)} dB
            </span>
          </label>
        ))}
        <button type="submit" className="btn btn-compact ghost mt">
          Restablecer EQ
        </button>
      </form>
      <p className="muted small mt">
        Perfiles de cabina: {CABINA_PROFILES.map((p) => p.label).join(" · ")} — Configuración → Opciones → Perfiles.
      </p>
    </section>
  );
}
