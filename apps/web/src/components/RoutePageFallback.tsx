/** Fallback mínimo mientras carga un chunk de ruta lazy. */
export function RoutePageFallback() {
  return (
    <div className="route-page-fallback" role="status" aria-live="polite">
      <p className="muted">Cargando módulo…</p>
    </div>
  );
}
