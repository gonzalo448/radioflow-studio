/** Ícono barra de módulos: ventana + carpeta (explorador de archivos). */
export function FileExplorerNavIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="1.25em"
      height="1.25em"
      aria-hidden
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M4 5c0-.55.45-1 1-1h5l1 1h9c.55 0 1 .45 1 1v2H4V5z"
        opacity={0.85}
      />
      <path
        fill="currentColor"
        d="M3 8h18v11c0 1.1-.9 2-2 2H5c-1.1 0-2-.9-2-2V8z"
        opacity={0.45}
      />
      <path
        fill="var(--accent, #38bdf8)"
        d="M6 11h5v1.2H6V11zm0 2.3h8v1.2H6v-1.2zm0 2.3h6v1.2H6v-1.2z"
        opacity={0.95}
      />
      <rect x="5" y="10" width="14" height="9" rx="0.5" fill="none" stroke="currentColor" strokeWidth="1.2" opacity={0.5} />
    </svg>
  );
}
