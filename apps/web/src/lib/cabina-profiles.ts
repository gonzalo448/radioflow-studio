export type CabinaProfileId = "music" | "talk" | "night";

export type CabinaProfile = {
  id: CabinaProfileId;
  label: string;
  description: string;
  cabCrossfadeSec: number;
  cabReferenceGainDb: number;
};

export const CABINA_PROFILES: CabinaProfile[] = [
  {
    id: "music",
    label: "Música continua",
    description: "Fundido largo y nivel neutro para rotación musical.",
    cabCrossfadeSec: 6,
    cabReferenceGainDb: 0,
  },
  {
    id: "talk",
    label: "Locución / talk",
    description: "Fundido corto y refuerzo de voz para cabina en vivo.",
    cabCrossfadeSec: 2,
    cabReferenceGainDb: 2,
  },
  {
    id: "night",
    label: "Noche suave",
    description: "Transiciones largas y ganancia reducida.",
    cabCrossfadeSec: 8,
    cabReferenceGainDb: -2,
  },
];

export function cabinaProfileById(id: CabinaProfileId): CabinaProfile | undefined {
  return CABINA_PROFILES.find((p) => p.id === id);
}
