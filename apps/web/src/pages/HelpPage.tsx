import { Link } from "react-router-dom";
import { isDesktopProduct } from "../lib/desktop-product";

export function HelpPage() {
  const desktopProduct = isDesktopProduct();

  return (
    <section className="card">
      <h1>Ayuda · RadioFlow Studio</h1>
      <p className="muted">
        Resumen de módulos. La barra superior agrupa menús de automatización y cabina.
      </p>
      {desktopProduct ? (
        <p className="muted small">
          Esta copia es la <strong>aplicación de escritorio</strong> instalada en su equipo: la base de datos y los archivos
          de audio viven en su equipo (carpeta de datos de la aplicación). En el primer arranque se muestran las credenciales
          de administrador; guárdelas en un lugar seguro. Para comprobar nuevas versiones use{" "}
          <strong>Ayuda → Buscar actualizaciones…</strong> (si su proveedor publicó un canal de actualizaciones).
        </p>
      ) : (
        <p className="muted small">
          En la <strong>aplicación de escritorio</strong> con servidor externo, configure la URL del API en{" "}
          <strong>Vista → Servidor API…</strong>.
        </p>
      )}

      {!desktopProduct ? (
        <>
          <h2 id="cliente-instalable" className="mt">
            Navegador y aplicación instalable
          </h2>
          <p className="muted small">
            El producto para estaciones se distribuye como <strong>instalador Windows (.exe)</strong> con motor local
            integrado. El panel en navegador queda reservado a despliegues técnicos o desarrollo.
          </p>
        </>
      ) : null}
      <p className="muted small">
        Documentación de producto en el repositorio.
        <a href="https://github.com/radioflow/radioflow-studio/blob/main/docs/roadmap.md" target="_blank" rel="noreferrer">
          roadmap.md
        </a>{" "}
        en el repositorio (IDs <code>RB-xxx</code> por ítem). Copia local: <code>docs/roadmap.md</code>.
        Now Playing: <code>GET /api/public/now-playing</code>, sidecar <code>/api/public/nowplaying.json</code>,{" "}
        <code>/api/public/current-cover.jpg</code> y reproductor web en <Link to="/listen">/listen</Link>.
      </p>
      <ul className="list mt">
        <li>
          <Link to="/station">Cabina</Link> — reproducción y cola al aire.
        </li>
        <li>
          <Link to="/library">Biblioteca musical</Link> (Herramientas) — ingesta y catálogo: carpetas propias, vistas por
          género, artista y álbum; crear playlists desde la vista.
        </li>
        <li>
          <Link to="/explorador">Explorador</Link> — importación avanzada desde disco local
          {desktopProduct
            ? " (diálogo nativo de Windows y carpetas locales)."
            : " (en escritorio: diálogo nativo; en navegador: selector de archivos)."}
        </li>
        <li>
          <Link to="/playlists">Abrir lista</Link> — elegir lista guardada; se edita y reproduce en{" "}
          <Link to="/station">Cabina</Link> (Manual · Track List · Generador Pro).
        </li>
        <li>
          <Link to="/schedule">Parrilla y automatización</Link> (bloques semanales, cola automática),{" "}
          <Link to="/scheduler">Programador de eventos</Link>, <Link to="/requests">Pedidos</Link> y{" "}
          <Link to="/jingles">Jingles (cart wall)</Link>.
        </li>
        <li>
          <Link to="/streaming">Streaming</Link> — salida y metadatos.
        </li>
        <li>
          <Link to="/reports">Informes</Link>.
        </li>
        <li>
          <Link to="/settings">Marca / opciones</Link>.
        </li>
      </ul>

      <h2 id="cabina-b1" className="mt">
        Cabina (layout B1)
      </h2>
      <p className="muted small">
        Viewport fijo: franja al aire + lista (scroll) + dock + transporte. Los rieles Programador/Cola van ocultos
        por defecto (<strong>Vista → Paneles laterales</strong>). En Cabina no se duplica la barra de transporte del
        shell ni la meta inferior: todo vive en la franja y el dock.
      </p>
      <h2 id="liquidsoap-y-cabina" className="mt">
        Salida al aire: encoder (default) vs Liquidsoap (legacy)
      </h2>
      <p className="muted small">
        El producto instalable y el path documentado usan el <strong>encoder FFmpeg → Icecast</strong> (Emitir /
        Streaming). Liquidsoap + M3U es <strong>legacy / opt-in</strong> (perfiles Docker{" "}
        <code>liquidsoap</code> / <code>liquidsoap-cron</code>, o <code>LIQUIDSOAP_M3U_POLL_MS&gt;0</code>). No
        ejecutes ambos contra el mismo mount Icecast.
      </p>
      <p className="muted small">
        URLs M3U legacy: <Link to="/settings">Marca y cabecera</Link>. Para salir al aire:{" "}
        <Link to="/streaming">Streaming</Link> / Emitir.
      </p>
      <h3 className="small" style={{ marginTop: "1rem", marginBottom: "0.35rem" }}>
        QA manual: cola (tabla) vs cola de reproducción (Cr.p.)
      </h3>
      <ol className="muted small list" style={{ paddingLeft: "1.25rem", lineHeight: 1.5 }}>
        <li>
          En <Link to="/station">Cabina</Link>, cargue varias pistas hasta tener cola larga y anote el orden lineal en
          tabla.
        </li>
        <li>
          Reordene desde <strong>Cr.p.</strong> (arrastrar o acciones equivalentes): la cabeza de Cr.p. debe aparecer
          como &quot;Pista siguiente&quot;, en la lista <strong>Siguientes</strong> y en la <strong>cinta</strong> del
          resto del panel (fuera de Cabina) si está visible.
        </li>
        <li>
          Compruebe que la suma de tiempo &quot;después de esta&quot; y el <strong>Fin est.</strong> (tooltip) siguen
          teniendo sentido cuando Cr.p. no coincide con la línea de la tabla: el fin estimado es <em>lineal por fila</em>;
          saltos por Cr.p. pueden adelantar pistas respecto a esa hora.
        </li>
        <li>
          Con motor Web Audio desactivado, el VU lateral debe moverse (aprox. L/R por mitades del buffer; no es
          medición acústica calibrada).
        </li>
      </ol>
      <h2 id="dia-1" className="mt">
        Primera emisión (día-1)
      </h2>
      <p className="muted small">
        Checklist operador: instalar → biblioteca → Cabina → Icecast → Emitir. En el repositorio:{" "}
        <code>docs/day-1-runbook.md</code>.
      </p>
      <ol className="muted small list" style={{ paddingLeft: "1.25rem", lineHeight: 1.5 }}>
        <li>
          Importá música en <Link to="/library">Biblioteca</Link> / <Link to="/explorador">Explorador</Link>.
        </li>
        <li>
          Armá cola en <Link to="/station">Cabina</Link> y comprobá que avanza.
        </li>
        <li>
          Configurá destino y encoder en <Link to="/emitir">Emitir</Link> (Streaming); escuchá la URL del mount.
        </li>
      </ol>
      <h3 className="small" style={{ marginTop: "1rem", marginBottom: "0.35rem" }}>
        Documentación en el repositorio (cron, Docker, checklist)
      </h3>
      <ul className="muted small list" style={{ paddingLeft: "1.25rem", lineHeight: 1.5 }}>
        <li>
          <code>docs/day-1-runbook.md</code> — primera emisión (operador no-dev).
        </li>
        <li>
          <code>docs/backup-restore.md</code> — backup/restore firmado (Postgres + desktop).
        </li>
        <li>
          <code>docs/staging-72h-soak.md</code> — soak 72 h / evidencia A8 (
          <code>npm run soak:watch</code>).
        </li>
        <li>
          <Link to="/schedule">Parrilla</Link> / <Link to="/ads">Publicidad</Link> — flujo B3:{" "}
          <code>docs/b3-ads-parrilla-checklist.md</code>.
        </li>
        <li>
          Desktop embebido: cola de biblioteca (process-jobs) y cues activos por defecto; ver estado en{" "}
          <Link to="/desktop">Escritorio</Link> / <code>GET /api/health/meta</code>.
        </li>
        <li>
          <code>docs/streaming-encoder-icecast.md</code> — encoder → Icecast; smoke A5 (
          <code>npm run smoke:broadcast</code>).
        </li>
        <li>
          <code>docker/liquidsoap/README.md</code> — Liquidsoap legacy, volumen <code>/playlists</code>, perfil{" "}
          <code>liquidsoap-cron</code>.
        </li>
        <li>
          <code>docs/docker-edge-stack.md</code> — encaje broadcast + M3U generados por la API.
        </li>
        <li>
          <code>docs/architecture.md</code> — diagrama y decisiones de arquitectura.
        </li>
        <li>
          <code>docs/roadmap.md</code> — documentación de producto
        </li>
        <li>
          <code>docs/validation-checklist.md</code> — validación de entorno.
        </li>
        <li>
          <code>README-prod.md</code> — visión producción.
        </li>
      </ul>
    </section>
  );
}
