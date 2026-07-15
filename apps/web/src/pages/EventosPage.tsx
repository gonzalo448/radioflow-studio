import { useCallback, useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useNotification } from "../context/NotificationContext";
import { apiFetch } from "../lib/api";
import "./EventosPage.css";

type EventoRow = {
  id: number;
  dia: string;
  hora: string;
  ruta_audio: string;
  descripcion: string | null;
};

type ModalEvento = {
  id?: number;
  dia: string;
  hora: string;
  ruta_audio: string;
  descripcion: string;
};

const DIAS: { value: string; label: string }[] = [
  { value: "lunes", label: "Lunes" },
  { value: "martes", label: "Martes" },
  { value: "miércoles", label: "Miércoles" },
  { value: "jueves", label: "Jueves" },
  { value: "viernes", label: "Viernes" },
  { value: "sábado", label: "Sábado" },
  { value: "domingo", label: "Domingo" },
];

function horaParaInput(hora: string): string {
  return hora.length >= 5 ? hora.slice(0, 5) : hora;
}

export function EventosPage() {
  const { token, user } = useAuth();
  const { showNotification } = useNotification();
  const [eventos, setEventos] = useState<EventoRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [modalData, setModalData] = useState<ModalEvento | null>(null);
  const esAdmin = user?.role === "admin";

  const cargar = useCallback(async () => {
    if (!token) return;
    setErr(null);
    try {
      const data = await apiFetch<EventoRow[]>("/api/eventos", { token });
      setEventos(data);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error al cargar eventos");
      setEventos([]);
    }
  }, [token]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const saveEvento = async () => {
    if (!modalData || !token || !esAdmin) return;
    if (!modalData.ruta_audio.trim()) {
      setErr("La ruta de audio es obligatoria.");
      return;
    }
    setErr(null);
    const hora = horaParaInput(modalData.hora);
    try {
      const creado = await apiFetch<EventoRow>("/api/eventos", {
        method: "POST",
        token,
        body: JSON.stringify({
          dia: modalData.dia,
          hora,
          ruta_audio: modalData.ruta_audio.trim(),
          descripcion: modalData.descripcion.trim() || null,
        }),
      });
      setEventos((prev) => [...prev, creado]);
      setModalData(null);
      showNotification("🎵 Evento creado con éxito", "success");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error al crear evento";
      showNotification(`❌ ${msg}`, "error");
    }
  };

  const updateEvento = async () => {
    if (!modalData?.id || !token || !esAdmin) return;
    if (!modalData.ruta_audio.trim()) {
      setErr("La ruta de audio es obligatoria.");
      return;
    }
    setErr(null);
    const hora = horaParaInput(modalData.hora);
    try {
      const data = await apiFetch<EventoRow>(`/api/eventos/${modalData.id}`, {
        method: "PUT",
        token,
        body: JSON.stringify({
          dia: modalData.dia,
          hora,
          ruta_audio: modalData.ruta_audio.trim(),
          descripcion: modalData.descripcion.trim() || null,
        }),
      });
      setEventos((prev) => prev.map((e) => (e.id === data.id ? data : e)));
      setModalData(null);
      showNotification("Evento actualizado con éxito", "success");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error al editar evento";
      showNotification(`❌ ${msg}`, "error");
    }
  };

  const deleteEvento = async (id: number) => {
    if (!token || !esAdmin) return;
    setErr(null);
    try {
      await apiFetch<{ mensaje: string }>(`/api/eventos/${id}`, { method: "DELETE", token });
      setEventos((prev) => prev.filter((e) => e.id !== id));
      showNotification("Evento eliminado", "success");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error al borrar evento";
      showNotification(`❌ ${msg}`, "error");
    }
  };

  if (!token) {
    return (
      <p className="card">
        Debe <NavLink to="/login">iniciar sesión</NavLink>.
      </p>
    );
  }

  return (
    <div className="eventos-page eventos-container">
      <h2 className="eventos-title">Gestión de eventos</h2>
      {err ? (
        <p className="error" role="alert">
          {err}
        </p>
      ) : null}
      <div className="eventos-toolbar">
        {esAdmin ? (
          <button
            type="button"
            className="eventos-toolbar-btn"
            onClick={() =>
              setModalData({ dia: "lunes", hora: "09:00", ruta_audio: "", descripcion: "" })
            }
          >
            + Nuevo evento
          </button>
        ) : (
          <p className="restricted" role="note">
            🔒 Solo administradores pueden crear eventos
          </p>
        )}
      </div>
      <div className="eventos-table-wrap">
        <table className="eventos-table">
          <thead>
            <tr>
              <th>Día</th>
              <th>Hora</th>
              <th>Ruta audio</th>
              <th>Descripción</th>
              {esAdmin ? <th>Acciones</th> : null}
            </tr>
          </thead>
          <tbody>
            {eventos.map((e) => (
              <tr key={e.id}>
                <td>{e.dia}</td>
                <td>{e.hora}</td>
                <td className="mono small">{e.ruta_audio}</td>
                <td>{e.descripcion ?? "—"}</td>
                {esAdmin ? (
                  <td>
                    <button
                      type="button"
                      className="eventos-table-btn"
                      onClick={() =>
                        setModalData({
                          id: e.id,
                          dia: e.dia,
                          hora: horaParaInput(e.hora),
                          ruta_audio: e.ruta_audio,
                          descripcion: e.descripcion ?? "",
                        })
                      }
                    >
                      Editar
                    </button>{" "}
                    <button
                      type="button"
                      className="eventos-table-btn"
                      onClick={() => void deleteEvento(e.id)}
                    >
                      Borrar
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modalData && esAdmin ? (
        <div className="eventos-modal-backdrop modal" role="presentation" onClick={() => setModalData(null)}>
          <div className="eventos-modal modal-content" role="dialog" aria-modal onClick={(ev) => ev.stopPropagation()}>
            <h3>{modalData.id ? "Editar evento" : "Nuevo evento"}</h3>
            <label className="eventos-field">
              Día
              <select
                value={modalData.dia}
                onChange={(ev) => setModalData({ ...modalData, dia: ev.target.value })}
              >
                {DIAS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="eventos-field">
              Hora
              <input
                type="time"
                step={60}
                value={horaParaInput(modalData.hora)}
                onChange={(ev) => setModalData({ ...modalData, hora: ev.target.value })}
              />
            </label>
            <label className="eventos-field">
              Ruta audio
              <input
                type="text"
                value={modalData.ruta_audio}
                onChange={(ev) => setModalData({ ...modalData, ruta_audio: ev.target.value })}
                placeholder="p. ej. uploads/pista.mp3"
              />
            </label>
            <label className="eventos-field">
              Descripción
              <input
                type="text"
                value={modalData.descripcion}
                onChange={(ev) => setModalData({ ...modalData, descripcion: ev.target.value })}
              />
            </label>
            <div className="eventos-modal-actions modal-actions">
              {modalData.id ? (
                <button type="button" className="btn primary" onClick={() => void updateEvento()}>
                  Actualizar
                </button>
              ) : (
                <button type="button" className="btn primary" onClick={() => void saveEvento()}>
                  Guardar
                </button>
              )}
              <button type="button" className="btn" onClick={() => setModalData(null)}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
