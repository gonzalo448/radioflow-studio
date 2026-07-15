import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { apiFetch, updateUserPassword } from "../lib/api";
import type { UserRole } from "@radioflow/shared";
import "./UsuariosPage.css";

type UsuarioRow = {
  id: string;
  nombre: string;
  email: string;
  rol: string;
  createdAt: string;
};

type ModalUsuario = {
  id?: string;
  nombre: string;
  email: string;
  rol: UserRole;
  password: string;
};

const ROLES_FORM: { value: UserRole; label: string }[] = [
  { value: "admin", label: "Admin" },
  { value: "editor", label: "Editor" },
  { value: "operador", label: "Operador" },
  { value: "dj", label: "DJ" },
  { value: "viewer", label: "Visor" },
];

export function UsuariosPage() {
  const { token, user } = useAuth();
  const [usuarios, setUsuarios] = useState<UsuarioRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [modalData, setModalData] = useState<ModalUsuario | null>(null);
  const esAdmin = user?.role === "admin";

  const cargar = useCallback(async () => {
    if (!token || !esAdmin) return;
    setErr(null);
    try {
      const data = await apiFetch<UsuarioRow[]>("/api/usuarios", { token });
      setUsuarios(data);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error al cargar usuarios");
      setUsuarios([]);
    }
  }, [token, esAdmin]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const saveUsuario = async () => {
    if (!modalData || !token || !esAdmin) return;
    if (!modalData.nombre?.trim() || !modalData.email || !modalData.password || modalData.password.length < 8) {
      setErr("Nombre, email y contraseña (mín. 8 caracteres) son obligatorios.");
      return;
    }
    setErr(null);
    try {
      const creado = await apiFetch<UsuarioRow>("/api/usuarios", {
        method: "POST",
        token,
        body: JSON.stringify({
          nombre: modalData.nombre,
          email: modalData.email,
          rol: modalData.rol,
          password: modalData.password,
        }),
      });
      setUsuarios((prev) => [...prev, creado]);
      setModalData(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error al crear usuario");
    }
  };

  const updateUsuario = async () => {
    if (!modalData?.id || !token || !esAdmin) return;
    if (!modalData.nombre?.trim() || !modalData.email) {
      setErr("Nombre y email son obligatorios.");
      return;
    }
    setErr(null);
    const body: Record<string, string> = {
      nombre: modalData.nombre,
      email: modalData.email,
      rol: modalData.rol,
    };
    try {
      const actualizado = await apiFetch<UsuarioRow>(`/api/usuarios/${modalData.id}`, {
        method: "PUT",
        token,
        body: JSON.stringify(body),
      });
      let row = actualizado;
      if (modalData.password.length >= 8) {
        const { usuario } = await updateUserPassword(modalData.id, modalData.password, token);
        row = usuario;
      }
      setUsuarios((prev) => prev.map((u) => (u.id === row.id ? row : u)));
      setModalData(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error al editar usuario");
    }
  };

  const deleteUsuario = async (id: string) => {
    if (!token || !esAdmin) return;
    setErr(null);
    try {
      await apiFetch<{ mensaje: string }>(`/api/usuarios/${id}`, { method: "DELETE", token });
      setUsuarios((prev) => prev.filter((u) => u.id !== id));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error al borrar usuario");
    }
  };

  if (!token) return <p className="card">Inicia sesión.</p>;
  if (!esAdmin) return <p className="card">Solo administradores pueden gestionar usuarios.</p>;

  return (
    <div className="usuarios-page usuarios-container">
      <h2 className="usuarios-title">Gestión de usuarios</h2>
      {err ? (
        <p className="error" role="alert">
          {err}
        </p>
      ) : null}
      <div className="usuarios-toolbar">
        <button
          type="button"
          className="usuarios-toolbar-btn"
          onClick={() =>
            setModalData({ nombre: "", email: "", rol: "operador", password: "" })
          }
        >
          + Nuevo usuario
        </button>
      </div>
      <div className="usuarios-table-wrap">
        <table className="usuarios-table">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Email</th>
              <th>Rol</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {usuarios.map((u) => (
              <tr key={u.id}>
                <td>{u.nombre || "—"}</td>
                <td>{u.email}</td>
                <td>
                  <span className="badge">{u.rol}</span>
                </td>
                <td>
                  <button
                    type="button"
                    className="usuarios-table-btn"
                    onClick={() =>
                      setModalData({
                        id: u.id,
                        nombre: u.nombre,
                        email: u.email,
                        rol: u.rol as UserRole,
                        password: "",
                      })
                    }
                  >
                    ✏️ Editar
                  </button>{" "}
                  <button
                    type="button"
                    className="usuarios-table-btn usuarios-table-btn--danger"
                    onClick={() => void deleteUsuario(u.id)}
                  >
                    🗑️ Borrar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modalData ? (
        <div className="usuarios-modal-backdrop modal" role="presentation" onClick={() => setModalData(null)}>
          <div className="usuarios-modal modal-content" role="dialog" aria-modal onClick={(e) => e.stopPropagation()}>
            <h3>{modalData.id ? "Editar usuario" : "Nuevo usuario"}</h3>
            <label className="usuarios-field">
              Nombre
              <input
                type="text"
                value={modalData.nombre}
                onChange={(e) => setModalData({ ...modalData, nombre: e.target.value })}
              />
            </label>
            <label className="usuarios-field">
              Email
              <input
                type="email"
                value={modalData.email}
                onChange={(e) => setModalData({ ...modalData, email: e.target.value })}
              />
            </label>
            <label className="usuarios-field">
              Rol
              <select
                value={modalData.rol}
                onChange={(e) => setModalData({ ...modalData, rol: e.target.value as UserRole })}
              >
                {ROLES_FORM.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            {!modalData.id ? (
              <label className="usuarios-field">
                Contraseña
                <input
                  type="password"
                  value={modalData.password}
                  onChange={(e) => setModalData({ ...modalData, password: e.target.value })}
                  autoComplete="new-password"
                />
              </label>
            ) : (
              <label className="usuarios-field">
                Nueva contraseña (opcional)
                <input
                  type="password"
                  value={modalData.password}
                  onChange={(e) => setModalData({ ...modalData, password: e.target.value })}
                  placeholder="Dejar vacío para no cambiar"
                  autoComplete="new-password"
                />
              </label>
            )}
            <div className="usuarios-modal-actions modal-actions">
              {modalData.id ? (
                <button type="button" className="btn primary" onClick={() => void updateUsuario()}>
                  Actualizar
                </button>
              ) : (
                <button type="button" className="btn primary" onClick={() => void saveUsuario()}>
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
