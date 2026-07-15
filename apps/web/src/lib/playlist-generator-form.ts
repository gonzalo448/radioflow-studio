import type { ApiPlaylistCategoryRule, ApiPlaylistGenerateBody } from "@radioflow/shared";

export type GeneratorFormMode = "simple" | "weighted" | "structure";

export type GeneratorFormState = {
  name: string;
  durationMin: number;
  mode: GeneratorFormMode;
  selectedGenres: string[];
  selectedFolders: string[];
  categoryRules: ApiPlaylistCategoryRule[];
  /** Índices o ids en el patrón de rotación (modo structure). */
  rotationIds: string[];
  order: "random" | "title";
  artistGap: number;
};

let catSeq = 0;
export function newCategoryId(): string {
  catSeq += 1;
  return `cat-${Date.now().toString(36)}-${catSeq}`;
}

export function defaultGeneratorFormState(): GeneratorFormState {
  return {
    name: "",
    durationMin: 60,
    mode: "structure",
    selectedGenres: [],
    selectedFolders: [],
    categoryRules: [],
    rotationIds: [],
    order: "random",
    artistGap: 3,
  };
}

export function formStateToGenerateBody(state: GeneratorFormState): ApiPlaylistGenerateBody {
  const body: ApiPlaylistGenerateBody = {
    targetDurationSec: Math.max(1, state.durationMin) * 60,
    order: state.order,
    minArtistGap: state.artistGap,
  };
  if (state.name.trim()) body.name = state.name.trim();

  if (state.mode === "structure" && state.categoryRules.length > 0) {
    body.categoryRules = state.categoryRules.map((r) => ({
      id: r.id || newCategoryId(),
      name: r.name,
      kind: r.kind,
      value: r.value,
      picksPerCycle: Math.max(1, r.picksPerCycle ?? 1),
      ignoreRepeatProtection: r.ignoreRepeatProtection ?? false,
      preferFewerPlays: r.preferFewerPlays ?? false,
      filters: r.filters,
    }));
    const ids = new Set(body.categoryRules.map((r) => r.id!));
    body.rotation =
      state.rotationIds.filter((id) => ids.has(id)).length > 0
        ? state.rotationIds.filter((id) => ids.has(id))
        : body.categoryRules.map((r) => r.id!);
    return body;
  }

  if (state.mode === "weighted" && state.categoryRules.length > 0) {
    body.categoryRules = state.categoryRules.map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      value: r.value,
      weight: Math.max(1, Math.min(100, r.weight ?? 25)),
      ignoreRepeatProtection: r.ignoreRepeatProtection ?? false,
      preferFewerPlays: r.preferFewerPlays ?? false,
      filters: r.filters,
    }));
    return body;
  }

  if (state.selectedGenres.length > 0) body.genres = [...state.selectedGenres];
  if (state.selectedFolders.length > 0) body.pathPrefixes = [...state.selectedFolders];
  return body;
}

export function generateBodyToFormState(body: ApiPlaylistGenerateBody): GeneratorFormState {
  const base = defaultGeneratorFormState();
  base.name = body.name ?? "";
  base.durationMin = Math.max(1, Math.round((body.targetDurationSec ?? 3600) / 60));
  base.order = body.order ?? "random";
  base.artistGap = body.minArtistGap ?? 3;

  if (body.categoryRules && body.categoryRules.length > 0) {
    base.categoryRules = body.categoryRules.map((r, i) => ({
      ...r,
      id: r.id || `cat-import-${i}`,
      weight: r.weight ?? 25,
      picksPerCycle: r.picksPerCycle ?? 1,
    }));
    if (body.rotation && body.rotation.length > 0) {
      base.mode = "structure";
      base.rotationIds = [...body.rotation];
    } else {
      base.mode = "weighted";
      base.rotationIds = [];
    }
    return base;
  }

  base.mode = "simple";
  base.selectedGenres = body.genres ? [...body.genres] : [];
  base.selectedFolders = body.pathPrefixes ? [...body.pathPrefixes] : [];
  return base;
}

export function validateGeneratorFormState(state: GeneratorFormState): string | null {
  if (state.mode === "structure") {
    if (state.categoryRules.length === 0) return "Añada al menos una categoría.";
    const bad = state.categoryRules.find((r) => !r.value.trim());
    if (bad) return "Complete el valor de cada categoría.";
    if (state.rotationIds.length === 0) {
      return "Defina la rotación: añada categorías al patrón (flecha →).";
    }
    return null;
  }
  if (state.mode === "weighted") {
    if (state.categoryRules.length === 0) return "Añada al menos una regla de categoría con peso.";
    const bad = state.categoryRules.find((r) => !r.value.trim());
    if (bad) return "Complete el valor de cada categoría.";
    return null;
  }
  if (state.selectedGenres.length === 0 && state.selectedFolders.length === 0) {
    return "Elija al menos un género o una carpeta.";
  }
  return null;
}

export function categoryRulesWeightSum(rules: ApiPlaylistCategoryRule[]): number {
  return rules.reduce((s, r) => s + (r.weight ?? 0), 0);
}
