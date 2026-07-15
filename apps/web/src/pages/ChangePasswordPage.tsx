import { FormEvent, useState } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { changeMyPassword } from "../lib/api";
import "./ChangePasswordPage.css";

export function ChangePasswordPage() {
  const { token } = useAuth();
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState("");

  async function handleChangePassword(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setMessage("");
    try {
      const data = await changeMyPassword(oldPassword, newPassword, token);
      setMessage(data.mensaje);
      setOldPassword("");
      setNewPassword("");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Error al cambiar contraseña");
    }
  }

  if (!token) {
    return (
      <p className="card">
        Debe <NavLink to="/login">iniciar sesión</NavLink> para cambiar la contraseña.
      </p>
    );
  }

  return (
    <form className="change-password-form" onSubmit={handleChangePassword}>
      <h2>Cambiar Contraseña</h2>
      <label>
        Contraseña actual:
        <input
          type="password"
          value={oldPassword}
          onChange={(e) => setOldPassword(e.target.value)}
          autoComplete="current-password"
        />
      </label>
      <label>
        Nueva contraseña:
        <input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
        />
      </label>
      <button type="submit">Actualizar</button>
      {message ? <p>{message}</p> : null}
    </form>
  );
}

export default ChangePasswordPage;
