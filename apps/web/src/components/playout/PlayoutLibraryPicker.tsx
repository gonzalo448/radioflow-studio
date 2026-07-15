import { useCallback, useEffect, useState } from "react";
import type { ApiLibraryAsset } from "@radioflow/shared";
import { setLibraryAssetDrag } from "../../lib/library-dnd";
import { fetchLibraryAssets, LIBRARY_PICKER_PAGE_SIZE } from "../../lib/fetch-library-assets";
import { LIBRARY_CHANGED_EVENT } from "../../lib/local-audio-import";

type LibraryPickAsset = Pick<ApiLibraryAsset, "id" | "title" | "artist" | "album" | "genre">;

type Props = {
  canWrite: boolean;
  onAddAssets: (assetIds: string[]) => void;
  busy?: boolean;
  token?: string | null;
};

/** Panel lateral: busca en servidor (máx. ~120 resultados) para no cargar miles de pistas. */
export function PlayoutLibraryPicker({ canWrite, onAddAssets, busy, token }: Props) {
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [rows, setRows] = useState<LibraryPickAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(q.trim()), 280);
    return () => window.clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchLibraryAssets({
        token,
        q: debouncedQ || undefined,
        take: LIBRARY_PICKER_PAGE_SIZE,
        sort: "title",
        order: "asc",
      });
      setRows(data);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [debouncedQ, token]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onChanged = () => void load();
    window.addEventListener(LIBRARY_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(LIBRARY_CHANGED_EVENT, onChanged);
  }, [load]);

  function toggle(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  return (
    <div className="rb-library-picker">
      <div className="rb-side-title">Biblioteca musical</div>
      <input
        className="rb-library-picker-search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar y arrastrar a la lista…"
        disabled={!canWrite}
        title={`Hasta ${LIBRARY_PICKER_PAGE_SIZE} resultados · catálogo completo en Librería`}
      />
      <ul className="rb-library-picker-list">
        {loading && rows.length === 0 ? (
          <li className="muted small">Buscando…</li>
        ) : rows.length === 0 ? (
          <li className="muted small">{debouncedQ ? "Sin resultados" : "Escriba para buscar o deje vacío para recientes"}</li>
        ) : (
          rows.map((a) => (
            <li
              key={a.id}
              className={`rb-library-picker-row${selected.has(a.id) ? " rb-library-picker-row--on" : ""}`}
              draggable={canWrite}
              onDragStart={(e) => {
                if (!canWrite) return;
                const ids = selected.has(a.id) && selected.size > 1 ? [...selected] : [a.id];
                setLibraryAssetDrag(e, ids);
              }}
              onClick={() => canWrite && toggle(a.id)}
              onDoubleClick={() => canWrite && onAddAssets([a.id])}
              title={canWrite ? "Doble clic: añadir a la lista activa" : undefined}
            >
              <span className="rb-library-picker-title">{a.title}</span>
              {a.artist ? <span className="muted small"> · {a.artist}</span> : null}
            </li>
          ))
        )}
      </ul>
      {canWrite ? (
        <div className="rb-library-picker-actions">
          <button
            type="button"
            className="btn btn-compact primary"
            disabled={busy || selected.size === 0}
            onClick={() => {
              onAddAssets([...selected]);
              setSelected(new Set());
            }}
          >
            Añadir seleccionadas ({selected.size})
          </button>
        </div>
      ) : null}
    </div>
  );
}
