import { EmitirBroadcastPanel } from "../components/emitir/EmitirBroadcastPanel";
import { azuraRadioBrowserUrl, openAzuraRadioInBrowser } from "../lib/azura-radio-url";
import "./EmitirPage.css";

export function EmitirPage() {
  const radioUrl = azuraRadioBrowserUrl();

  return (
    <section className="card emitir-page">
      <h1>Emitir</h1>
      <p className="muted emitir-page-lead">
        Configure Icecast/AzuraCast, inicie la publicación y abra el reproductor — todo desde aquí.
      </p>

      <div className="emitir-browser-link">
        <p className="emitir-browser-link-title">Reproductor web</p>
        <p className="muted small">
          Web-app para oyentes: stream en vivo, carátula y metadatos. Copie el enlace o ábralo en el navegador.
        </p>
        <p className="emitir-browser-url mono">
          <a href={radioUrl} target="_blank" rel="noreferrer">
            {radioUrl}
          </a>
        </p>
        <div className="row tight mt">
          <button type="button" className="btn primary btn-compact" onClick={() => void openAzuraRadioInBrowser()}>
            Abrir en el navegador
          </button>
          <button
            type="button"
            className="btn ghost btn-compact"
            onClick={() => void navigator.clipboard.writeText(radioUrl)}
          >
            Copiar enlace
          </button>
        </div>
      </div>

      <EmitirBroadcastPanel />
    </section>
  );
}
