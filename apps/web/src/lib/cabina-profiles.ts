export type CabinaProfileId = "music" | "talk" | "night";

export type CabinaProfile = {
  id: CabinaProfileId;
  label: string;
  description: string;
  cabCrossfadeSec: number;
  cabFadeInSec: number;
  cabFadeOutSec: number;
  cabSilenceThresholdDb: number;
  cabReferenceGainDb: number;
};

export const CABINA_PROFILES: CabinaProfile[] = [
  {
    id: "music",
    label: "Música continua",
    description: "Smart Crossfade 2 s + Gap Killer −40 dB (recomendado).",
    cabCrossfadeSec: 2,
    cabFadeInSec: 2,
    cabFadeOutSec: 2,
    cabSilenceThresholdDb: -40,
    cabReferenceGainDb: 0,
  },
  {
    id: "talk",
    label: "Locución / talk",
    description: "Fades cortos y refuerzo de voz para cabina en vivo.",
    cabCrossfadeSec: 1,
    cabFadeInSec: 0.5,
    cabFadeOutSec: 1,
    cabSilenceThresholdDb: -35,
    cabReferenceGainDb: 2,
  },
  {
    id: "night",
    label: "Noche suave",
    description: "Transiciones un poco más largas y ganancia reducida.",
    cabCrossfadeSec: 4,
    cabFadeInSec: 3,
    cabFadeOutSec: 4,
    cabSilenceThresholdDb: -42,
    cabReferenceGainDb: -2,
  },
];

export function cabinaProfileById(id: CabinaProfileId): CabinaProfile | undefined {
  return CABINA_PROFILES.find((p) => p.id === id);
}
