import { useCallback, useEffect, useRef, useState } from "react";

type MenuItem =
  | { kind: "item"; label: string; onSelect?: () => void; disabled?: boolean; detail?: string }
  | { kind: "divider" };

type TopMenu = { id: string; label: string; items: MenuItem[] };

export type MusicLibraryMenuBarProps = {
  canWrite: boolean;
  onAddFiles: () => void;
  onAddFolder: () => void;
  onAddM3u: () => void;
  onProcessTracks: () => void;
  onCheckTracks: () => void;
  onVerifyLibrary: () => void;
  onUpdateMetadata: () => void;
  onAutoUpdate: () => void;
  onTrackInfo: () => void;
  onCustomFields: () => void;
  canTrackInfo: boolean;
  canCustomFields: boolean;
};

/**
 * Menús internos de la ventana «Biblioteca musical» ( Add + Tools dentro del módulo).
 */
export function MusicLibraryMenuBar({
  canWrite,
  onAddFiles,
  onAddFolder,
  onAddM3u,
  onProcessTracks,
  onCheckTracks,
  onVerifyLibrary,
  onUpdateMetadata,
  onAutoUpdate,
  onTrackInfo,
  onCustomFields,
  canTrackInfo,
  canCustomFields,
}: MusicLibraryMenuBarProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpenId(null), []);

  const menus: TopMenu[] = [
    {
      id: "add",
      label: "Añadir",
      items: [
        {
          kind: "item",
          label: "Archivo(s)…",
          disabled: !canWrite,
          detail: "Copia a la bóveda",
          onSelect: onAddFiles,
        },
        {
          kind: "item",
          label: "Carpeta…",
          disabled: !canWrite,
          detail: "Todos los audios de la carpeta",
          onSelect: onAddFolder,
        },
        {
          kind: "item",
          label: "Lista .m3u…",
          disabled: !canWrite,
          onSelect: onAddM3u,
        },
      ],
    },
    {
      id: "tools",
      label: "Herramientas",
      items: [
        {
          kind: "item",
          label: "Procesar pistas…",
          disabled: !canWrite,
          detail: "Normalizar, BPM, silencio (jobs)",
          onSelect: onProcessTracks,
        },
        {
          kind: "item",
          label: "Comprobar pistas…",
          disabled: !canWrite,
          detail: "Errores y tags vs archivo",
          onSelect: onCheckTracks,
        },
        {
          kind: "item",
          label: "Verificar biblioteca…",
          disabled: !canWrite,
          detail: "Quita entradas sin archivo",
          onSelect: onVerifyLibrary,
        },
        { kind: "divider" },
        {
          kind: "item",
          label: "Información de pista…",
          disabled: !canTrackInfo,
          detail: "Editar metadatos e ID3",
          onSelect: onTrackInfo,
        },
        {
          kind: "item",
          label: "Actualizar metadatos…",
          disabled: !canWrite,
          detail: "Releer ID3 desde disco",
          onSelect: onUpdateMetadata,
        },
        {
          kind: "item",
          label: "Actualización automática…",
          disabled: !canWrite,
          detail: "Escanear carpetas en bóveda",
          onSelect: onAutoUpdate,
        },
        {
          kind: "item",
          label: "Campos personalizados…",
          disabled: !canWrite || !canCustomFields,
          detail: "5 campos por pista · etiquetas globales",
          onSelect: onCustomFields,
        },
      ],
    },
  ];

  useEffect(() => {
    if (!openId) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("click", onDocClick, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDocClick, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [openId, close]);

  function runItem(item: MenuItem) {
    if (item.kind !== "item" || item.disabled) return;
    item.onSelect?.();
    close();
  }

  return (
    <div
      ref={rootRef}
      className="music-library-menubar shell-top-menus"
      role="menubar"
      aria-label="Menú biblioteca musical ()"
    >
      {menus.map((menu) => {
        const open = openId === menu.id;
        return (
          <div key={menu.id} className={`shell-menu-root${open ? " is-open" : ""}`}>
            <button
              type="button"
              className="shell-menu-trigger"
              aria-haspopup="true"
              aria-expanded={open}
              onClick={() => setOpenId(open ? null : menu.id)}
            >
              {menu.label}
            </button>
            {open ? (
              <div className="shell-menu-panel" role="menu">
                {menu.items.map((item, idx) =>
                  item.kind === "divider" ? (
                    <div key={`d-${menu.id}-${idx}`} className="shell-menu-divider" role="separator" />
                  ) : (
                    <button
                      key={`${item.label}-${idx}`}
                      type="button"
                      role="menuitem"
                      className={`shell-menu-item${item.disabled ? " is-disabled" : ""}`}
                      disabled={item.disabled}
                      title={item.detail}
                      onClick={() => runItem(item)}
                    >
                      <span className="shell-menu-item-label">{item.label}</span>
                      {item.detail && !item.disabled ? (
                        <span className="shell-menu-item-hint muted">{item.detail}</span>
                      ) : null}
                    </button>
                  ),
                )}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
