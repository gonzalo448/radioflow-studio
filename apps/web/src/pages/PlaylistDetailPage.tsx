import { Navigate, useParams } from "react-router-dom";

/** La edición de listas vive en Cabina; esta ruta solo abre la lista allí. */
export function PlaylistDetailPage() {
  const { id } = useParams<{ id: string }>();
  if (!id) return <Navigate to="/playlists" replace />;
  return <Navigate to={`/station?pl=${encodeURIComponent(id)}`} replace />;
}
