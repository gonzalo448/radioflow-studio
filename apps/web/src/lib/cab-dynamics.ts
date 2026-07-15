export const CAB_DYNAMICS_STORAGE_KEY = "radioflow_cab_dynamics";
export const CAB_DYNAMICS_EVENT = "radioflow-cab-dynamics-change";

export type CabDynamicsPreset = "off" | "voice" | "broadcast" | "loud";

export type CabDynamics = {
  preset: CabDynamicsPreset;
  agcEnabled: boolean;
  compressorEnabled: boolean;
  /** Umbral del compresor (dB). */
  compressorThresholdDb: number;
  /** Ratio del compresor. */
  compressorRatio: number;
  /** Techo del limitador (dBFS aprox.). */
  limiterCeilingDb: number;
};

export const DEFAULT_CAB_DYNAMICS: CabDynamics = {
  preset: "broadcast",
  agcEnabled: true,
  compressorEnabled: true,
  compressorThresholdDb: -18,
  compressorRatio: 3,
  limiterCeilingDb: -1,
};

const PRESETS: Record<CabDynamicsPreset, CabDynamics> = {
  off: {
    preset: "off",
    agcEnabled: false,
    compressorEnabled: false,
    compressorThresholdDb: -24,
    compressorRatio: 2,
    limiterCeilingDb: 0,
  },
  voice: {
    preset: "voice",
    agcEnabled: true,
    compressorEnabled: true,
    compressorThresholdDb: -22,
    compressorRatio: 4,
    limiterCeilingDb: -2,
  },
  broadcast: {
    preset: "broadcast",
    agcEnabled: true,
    compressorEnabled: true,
    compressorThresholdDb: -18,
    compressorRatio: 3,
    limiterCeilingDb: -1,
  },
  loud: {
    preset: "loud",
    agcEnabled: false,
    compressorEnabled: true,
    compressorThresholdDb: -12,
    compressorRatio: 6,
    limiterCeilingDb: -0.5,
  },
};

export function cabDynamicsPreset(id: CabDynamicsPreset): CabDynamics {
  return { ...PRESETS[id] };
}

export function loadCabDynamics(): CabDynamics {
  try {
    const raw = localStorage.getItem(CAB_DYNAMICS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CAB_DYNAMICS };
    const j = JSON.parse(raw) as Partial<CabDynamics>;
    return normalizeDynamics({
      preset: (j.preset as CabDynamicsPreset) ?? "broadcast",
      agcEnabled: j.agcEnabled ?? true,
      compressorEnabled: j.compressorEnabled ?? true,
      compressorThresholdDb: j.compressorThresholdDb ?? -18,
      compressorRatio: j.compressorRatio ?? 3,
      limiterCeilingDb: j.limiterCeilingDb ?? -1,
    });
  } catch {
    return { ...DEFAULT_CAB_DYNAMICS };
  }
}

export function saveCabDynamics(d: CabDynamics): void {
  const next = normalizeDynamics(d);
  localStorage.setItem(CAB_DYNAMICS_STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(CAB_DYNAMICS_EVENT));
}

export function applyCabDynamicsPreset(preset: CabDynamicsPreset): CabDynamics {
  const next = cabDynamicsPreset(preset);
  saveCabDynamics(next);
  return next;
}

function normalizeDynamics(d: CabDynamics): CabDynamics {
  return {
    preset: d.preset in PRESETS ? d.preset : "broadcast",
    agcEnabled: !!d.agcEnabled,
    compressorEnabled: !!d.compressorEnabled,
    compressorThresholdDb: clamp(d.compressorThresholdDb, -40, 0),
    compressorRatio: clamp(d.compressorRatio, 1, 20),
    limiterCeilingDb: clamp(d.limiterCeilingDb, -6, 0),
  };
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}
