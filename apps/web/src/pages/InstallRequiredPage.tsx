import "./InstallRequiredPage.css";

/**
 * Pantalla mostrada si se abre el bundle en un navegador sin Electron.
 * RadioFlow Studio no es una web-app para operadores: requiere instalador.
 */
export function InstallRequiredPage() {
  return (
    <div className="install-required">
      <div className="install-required-card card">
        <h1>RadioFlow Studio</h1>
        <p className="install-required-lead">
          Esta emisora se opera desde la <strong>aplicación instalada</strong> en su equipo, no desde el navegador.
        </p>
        <ul className="install-required-list">
          <li>Motor de radio y base de datos locales (sin depender de un servidor web)</li>
          <li>Explorador de sus discos y carpetas de música</li>
          <li>Cabina, librería, parrilla y streaming integrados</li>
        </ul>
        <p className="muted small">
          Instale <strong>RadioFlow Studio Setup</strong> (Windows). Tras instalar, abra «RadioFlow Studio» desde el menú Inicio.
        </p>
        <p className="muted small install-required-build">
          Para generar el instalador en desarrollo:{" "}
          <code>npm run build:installer</code>
        </p>
      </div>
    </div>
  );
}
