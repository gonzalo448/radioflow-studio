/**
 * Build de instalador (Electron empaquetado): app autocontenida para distribuir a clientes.
 * No es el modo “panel web” contra un servidor remoto.
 */
export function isDesktopProduct(): boolean {
  return (
    import.meta.env.VITE_DESKTOP_PRODUCT === "true" || import.meta.env.VITE_EMBEDDED_STANDALONE === "true"
  );
}

/** UI empaquetada en Electron (HashRouter / menús de escritorio). */
export function isDesktopShell(): boolean {
  return import.meta.env.VITE_HASH_ROUTER === "true" || isDesktopProduct();
}
