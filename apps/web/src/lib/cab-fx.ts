export const CAB_FX_STORAGE_KEY = "radioflow_cab_fx_levels";
export const CAB_FX_EVENT = "radioflow-cab-fx-change";

export type CabFxLevels = {
  low: number;
  mid: number;
  high: number;
};

export const DEFAULT_CAB_FX: CabFxLevels = { low: 50, mid: 50, high: 50 };

export function loadCabFx(): CabFxLevels {
  try {
    const raw = localStorage.getItem(CAB_FX_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CAB_FX };
    const j = JSON.parse(raw) as Partial<CabFxLevels>;
    return {
      low: clampFx(j.low ?? 50),
      mid: clampFx(j.mid ?? 50),
      high: clampFx(j.high ?? 50),
    };
  } catch {
    return { ...DEFAULT_CAB_FX };
  }
}

export function saveCabFx(levels: CabFxLevels): void {
  const next = { low: clampFx(levels.low), mid: clampFx(levels.mid), high: clampFx(levels.high) };
  localStorage.setItem(CAB_FX_STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(CAB_FX_EVENT));
}

function clampFx(n: number): number {
  if (!Number.isFinite(n)) return 50;
  return Math.max(0, Math.min(100, n));
}

/** 0–100 → dB de ganancia (50 = 0 dB). */
export function cabFxLevelToDb(level: number): number {
  return ((clampFx(level) - 50) / 50) * 12;
}
