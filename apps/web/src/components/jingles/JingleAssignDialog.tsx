import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { apiFetch } from "../../lib/api";
import { fetchLibraryAssets, LIBRARY_PICKER_PAGE_SIZE } from "../../lib/fetch-library-assets";
import {
  JINGLE_PAGES,
  readActiveJinglePage,
  writeActiveJinglePage,
  type JinglePageKey,
} from "../../lib/jingle-page";
import { JINGLE_SLOT_KEYS, type JingleSlotKey } from "../../lib/jingle-slots";
import type { ApiJingleSlotsMap, ApiLibraryAsset } from "@radioflow/shared";

type StoredSlot = { assetId: string; label: string };

type Props = {
  open: boolean;
  onClose: () => void;
};

function mapToStored(map: ApiJingleSlotsMap): Partial<Record<JingleSlotKey, StoredSlot>> {
  const out: Partial<Record<JingleSlotKey, StoredSlot>> = {};
  for (const k of JINGLE_SLOT_KEYS) {
    const e = map[k];
    if (e) out[k] = { assetId: e.assetId, label: e.label };
  }
  return out;
}

/** Diálogo modal  «Asignar pistas a teclas…». */
export function JingleAssignDialog({ open, onClose }: Props) {
  const { token } = useAuth();
  const [page, setPage] = useState<JinglePageKey>(() => readActiveJinglePage());
  const [slots, setSlots] = useState<Partial<Record<JingleSlotKey, StoredSlot>>>({});
  const [assets, setAssets] = useState<ApiLibraryAsset[]>([]);
  const [shortOnly, setShortOnly] = useState(true);
  const [ready, setReady] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const jingleCandidates = useMemo(() => {
    const base = assets.filter((a) => {
      if (!shortOnly) return true;
      if (a.durationSec != null && a.durationSec <= 45) return true;
      const hay = `${a.title} ${a.path} ${a.genre ?? ""}`.toLowerCase();
      return hay.includes("jingle") || hay.includes("liner") || hay.includes("estación") || hay.includes("ident");
    });
    return [...base].sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
  }, [assets, shortOnly]);

  const persistSlots = useCallback(
    async (next: Partial<Record<JingleSlotKey, StoredSlot>>) => {
      if (!token) return;
      const body: Record<string, string | null> = {};
      for (const k of JINGLE_SLOT_KEYS) {
        body[k] = next[k]?.assetId ?? null;
      }
      await apiFetch<ApiJingleSlotsMap>("/api/jingles/slots", {
        method: "PUT",
        token,
        body: JSON.stringify({ slots: body, pageKey: page }),
      });
    },
    [token, page],
  );

  const scheduleSave = useCallback(
    (next: Partial<Record<JingleSlotKey, StoredSlot>>) => {
      if (!token) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void persistSlots(next).catch((e) => {
          setMsg(e instanceof Error ? e.message : "No se pudo guardar");
        });
      }, 400);
    },
    [token, persistSlots],
  );

  useEffect(() => {
    if (!open) return;
    setPage(readActiveJinglePage());
    setMsg(null);
    fetchLibraryAssets({ take: LIBRARY_PICKER_PAGE_SIZE, sort: "title" })
      .then(setAssets)
      .catch(() => setAssets([]));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setReady(false);
    void apiFetch<ApiJingleSlotsMap>(`/api/jingles/slots?page=${encodeURIComponent(page)}`)
      .then((server) => {
        if (!cancelled) {
          setSlots(mapToStored(server));
          setReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSlots({});
          setReady(true);
          setMsg("Sin servidor: asignaciones locales no disponibles en este diálogo.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, page]);

  const assign = useCallback(
    (key: JingleSlotKey, assetId: string) => {
      setSlots((prev) => {
        const next = { ...prev };
        if (!assetId) {
          delete next[key];
        } else {
          const a = assets.find((x) => x.id === assetId);
          next[key] = { assetId, label: a?.title ?? assetId };
        }
        scheduleSave(next);
        return next;
      });
    },
    [assets, scheduleSave],
  );

  function switchPage(next: JinglePageKey) {
    setPage(next);
    writeActiveJinglePage(next);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    onClose();
  }

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="card music-library-tool-dialog jingle-assign-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="jingle-assign-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="music-library-tool-dialog-header">
          <h2 id="jingle-assign-title" className="music-library-tool-dialog-title">
            Asignar pistas a teclas
          </h2>
          <button type="button" className="btn ghost" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </header>
        <form onSubmit={onSubmit} className="jingle-assign-form">
          <p className="muted small">
            Teclas <strong>1–0</strong> del cart wall (páginas A/B/C). Los cambios se sincronizan en el servidor.
          </p>
          <div className="row tight mt" role="tablist" aria-label="Página cart wall">
            {JINGLE_PAGES.map((p) => (
              <button
                key={p}
                type="button"
                role="tab"
                aria-selected={page === p}
                className={`btn btn-compact${page === p ? " primary" : " ghost"}`}
                onClick={() => switchPage(p)}
              >
                Página {p}
              </button>
            ))}
          </div>
          <label className="checkbox-row mt">
            <input type="checkbox" checked={shortOnly} onChange={(e) => setShortOnly(e.target.checked)} />
            Mostrar solo cortos (≤45 s) o nombre tipo jingle/ident
          </label>
          {msg ? (
            <p className="error small mt" role="alert">
              {msg}
            </p>
          ) : null}
          {!ready ? <p className="muted small mt">Cargando ranuras…</p> : null}
          <div className="jingle-assign-grid mt">
            {JINGLE_SLOT_KEYS.map((key) => {
              const sel = slots[key]?.assetId ?? "";
              return (
                <label key={key} className="jingle-assign-row field">
                  <span className="jingle-assign-key mono">Tecla {key}</span>
                  <select
                    className="jingle-assign-select"
                    value={sel}
                    disabled={!ready || !token}
                    onChange={(e) => assign(key, e.target.value)}
                  >
                    <option value="">Sin asignar</option>
                    {jingleCandidates.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.title}
                        {a.artist ? ` — ${a.artist}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
              );
            })}
          </div>
          <div className="music-library-tool-dialog-actions">
            <button type="button" className="btn ghost" onClick={onClose}>
              Cerrar
            </button>
            <button type="submit" className="btn primary">
              Listo
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
