import type { ApiLibraryFolderRow, ApiPlaylistGeneratorPreset } from "@radioflow/shared";

const STORAGE_KEY = "radioflow-playlist-generator-presets-v1";

export const BUILTIN_GENERATOR_PRESETS: ApiPlaylistGeneratorPreset[] = [
  {
    id: "builtin-structure-hour",
    name: "Estructura RB — Music → ID → Music (1 h)",
    config: {
      targetDurationSec: 3600,
      categoryRules: [
        {
          id: "music",
          name: "Music",
          kind: "genre",
          value: "Pop",
          picksPerCycle: 1,
        },
        {
          id: "station-id",
          name: "Station ID",
          kind: "folder",
          value: "jingles",
          picksPerCycle: 1,
          ignoreRepeatProtection: true,
        },
      ],
      rotation: ["music", "station-id", "music", "station-id"],
      order: "random",
      minArtistGap: 3,
    },
  },
  {
    id: "builtin-morning-pop-rock",
    name: "Mañana ponderada — Pop 60 · Rock 40 (1 h)",
    config: {
      targetDurationSec: 3600,
      categoryRules: [
        { id: "pop", kind: "genre", value: "Pop", weight: 60 },
        { id: "rock", kind: "genre", value: "Rock", weight: 40 },
      ],
      order: "random",
      minArtistGap: 3,
    },
  },
  {
    id: "builtin-afternoon-mix",
    name: "Tarde ponderada — 3 géneros (2 h)",
    config: {
      targetDurationSec: 7200,
      categoryRules: [
        { kind: "genre", value: "Pop", weight: 34 },
        { kind: "genre", value: "Rock", weight: 33 },
        { kind: "genre", value: "Latin", weight: 33 },
      ],
      order: "random",
      minArtistGap: 4,
    },
  },
  {
    id: "builtin-night-chill",
    name: "Noche — Jazz / Blues (90 min)",
    config: {
      targetDurationSec: 5400,
      categoryRules: [
        { kind: "genre", value: "Jazz", weight: 50 },
        { kind: "genre", value: "Blues", weight: 50 },
      ],
      order: "random",
      minArtistGap: 2,
    },
  },
];

export function loadGeneratorPresets(): ApiPlaylistGeneratorPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [...BUILTIN_GENERATOR_PRESETS];
    const custom = JSON.parse(raw) as ApiPlaylistGeneratorPreset[];
    if (!Array.isArray(custom)) return [...BUILTIN_GENERATOR_PRESETS];
    const builtinIds = new Set(BUILTIN_GENERATOR_PRESETS.map((p) => p.id));
    const merged = [...BUILTIN_GENERATOR_PRESETS];
    for (const p of custom) {
      if (!p?.id || !p.name || !p.config || builtinIds.has(p.id)) continue;
      merged.push(p);
    }
    return merged;
  } catch {
    return [...BUILTIN_GENERATOR_PRESETS];
  }
}

export function saveCustomGeneratorPreset(preset: ApiPlaylistGeneratorPreset): void {
  const custom = loadGeneratorPresets().filter((p) => !BUILTIN_GENERATOR_PRESETS.some((b) => b.id === p.id));
  const next = [...custom.filter((p) => p.id !== preset.id), preset];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export function deleteCustomGeneratorPreset(id: string): void {
  if (BUILTIN_GENERATOR_PRESETS.some((p) => p.id === id)) return;
  const custom = loadGeneratorPresets().filter(
    (p) => !BUILTIN_GENERATOR_PRESETS.some((b) => b.id === p.id) && p.id !== id,
  );
  localStorage.setItem(STORAGE_KEY, JSON.stringify(custom));
}

export function folderOptions(folders: ApiLibraryFolderRow[]): { value: string; label: string }[] {
  return folders.map((f) => ({
    value: f.name,
    label: `${f.name.split("/").pop() ?? f.name} (${f.count})`,
  }));
}
