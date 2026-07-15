import type { ApiLibraryFolderRow, ApiPlaylistCategoryRule, ApiPlaylistGeneratorPreset } from "@radioflow/shared";
import { folderDisplayName } from "../../lib/library-folder";
import {
  categoryRulesWeightSum,
  newCategoryId,
  type GeneratorFormState,
} from "../../lib/playlist-generator-form";
import { BUILTIN_GENERATOR_PRESETS, folderOptions } from "../../lib/playlist-generator-presets";

type Props = {
  state: GeneratorFormState;
  onChange: (next: GeneratorFormState) => void;
  genres: string[];
  folders: ApiLibraryFolderRow[];
  presets: ApiPlaylistGeneratorPreset[];
  onApplyPreset: (preset: ApiPlaylistGeneratorPreset) => void;
  onSavePreset?: () => void;
  compact?: boolean;
};

function updateRule(
  rules: ApiPlaylistCategoryRule[],
  idx: number,
  patch: Partial<ApiPlaylistCategoryRule>,
): ApiPlaylistCategoryRule[] {
  return rules.map((r, i) => (i === idx ? { ...r, ...patch } : r));
}

export function PlaylistGeneratorConfigFields({
  state,
  onChange,
  genres,
  folders,
  presets,
  onApplyPreset,
  onSavePreset,
  compact,
}: Props) {
  const folderOpts = folderOptions(folders);
  const weightSum = categoryRulesWeightSum(state.categoryRules);

  function toggleGenre(g: string) {
    const set = new Set(state.selectedGenres);
    if (set.has(g)) set.delete(g);
    else set.add(g);
    onChange({ ...state, selectedGenres: [...set] });
  }

  function toggleFolder(p: string) {
    const set = new Set(state.selectedFolders);
    if (set.has(p)) set.delete(p);
    else set.add(p);
    onChange({ ...state, selectedFolders: [...set] });
  }

  function addCategoryRule(kind: "genre" | "folder") {
    const value = kind === "genre" ? genres[0] ?? "" : folders[0]?.name ?? "";
    const id = newCategoryId();
    const name = kind === "genre" ? value || "Género" : folderDisplayName(value) || "Carpeta";
    onChange({
      ...state,
      categoryRules: [
        ...state.categoryRules,
        {
          id,
          name,
          kind,
          value,
          weight: 25,
          picksPerCycle: 1,
          ignoreRepeatProtection: kind === "folder" && /jingle|id|promo/i.test(value),
        },
      ],
      rotationIds: state.mode === "structure" ? [...state.rotationIds, id] : state.rotationIds,
    });
  }

  function appendToRotation(catId: string) {
    onChange({ ...state, rotationIds: [...state.rotationIds, catId] });
  }

  function removeRotationAt(idx: number) {
    onChange({
      ...state,
      rotationIds: state.rotationIds.filter((_, i) => i !== idx),
    });
  }

  function moveRotation(idx: number, dir: -1 | 1) {
    const next = [...state.rotationIds];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j]!, next[idx]!];
    onChange({ ...state, rotationIds: next });
  }

  const ruleById = new Map(state.categoryRules.map((r) => [r.id ?? "", r]));

  return (
    <div className="playlist-generator-fields">
      {!compact ? (
        <>
          <label className="small" style={{ display: "block" }}>
            Preset
          </label>
          <div className="row tight" style={{ marginBottom: "0.65rem", flexWrap: "wrap" }}>
            <select
              className="select"
              defaultValue=""
              onChange={(e) => {
                const id = e.target.value;
                if (!id) return;
                const preset = presets.find((p) => p.id === id);
                if (preset) onApplyPreset(preset);
                e.target.value = "";
              }}
            >
              <option value="">Aplicar preset…</option>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {BUILTIN_GENERATOR_PRESETS.some((b) => b.id === p.id) ? "" : " (personalizado)"}
                </option>
              ))}
            </select>
            {onSavePreset ? (
              <button type="button" className="btn btn-compact ghost" onClick={onSavePreset}>
                Guardar preset…
              </button>
            ) : null}
          </div>
        </>
      ) : null}

      <label className="small" style={{ display: "block" }}>
        Nombre (opcional)
      </label>
      <input
        className="library-filters-search"
        value={state.name}
        onChange={(e) => onChange({ ...state, name: e.target.value })}
        placeholder="Ej. Bloque mañana"
        style={{ marginBottom: "0.65rem" }}
      />

      <label className="small" style={{ display: "block" }}>
        Duración objetivo (minutos)
      </label>
      <input
        type="number"
        className="library-filters-search"
        min={1}
        max={1440}
        value={state.durationMin}
        onChange={(e) => onChange({ ...state, durationMin: Number(e.target.value) || 60 })}
        style={{ maxWidth: "8rem", marginBottom: "0.65rem" }}
      />

      <fieldset className="playlist-genre-modes" style={{ marginBottom: "0.65rem" }}>
        <legend className="small">Modo (Generador Pro)</legend>
        <label className="playlist-genre-mode">
          <input
            type="radio"
            name="pl-gen-mode"
            checked={state.mode === "structure"}
            onChange={() =>
              onChange({
                ...state,
                mode: "structure",
                rotationIds:
                  state.rotationIds.length > 0
                    ? state.rotationIds
                    : state.categoryRules.map((r) => r.id!).filter(Boolean),
              })
            }
          />
          Rotación estructural (patrón que se repite)
        </label>
        <label className="playlist-genre-mode">
          <input
            type="radio"
            name="pl-gen-mode"
            checked={state.mode === "weighted"}
            onChange={() => onChange({ ...state, mode: "weighted" })}
          />
          Rotación ponderada (%)
        </label>
        <label className="playlist-genre-mode">
          <input
            type="radio"
            name="pl-gen-mode"
            checked={state.mode === "simple"}
            onChange={() => onChange({ ...state, mode: "simple" })}
          />
          Mezcla simple (unión de géneros/carpetas)
        </label>
      </fieldset>

      <label className="small" style={{ display: "block" }}>
        Orden dentro de cada categoría
      </label>
      <select
        className="select"
        value={state.order}
        onChange={(e) => onChange({ ...state, order: e.target.value as "random" | "title" })}
      >
        <option value="random">Aleatorio</option>
        <option value="title">Por título</option>
      </select>

      <label className="small" style={{ display: "block", marginTop: "0.65rem" }}>
        Separación de artista (pistas)
      </label>
      <input
        type="number"
        className="library-filters-search"
        min={0}
        max={20}
        value={state.artistGap}
        onChange={(e) => onChange({ ...state, artistGap: Number(e.target.value) || 0 })}
        style={{ maxWidth: "6rem", marginBottom: "0.65rem" }}
      />

      {state.mode === "structure" || state.mode === "weighted" ? (
        <div className="playlist-generator-rotation">
          <div className="row tight" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <p className="small" style={{ margin: 0 }}>
              {state.mode === "weighted"
                ? `Categorías · suma pesos: ${weightSum}% (se normaliza)`
                : "Categorías (fuentes)"}
            </p>
            <div className="row tight">
              <button type="button" className="btn btn-compact ghost" onClick={() => addCategoryRule("genre")}>
                + Género
              </button>
              <button type="button" className="btn btn-compact ghost" onClick={() => addCategoryRule("folder")}>
                + Carpeta
              </button>
            </div>
          </div>
          {state.categoryRules.length === 0 ? (
            <p className="muted small">
              {state.mode === "structure"
                ? "Añada categorías (Music, Station ID…) y luego arme el patrón de rotación."
                : "Añada categorías con peso relativo (ej. 60 % Pop, 40 % Rock)."}
            </p>
          ) : (
            <table className="playlist-generator-rules-table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Origen</th>
                  <th>{state.mode === "weighted" ? "Peso %" : "× ciclo"}</th>
                  <th>Opciones</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {state.categoryRules.map((rule, idx) => (
                  <tr key={rule.id ?? `${rule.kind}-${idx}`}>
                    <td>
                      <input
                        className="library-filters-search"
                        style={{ maxWidth: "7rem" }}
                        value={rule.name ?? ""}
                        placeholder="Music"
                        onChange={(e) =>
                          onChange({
                            ...state,
                            categoryRules: updateRule(state.categoryRules, idx, { name: e.target.value }),
                          })
                        }
                      />
                    </td>
                    <td>
                      <div className="row tight" style={{ flexWrap: "wrap" }}>
                        <select
                          className="select"
                          value={rule.kind}
                          onChange={(e) =>
                            onChange({
                              ...state,
                              categoryRules: updateRule(state.categoryRules, idx, {
                                kind: e.target.value as "genre" | "folder",
                                value: e.target.value === "genre" ? genres[0] ?? "" : folders[0]?.name ?? "",
                              }),
                            })
                          }
                        >
                          <option value="genre">Género</option>
                          <option value="folder">Carpeta</option>
                        </select>
                        {rule.kind === "genre" ? (
                          genres.length > 0 ? (
                            <select
                              className="select"
                              value={rule.value}
                              onChange={(e) =>
                                onChange({
                                  ...state,
                                  categoryRules: updateRule(state.categoryRules, idx, {
                                    value: e.target.value,
                                  }),
                                })
                              }
                            >
                              {genres.map((g) => (
                                <option key={g} value={g}>
                                  {g}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              value={rule.value}
                              onChange={(e) =>
                                onChange({
                                  ...state,
                                  categoryRules: updateRule(state.categoryRules, idx, {
                                    value: e.target.value,
                                  }),
                                })
                              }
                            />
                          )
                        ) : (
                          <select
                            className="select"
                            value={rule.value}
                            onChange={(e) =>
                              onChange({
                                ...state,
                                categoryRules: updateRule(state.categoryRules, idx, {
                                  value: e.target.value,
                                }),
                              })
                            }
                          >
                            {folderOpts.map((f) => (
                              <option key={f.value} value={f.value}>
                                {f.label}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    </td>
                    <td>
                      {state.mode === "weighted" ? (
                        <input
                          type="number"
                          min={1}
                          max={100}
                          className="library-filters-search"
                          style={{ maxWidth: "4.5rem" }}
                          value={rule.weight ?? 25}
                          onChange={(e) =>
                            onChange({
                              ...state,
                              categoryRules: updateRule(state.categoryRules, idx, {
                                weight: Number(e.target.value) || 1,
                              }),
                            })
                          }
                        />
                      ) : (
                        <input
                          type="number"
                          min={1}
                          max={20}
                          className="library-filters-search"
                          style={{ maxWidth: "4rem" }}
                          title="Pistas cada vez que aparece en el patrón"
                          value={rule.picksPerCycle ?? 1}
                          onChange={(e) =>
                            onChange({
                              ...state,
                              categoryRules: updateRule(state.categoryRules, idx, {
                                picksPerCycle: Number(e.target.value) || 1,
                              }),
                            })
                          }
                        />
                      )}
                    </td>
                    <td>
                      <label className="voicetrack-duck-toggle" title="Como Station ID / jingle">
                        <input
                          type="checkbox"
                          checked={!!rule.ignoreRepeatProtection}
                          onChange={(e) =>
                            onChange({
                              ...state,
                              categoryRules: updateRule(state.categoryRules, idx, {
                                ignoreRepeatProtection: e.target.checked,
                              }),
                            })
                          }
                        />
                        Sin no-rep.
                      </label>
                      <label className="voicetrack-duck-toggle">
                        <input
                          type="checkbox"
                          checked={!!rule.preferFewerPlays}
                          onChange={(e) =>
                            onChange({
                              ...state,
                              categoryRules: updateRule(state.categoryRules, idx, {
                                preferFewerPlays: e.target.checked,
                              }),
                            })
                          }
                        />
                        Menos oídas
                      </label>
                      {state.mode === "structure" && rule.id ? (
                        <button
                          type="button"
                          className="btn btn-table"
                          title="Añadir al patrón de rotación"
                          onClick={() => appendToRotation(rule.id!)}
                        >
                          → Rotación
                        </button>
                      ) : null}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-table"
                        onClick={() => {
                          const id = rule.id;
                          onChange({
                            ...state,
                            categoryRules: state.categoryRules.filter((_, i) => i !== idx),
                            rotationIds: id ? state.rotationIds.filter((x) => x !== id) : state.rotationIds,
                          });
                        }}
                      >
                        Quitar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {state.mode === "structure" && state.categoryRules.length > 0 ? (
            <div className="mt" style={{ marginTop: "0.75rem" }}>
              <p className="small" style={{ marginBottom: "0.35rem" }}>
                Patrón de rotación (se repite hasta la duración). Ej.: Top100 → ID → Music → ID → Music → ID
              </p>
              {state.rotationIds.length === 0 ? (
                <p className="muted small">Use «→ Rotación» en cada categoría para armar el patrón.</p>
              ) : (
                <ol className="playlist-generator-rotation-pattern">
                  {state.rotationIds.map((id, idx) => {
                    const r = ruleById.get(id);
                    return (
                      <li key={`${id}-${idx}`} className="row tight" style={{ alignItems: "center", gap: "0.35rem" }}>
                        <span className="mono small">{idx + 1}.</span>
                        <strong className="small">{r?.name || r?.value || id}</strong>
                        <span className="muted tiny">×{r?.picksPerCycle ?? 1}</span>
                        <button type="button" className="btn btn-table" onClick={() => moveRotation(idx, -1)}>
                          ↑
                        </button>
                        <button type="button" className="btn btn-table" onClick={() => moveRotation(idx, 1)}>
                          ↓
                        </button>
                        <button type="button" className="btn btn-table" onClick={() => removeRotationAt(idx)}>
                          −
                        </button>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          ) : null}
        </div>
      ) : (
        <>
          <p className="small" style={{ marginBottom: "0.25rem" }}>
            Géneros
          </p>
          <div className="playlist-generator-chips">
            {genres.length === 0 ? (
              <span className="muted small">Sin géneros en la biblioteca.</span>
            ) : (
              genres.slice(0, 40).map((g) => (
                <button
                  key={g}
                  type="button"
                  className={`btn btn-compact${state.selectedGenres.includes(g) ? " primary" : " ghost"}`}
                  onClick={() => toggleGenre(g)}
                >
                  {g}
                </button>
              ))
            )}
          </div>

          <p className="small" style={{ margin: "0.65rem 0 0.25rem" }}>
            Carpetas
          </p>
          <div className="playlist-generator-chips">
            {folders.map((f) => (
              <button
                key={f.name}
                type="button"
                className={`btn btn-compact${state.selectedFolders.includes(f.name) ? " primary" : " ghost"}`}
                onClick={() => toggleFolder(f.name)}
              >
                {folderDisplayName(f.name)}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
