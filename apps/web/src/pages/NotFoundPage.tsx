import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <section className="card">
      <h1>Página no encontrada</h1>
      <p className="muted">La ruta no existe en RadioFlow Studio.</p>
      <p>
        <Link to="/">Volver al panel</Link>
      </p>
    </section>
  );
}
