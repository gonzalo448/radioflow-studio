import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { apiFetch } from "../lib/api";
import { fetchLibraryAssets, LIBRARY_PICKER_PAGE_SIZE } from "../lib/fetch-library-assets";
import { apiUrl } from "../lib/api-base";
import {
  loadCartBrowserHotkeysEnabled,
  saveCartBrowserHotkeysEnabled,
} from "../lib/cart-hotkeys-prefs";
import {
  emitCartFireEvent,
  emitJingleSlotsChanged,
  loadCartFirePlayNow,
  saveCartFirePlayNow,
} from "../lib/cart-fire-prefs";
import { isRadioflowDesktop } from "../lib/desktop-native";
import {
  JINGLE_PAGES,
  readActiveJinglePage,
  writeActiveJinglePage,
  type JinglePageKey,
} from "../lib/jingle-page";
import { JINGLE_SLOT_KEYS, type JingleSlotKey } from "../lib/jingle-slots";
import { JingleAssignDialog } from "../components/jingles/JingleAssignDialog";
import type { ApiJingleFireResult, ApiJingleSlotsMap, ApiLibraryAsset, ApiSettings } from "@radioflow/shared";

const STORAGE_KEY = "radioflow_jingle_slots_v1";

type SlotKey = JingleSlotKey;

type StoredSlot = { assetId: string; label: string };

function readLocalSlots(): Partial<Record<SlotKey, StoredSlot>> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const j = JSON.parse(raw) as Record<string, unknown>;
    const out: Partial<Record<SlotKey, StoredSlot>> = {};
    for (const k of JINGLE_SLOT_KEYS) {
      const v = j[k];
      if (!v || typeof v !== "object" || v === null) continue;
      const o = v as { assetId?: unknown; label?: unknown };
      if (typeof o.assetId !== "string" || !o.assetId) continue;
      out[k] = {
        assetId: o.assetId,
        label: typeof o.label === "string" ? o.label : o.assetId,
      };
    }
    return out;
  } catch {
    return {};
  }
}

function mapToStored(map: ApiJingleSlotsMap): Partial<Record<SlotKey, StoredSlot>> {
  const out: Partial<Record<SlotKey, StoredSlot>> = {};
  for (const k of JINGLE_SLOT_KEYS) {
    const e = map[k];
    if (e) out[k] = { assetId: e.assetId, label: e.label };
  }
  return out;
}

/**
 * Cart wall / jingles: ranuras 1–0 sincronizadas en servidor (todos los operadores).
 */
export function JinglesPage() {
  const { token } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const assignOpen = searchParams.get("assign") === "1";
  const [slots, setSlots] = useState<Partial<Record<SlotKey, StoredSlot>>>({});
  const [assets, setAssets] = useState<ApiLibraryAsset[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<SlotKey | null>(null);
  const [shortOnly, setShortOnly] = useState(true);
  const [page, setPage] = useState<JinglePageKey>(() => readActiveJinglePage());
  const [slotsReady, setSlotsReady] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Jingles automático (básico)
  const [autoIntervalMin, setAutoIntervalMin] = useState<0 | 15 | 30 | 60>(0);
  const [autoEveryTracks, setAutoEveryTracks] = useState<number>(0);
  const [autoPageKey, setAutoPageKey] = useState<"A" | "B" | "C">("A");
  const [autoSlotKeys, setAutoSlotKeys] = useState<string[]>(["1"]);
  const [autoBusy, setAutoBusy] = useState(false);
  const [autoMsg, setAutoMsg] = useState<string | null>(null);
  const [lastFiredKey, setLastFiredKey] = useState<SlotKey | null>(null);
  const [browserCartKeys, setBrowserCartKeys] = useState(loadCartBrowserHotkeysEnabled);
  const [firePlayNow, setFirePlayNow] = useState(loadCartFirePlayNow);
  const [copyBusy, setCopyBusy] = useState(false);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  const jingleCandidates = useMemo(() => {
    const base = assets.filter((a) => {
      if (!shortOnly) return true;
      if (a.durationSec != null && a.durationSec <= 45) return true;
      const hay = `${a.title} ${a.path} ${a.genre ?? ""}`.toLowerCase();
      return hay.includes("jingle") || hay.includes("liner") || hay.includes("estación") || hay.includes("ident");
    });
    return [...base].sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
  }, [assets, shortOnly]);

  const assignedCount = useMemo(() => JINGLE_SLOT_KEYS.filter((k) => slots[k]?.assetId).length, [slots]);

  const persistSlots = useCallback(
    async (next: Partial<Record<SlotKey, StoredSlot>>) => {
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
      emitJingleSlotsChanged();
    },
    [token, page],
  );

  const scheduleSave = useCallback(
    (next: Partial<Record<SlotKey, StoredSlot>>) => {
      if (!token) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void persistSlots(next).catch((e) => {
          setMsg(e instanceof Error ? e.message : "No se pudo guardar en servidor");
        });
      }, 400);
    },
    [token, persistSlots],
  );

  useEffect(() => {
    fetchLibraryAssets({ take: LIBRARY_PICKER_PAGE_SIZE, sort: "title" })
      .then(setAssets)
      .catch(() => setAssets([]));
  }, []);

  useEffect(() => {
    apiFetch<ApiSettings>("/api/settings")
      .then((s) => {
        setAutoIntervalMin(s.jingleAutoIntervalMin ?? 0);
        setAutoEveryTracks(s.jingleAutoEveryTracks ?? 0);
        setAutoPageKey(s.jingleAutoPageKey ?? "A");
        setAutoSlotKeys(Array.isArray(s.jingleAutoSlotKeys) && s.jingleAutoSlotKeys.length ? s.jingleAutoSlotKeys : ["1"]);
      })
      .catch(() => {
        /* ignore */
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setSlotsReady(false);
    (async () => {
      try {
        const server = await apiFetch<ApiJingleSlotsMap>(`/api/jingles/slots?page=${encodeURIComponent(page)}`);
        const fromServer = mapToStored(server);
        const hasServer = Object.keys(fromServer).length > 0;
        if (!cancelled) {
          if (hasServer) {
            setSlots(fromServer);
          } else if (token && page === "A") {
            const local = readLocalSlots();
            if (Object.keys(local).length > 0) {
              setSlots(local);
              await persistSlots(local);
              try {
                localStorage.removeItem(STORAGE_KEY);
              } catch {
                /* ignore */
              }
              setMsg("Ranuras migradas desde este navegador al servidor.");
            } else {
              setSlots({});
            }
          } else {
            setSlots(page === "A" ? readLocalSlots() : {});
          }
          setSlotsReady(true);
        }
      } catch {
        if (!cancelled) {
          setSlots(page === "A" ? readLocalSlots() : {});
          setSlotsReady(true);
          setMsg("Sin servidor: usando ranuras locales.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, persistSlots, page]);

  function switchPage(next: JinglePageKey) {
    setPage(next);
    writeActiveJinglePage(next);
  }

  const assign = useCallback(
    (key: SlotKey, assetId: string) => {
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

  const fire = useCallback(
    async (key: SlotKey) => {
      const s = slots[key];
      if (!s?.assetId) {
        setMsg("Elija un audio para esta tecla (menú desplegable).");
        return;
      }
      if (!token) {
        setMsg("Inicia sesión para enviar jingles a la cola.");
        return;
      }
      setBusyKey(key);
      setMsg(null);
      try {
        const result = await apiFetch<ApiJingleFireResult>("/api/jingles/fire", {
          method: "POST",
          token,
          body: JSON.stringify({
            slotKey: key,
            pageKey: page,
            playNow: firePlayNow,
            playNext: !firePlayNow,
          }),
        });
        setLastFiredKey(key);
        emitCartFireEvent({
          ok: true,
          slotKey: key,
          pageKey: page,
          label: result.label,
          playNow: result.playNow,
          source: "page",
        });
        setMsg(
          firePlayNow
            ? `«${result.label}» al aire (corta la pista actual si había una).`
            : `«${result.label}» encolado justo después de lo al aire.`,
        );
      } catch (e) {
        const err = e instanceof Error ? e.message : "No se pudo encolar";
        setMsg(err);
        emitCartFireEvent({
          ok: false,
          slotKey: key,
          pageKey: page,
          error: err,
          source: "page",
        });
      } finally {
        setBusyKey(null);
      }
    },
    [slots, token, page, firePlayNow],
  );

  const preview = useCallback((key: SlotKey) => {
    const s = slots[key];
    if (!s?.assetId) return;
    const el = previewAudioRef.current;
    if (!el) return;
    el.src = apiUrl(`/api/library/assets/${s.assetId}/stream`);
    void el.play().catch(() => {});
  }, [slots]);

  const clearPage = useCallback(() => {
    const next: Partial<Record<SlotKey, StoredSlot>> = {};
    setSlots(next);
    scheduleSave(next);
    setMsg("Página vaciada.");
  }, [scheduleSave]);

  const copyToPage = useCallback(
    async (target: JinglePageKey) => {
      if (!token || target === page) return;
      setCopyBusy(true);
      try {
        await apiFetch<ApiJingleSlotsMap>("/api/jingles/copy-page", {
          method: "POST",
          token,
          body: JSON.stringify({ fromPageKey: page, toPageKey: target }),
        });
        setMsg(`Página ${page} copiada a ${target}.`);
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "No se pudo copiar");
      } finally {
        setCopyBusy(false);
      }
    },
    [token, page],
  );

  useEffect(() => {
    // En escritorio las teclas 1–0 las maneja Electron globalShortcut (evita doble fire).
    if (isRadioflowDesktop()) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest("input, textarea, select, [contenteditable=true]")) return;
      const k = e.key;
      if (k === "1" || k === "2" || k === "3" || k === "4" || k === "5" || k === "6" || k === "7" || k === "8" || k === "9") {
        e.preventDefault();
        void fire(k as SlotKey);
      } else if (k === "0") {
        e.preventDefault();
        void fire("0");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fire]);

  return (
    <section className="card">
      <h1>Jingles (cart wall)</h1>
      <p className="muted">
        Teclas <strong>1–0</strong> disparan la ranura de la página activa (A/B/C). Por defecto el jingle pasa{" "}
        <strong>al aire ya</strong> (corta la pista actual). Ranuras en servidor ({assignedCount}/10) — compartidas entre
        operadores. También en la <Link to="/station">cabina</Link>.
      </p>

      <section className="card nested mt">
        <h2>Jingles automático</h2>
        <p className="muted small">
          Inserta un jingle desde teclas seleccionadas al terminar la canción: por reloj (15/30/60) y/o cada N canciones.
        </p>
        {autoMsg ? (
          <p className="error small mt" role="alert">
            {autoMsg}
          </p>
        ) : null}
        <div className="row tight mt">
          <label className="field">
            <span className="label">Intervalo (reloj)</span>
            <select
              className="input"
              value={autoIntervalMin}
              onChange={(e) => setAutoIntervalMin(Number(e.target.value) as 0 | 15 | 30 | 60)}
            >
              <option value={0}>Off</option>
              <option value={15}>Cada 15 min</option>
              <option value={30}>Cada 30 min</option>
              <option value={60}>Cada 60 min</option>
            </select>
          </label>
          <label className="field">
            <span className="label">Cada cuántas canciones</span>
            <input
              className="input"
              type="number"
              min={0}
              max={500}
              value={autoEveryTracks}
              onChange={(e) => setAutoEveryTracks(Math.max(0, Math.min(500, Number(e.target.value) || 0)))}
            />
          </label>
          <label className="field">
            <span className="label">Página</span>
            <select className="input" value={autoPageKey} onChange={(e) => setAutoPageKey(e.target.value as "A" | "B" | "C")}>
              <option value="A">A</option>
              <option value="B">B</option>
              <option value="C">C</option>
            </select>
          </label>
        </div>

        <div className="mt">
          <div className="muted small">Teclas habilitadas</div>
          <div className="row tight mt">
            {["1","2","3","4","5","6","7","8","9","0"].map((k) => {
              const checked = autoSlotKeys.includes(k);
              return (
                <label key={k} className="checkbox-row" style={{ marginRight: 10 }}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      setAutoSlotKeys((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(k);
                        else next.delete(k);
                        const arr = Array.from(next);
                        return arr.length ? arr : ["1"];
                      });
                    }}
                  />
                  Tecla {k}
                </label>
              );
            })}
          </div>
        </div>

        <div className="row tight mt">
          <button
            type="button"
            className="btn primary"
            disabled={!token || autoBusy}
            onClick={() => {
              if (!token) {
                setAutoMsg("Inicia sesión para guardar.");
                return;
              }
              setAutoBusy(true);
              setAutoMsg(null);
              void apiFetch<ApiSettings>("/api/settings", {
                method: "PATCH",
                token,
                body: JSON.stringify({
                  jingleAutoIntervalMin: autoIntervalMin,
                  jingleAutoEveryTracks: autoEveryTracks,
                  jingleAutoPageKey: autoPageKey,
                  jingleAutoSlotKeys: autoSlotKeys,
                }),
              })
                .then(() => setAutoMsg("Guardado."))
                .catch((e) => setAutoMsg(e instanceof Error ? e.message : "No se pudo guardar"))
                .finally(() => setAutoBusy(false));
            }}
          >
            {autoBusy ? "Guardando…" : "Guardar jingles automático"}
          </button>
          {!token ? <span className="muted small">Inicia sesión para habilitar.</span> : null}
        </div>
      </section>

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
        {token ? (
          <>
            <button type="button" className="btn btn-compact ghost" disabled={copyBusy} onClick={() => void clearPage()}>
              Vaciar página
            </button>
            {JINGLE_PAGES.filter((p) => p !== page).map((p) => (
              <button
                key={`copy-${p}`}
                type="button"
                className="btn btn-compact ghost"
                disabled={copyBusy}
                onClick={() => void copyToPage(p)}
              >
                Copiar → {p}
              </button>
            ))}
          </>
        ) : null}
      </div>
      <label className="checkbox-row mt">
        <input
          type="checkbox"
          checked={firePlayNow}
          onChange={(e) => {
            setFirePlayNow(e.target.checked);
            saveCartFirePlayNow(e.target.checked);
          }}
        />
        Cortar pista actual al disparar (al aire inmediato)
      </label>
      <label className="checkbox-row mt">
        <input
          type="checkbox"
          checked={browserCartKeys}
          onChange={(e) => {
            setBrowserCartKeys(e.target.checked);
            saveCartBrowserHotkeysEnabled(e.target.checked);
          }}
        />
        Teclas 1–0 globales en toda la app (navegador)
      </label>
      {!slotsReady && <p className="muted small">Cargando ranuras…</p>}
      <label className="checkbox-row mt">
        <input type="checkbox" checked={shortOnly} onChange={(e) => setShortOnly(e.target.checked)} />
        Mostrar solo cortos (≤45 s) o nombre tipo jingle/ident
      </label>
      {msg ? (
        <p className="error small mt" role="alert">
          {msg}
        </p>
      ) : null}
      <div className="jingles-wall mt">
        {JINGLE_SLOT_KEYS.map((key) => {
          const sel = slots[key]?.assetId ?? "";
          const asset = sel ? assets.find((a) => a.id === sel) : null;
          const dur =
            asset?.durationSec != null
              ? `${Math.floor(asset.durationSec / 60)}:${String(asset.durationSec % 60).padStart(2, "0")}`
              : null;
          return (
            <div
              key={key}
              className={`jingles-slot-card${lastFiredKey === key ? " jingles-slot-card--fired" : ""}`}
            >
              <div className="jingles-slot-head">
                <span className="jingles-slot-key" aria-hidden>
                  {key}
                </span>
                <button
                  type="button"
                  className="btn btn-compact ghost"
                  disabled={!sel}
                  onClick={() => preview(key)}
                  title="Preescuchar"
                >
                  ▶
                </button>
                <button
                  type="button"
                  className="btn primary jingles-slot-fire"
                  disabled={busyKey !== null || !sel || !slotsReady}
                  onClick={() => void fire(key)}
                >
                  {busyKey === key ? "…" : "Al aire"}
                </button>
              </div>
              {dur ? <span className="muted small mono">{dur}</span> : null}
              <label className="jingles-slot-assign">
                <span className="sr-only">Pista para tecla {key}</span>
                <select
                  className="jingles-slot-select"
                  value={sel}
                  disabled={!slotsReady}
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
            </div>
          );
        })}
      </div>
      <audio ref={previewAudioRef} className="sr-only" preload="none" />
      <JingleAssignDialog
        open={assignOpen}
        onClose={() => {
          if (searchParams.has("assign")) {
            const next = new URLSearchParams(searchParams);
            next.delete("assign");
            setSearchParams(next, { replace: true });
          }
        }}
      />
    </section>
  );
}
