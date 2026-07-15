import { useEffect, useRef, useState } from "react";

export const PLAYLIST_TAB_COLORS = [
  "#e11d48",
  "#f97316",
  "#eab308",
  "#84cc16",
  "#22c55e",
  "#14b8a6",
  "#06b6d4",
  "#3b82f6",
  "#6366f1",
  "#a855f7",
  "#ec4899",
  "#78716c",
  "#64748b",
  "#1e293b",
  "#f8fafc",
  "#fca5a5",
] as const;

export function playlistTabContrastColor(hex: string): string {
  const raw = hex.replace("#", "");
  if (raw.length !== 6) return "#f8fafc";
  const r = Number.parseInt(raw.slice(0, 2), 16);
  const g = Number.parseInt(raw.slice(2, 4), 16);
  const b = Number.parseInt(raw.slice(4, 6), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) return "#f8fafc";
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55 ? "#1a1a1a" : "#f8fafc";
}

type MenuProps = {
  open: boolean;
  x: number;
  y: number;
  playlistName: string;
  currentColor: string | null;
  canEdit: boolean;
  onClose: () => void;
  onRename: () => void;
  onDelete: () => void;
  onPickColor: (color: string | null) => void;
};

/** Menú contextual de pestaña: renombrar, suprimir, color. */
export function PlaylistTabContextMenu({
  open,
  x,
  y,
  playlistName,
  currentColor,
  canEdit,
  onClose,
  onRename,
  onDelete,
  onPickColor,
}: MenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [colorOpen, setColorOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      setColorOpen(false);
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDoc);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDoc);
    };
  }, [onClose, open]);

  if (!open) return null;

  const maxX = typeof window !== "undefined" ? window.innerWidth - 200 : x;
  const maxY = typeof window !== "undefined" ? window.innerHeight - 160 : y;
  const left = Math.max(8, Math.min(x, maxX));
  const top = Math.max(8, Math.min(y, maxY));

  return (
    <div
      ref={rootRef}
      className="rb-pl-tab-ctx"
      style={{ left, top }}
      role="menu"
      aria-label={`Opciones de «${playlistName}»`}
    >
      <button
        type="button"
        role="menuitem"
        className="rb-pl-tab-ctx-item"
        disabled={!canEdit}
        onClick={() => {
          onRename();
          onClose();
        }}
      >
        Cambiar el nombre…
      </button>
      <button
        type="button"
        role="menuitem"
        className="rb-pl-tab-ctx-item"
        disabled={!canEdit}
        onClick={() => {
          onDelete();
          onClose();
        }}
      >
        Suprimir
      </button>
      <div className="rb-pl-tab-ctx-sep" role="separator" />
      <button
        type="button"
        role="menuitem"
        className={`rb-pl-tab-ctx-item rb-pl-tab-ctx-item--submenu${colorOpen ? " is-open" : ""}`}
        disabled={!canEdit}
        aria-expanded={colorOpen}
        onClick={() => setColorOpen((v) => !v)}
      >
        Color
        <span aria-hidden>▸</span>
      </button>
      {colorOpen ? (
        <div className="rb-pl-tab-color-panel" role="group" aria-label="Color de pestaña">
          <button
            type="button"
            className={`rb-pl-tab-color-swatch rb-pl-tab-color-swatch--none${!currentColor ? " is-selected" : ""}`}
            title="Sin color"
            onClick={() => {
              onPickColor(null);
              onClose();
            }}
          >
            ∅
          </button>
          {PLAYLIST_TAB_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`rb-pl-tab-color-swatch${currentColor?.toLowerCase() === c.toLowerCase() ? " is-selected" : ""}`}
              style={{ background: c }}
              title={c}
              aria-label={`Color ${c}`}
              onClick={() => {
                onPickColor(c);
                onClose();
              }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
