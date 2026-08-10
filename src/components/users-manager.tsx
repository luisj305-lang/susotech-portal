"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { UserRole } from "@/lib/auth/session";
import {
  createUser,
  deleteUser,
  updateUserProfile,
  updateUserRoleAndStatus,
} from "@/lib/users/actions";

type ManagedProfile = {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  is_active: boolean;
  crew_names: string[];
};

const roleLabels: Record<UserRole, string> = {
  admin: "Administrador",
  supervisor: "Supervisor",
  tecnico: "Técnico",
};

type ModalMode =
  | { type: "closed" }
  | { type: "create" }
  | { type: "edit"; user: ManagedProfile }
  | { type: "delete"; user: ManagedProfile };

export function UsersManager({
  currentUserId,
  initialUsers,
}: {
  currentUserId: string;
  initialUsers: ManagedProfile[];
}) {
  const router = useRouter();
  const [users, setUsers] = useState(initialUsers);
  const [modal, setModal] = useState<ModalMode>({ type: "closed" });
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const [createForm, setCreateForm] = useState({
    fullName: "",
    email: "",
    password: "",
    role: "tecnico" as UserRole,
    isActive: true,
  });

  const [editForm, setEditForm] = useState({
    fullName: "",
    email: "",
  });

  const [confirmEmailChange, setConfirmEmailChange] = useState(false);

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsLoading(true);
    setMessage("");

    const result = await createUser({
      email: createForm.email,
      password: createForm.password,
      fullName: createForm.fullName,
      role: createForm.role,
      isActive: createForm.isActive,
    });

    setIsLoading(false);

    if (result.success) {
      setMessage(result.message);
      setModal({ type: "closed" });
      setCreateForm({
        fullName: "",
        email: "",
        password: "",
        role: "tecnico",
        isActive: true,
      });
      router.refresh();
    } else {
      setMessage(result.message);
    }
  };

  const handleEdit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (modal.type !== "edit") return;

    const normalizedCurrent = modal.user.email.trim().toLowerCase();
    const normalizedNew = editForm.email.trim().toLowerCase();

    if (normalizedCurrent !== normalizedNew && !confirmEmailChange) {
      setMessage("Confirma el cambio de correo antes de guardar.");
      return;
    }

    setIsLoading(true);
    setMessage("");

    const result = await updateUserProfile({
      userId: modal.user.id,
      fullName: editForm.fullName,
      email: editForm.email,
      currentEmail: modal.user.email,
    });

    setIsLoading(false);

    if (result.success) {
      setMessage(result.message);
      setModal({ type: "closed" });
      setConfirmEmailChange(false);
      setEditForm({ fullName: "", email: "" });
      router.refresh();
    } else {
      setMessage(result.message);
    }
  };

  const handleRoleChange = async (
    userId: string,
    newRole: UserRole,
  ) => {
    if (userId === currentUserId) {
      setMessage("No puedes cambiar tu propio rol.");
      return;
    }

    const user = users.find((u) => u.id === userId);
    if (!user) return;

    setIsLoading(true);
    setMessage("");

    const result = await updateUserRoleAndStatus({
      userId,
      role: newRole,
      isActive: user.is_active,
      currentAdminId: currentUserId,
    });

    setIsLoading(false);

    if (result.success) {
      setUsers((current) =>
        current.map((u) => (u.id === userId ? { ...u, role: newRole } : u)),
      );
      setMessage(result.message);
    } else {
      setMessage(result.message);
    }
  };

  const handleStatusToggle = async (userId: string) => {
    if (userId === currentUserId) {
      setMessage("No puedes desactivar tu propia cuenta.");
      return;
    }

    const user = users.find((u) => u.id === userId);
    if (!user) return;

    const newStatus = !user.is_active;

    setIsLoading(true);
    setMessage("");

    const result = await updateUserRoleAndStatus({
      userId,
      role: user.role,
      isActive: newStatus,
      currentAdminId: currentUserId,
    });

    setIsLoading(false);

    if (result.success) {
      setUsers((current) =>
        current.map((u) =>
          u.id === userId ? { ...u, is_active: newStatus } : u,
        ),
      );
      setMessage(result.message);
    } else {
      setMessage(result.message);
    }
  };

  const openEdit = (user: ManagedProfile) => {
    setEditForm({
      fullName: user.full_name ?? "",
      email: user.email,
    });
    setConfirmEmailChange(false);
    setModal({ type: "edit", user });
    setMessage("");
  };

  const handleDelete = async () => {
    if (modal.type !== "delete") return;

    if (modal.user.id === currentUserId) {
      setMessage("No puedes eliminar tu propia cuenta.");
      setModal({ type: "closed" });
      return;
    }

    setIsLoading(true);
    setMessage("");

    const result = await deleteUser({
      userId: modal.user.id,
      currentAdminId: currentUserId,
    });

    setIsLoading(false);

    if (result.success) {
      setUsers((current) => current.filter((u) => u.id !== modal.user.id));
      setMessage(result.message);
      setModal({ type: "closed" });
    } else {
      setMessage(result.message);
    }
  };

  return (
    <main style={{ minHeight: "100vh", padding: "40px" }}>
      <Link href="/dashboard">← Volver al dashboard</Link>
      <h1 style={{ fontSize: "30px", fontWeight: "bold", marginTop: "24px" }}>
        Administración de usuarios
      </h1>
      <p style={{ margin: "8px 0 24px" }}>
        Crea usuarios, edita sus datos y gestiona permisos.
      </p>

      {message && (
        <p role="status" style={{ marginBottom: "16px" }}>
          {message}
        </p>
      )}

      <div style={{ marginBottom: "24px" }}>
        <button
          type="button"
          onClick={() => {
            setModal({ type: "create" });
            setMessage("");
          }}
          disabled={isLoading}
          style={{ padding: "12px 20px", cursor: "pointer" }}
        >
          + Nuevo usuario
        </button>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ padding: "12px", textAlign: "left" }}>Nombre</th>
              <th style={{ padding: "12px", textAlign: "left" }}>Correo</th>
              <th style={{ padding: "12px", textAlign: "left" }}>Rol</th>
              <th style={{ padding: "12px", textAlign: "left" }}>Crew / Equipos</th>
              <th style={{ padding: "12px", textAlign: "left" }}>Estado</th>
              <th style={{ padding: "12px", textAlign: "left" }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const isCurrentUser = user.id === currentUserId;

              return (
                <tr key={user.id} style={{ borderTop: "1px solid #d1d5db" }}>
                  <td style={{ padding: "12px" }}>
                    {user.full_name ?? "Sin nombre"}
                  </td>
                  <td style={{ padding: "12px" }}>{user.email}</td>
                  <td style={{ padding: "12px" }}>
                    <label>
                      <span style={{ position: "absolute", left: "-9999px" }}>
                        Rol de {user.full_name ?? user.email}
                      </span>
                      <select
                        value={user.role}
                        disabled={isCurrentUser || isLoading}
                        onChange={(event) =>
                          void handleRoleChange(
                            user.id,
                            event.target.value as UserRole,
                          )
                        }
                        style={{ padding: "8px" }}
                      >
                        {Object.entries(roleLabels).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </td>
                  <td style={{ padding: "12px" }}>{user.crew_names.join(", ") || "—"}</td>
                  <td style={{ padding: "12px" }}>
                    <button
                      type="button"
                      disabled={isCurrentUser || isLoading}
                      onClick={() => void handleStatusToggle(user.id)}
                      style={{
                        padding: "8px 12px",
                        cursor: isCurrentUser ? "not-allowed" : "pointer",
                      }}
                    >
                      {user.is_active ? "Activo" : "Inactivo"}
                    </button>
                    {isCurrentUser && <span> (tu cuenta)</span>}
                  </td>
                  <td style={{ padding: "12px" }}>
                    <button
                      type="button"
                      disabled={isLoading}
                      onClick={() => openEdit(user)}
                      style={{ padding: "8px 12px", cursor: "pointer" }}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      disabled={isCurrentUser || isLoading}
                      onClick={() => {
                        setModal({ type: "delete", user });
                        setMessage("");
                      }}
                      style={{
                        padding: "8px 12px",
                        marginLeft: "8px",
                        cursor: isCurrentUser ? "not-allowed" : "pointer",
                      }}
                    >
                      Eliminar
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {modal.type !== "closed" && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
            zIndex: 50,
          }}
        >
          <div
            style={{
              backgroundColor: "white",
              color: "black",
              padding: "24px",
              borderRadius: "8px",
              width: "100%",
              maxWidth: "450px",
              maxHeight: "90vh",
              overflowY: "auto",
            }}
          >
            {modal.type === "delete" ? (
              <>
                <h2 style={{ fontSize: "20px", marginBottom: "16px" }}>
                  Eliminar usuario
                </h2>
                <p style={{ marginBottom: "16px" }}>
                  ¿Estás seguro de que deseas eliminar a{" "}
                  <strong>{modal.user.full_name ?? modal.user.email}</strong>?
                  Esta acción no se puede deshacer.
                </p>
                <div style={{ display: "flex", gap: "12px" }}>
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={isLoading}
                    style={{ padding: "10px 16px", cursor: "pointer" }}
                  >
                    {isLoading ? "Eliminando..." : "Sí, eliminar"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setModal({ type: "closed" })}
                    disabled={isLoading}
                    style={{ padding: "10px 16px", cursor: "pointer" }}
                  >
                    Cancelar
                  </button>
                </div>
              </>
            ) : modal.type === "create" ? (
              <>
                <h2 style={{ fontSize: "20px", marginBottom: "16px" }}>
                  Nuevo usuario
                </h2>
                <form
                  onSubmit={handleCreate}
                  style={{ display: "flex", flexDirection: "column", gap: "12px" }}
                >
                  <input
                    type="text"
                    placeholder="Nombre completo"
                    value={createForm.fullName}
                    onChange={(event) =>
                      setCreateForm((current) => ({
                        ...current,
                        fullName: event.target.value,
                      }))
                    }
                    required
                    style={{ padding: "10px" }}
                  />
                  <input
                    type="email"
                    placeholder="Correo electrónico"
                    value={createForm.email}
                    onChange={(event) =>
                      setCreateForm((current) => ({
                        ...current,
                        email: event.target.value,
                      }))
                    }
                    required
                    style={{ padding: "10px" }}
                  />
                  <input
                    type="password"
                    placeholder="Contraseña temporal"
                    value={createForm.password}
                    onChange={(event) =>
                      setCreateForm((current) => ({
                        ...current,
                        password: event.target.value,
                      }))
                    }
                    required
                    minLength={6}
                    style={{ padding: "10px" }}
                  />
                  <select
                    value={createForm.role}
                    onChange={(event) =>
                      setCreateForm((current) => ({
                        ...current,
                        role: event.target.value as UserRole,
                      }))
                    }
                    style={{ padding: "10px" }}
                  >
                    {Object.entries(roleLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <input
                      type="checkbox"
                      checked={createForm.isActive}
                      onChange={(event) =>
                        setCreateForm((current) => ({
                          ...current,
                          isActive: event.target.checked,
                        }))
                      }
                    />
                    Activo
                  </label>
                  <div style={{ display: "flex", gap: "12px", marginTop: "8px" }}>
                    <button
                      type="submit"
                      disabled={isLoading}
                      style={{ padding: "10px 16px", cursor: "pointer" }}
                    >
                      {isLoading ? "Guardando..." : "Crear usuario"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setModal({ type: "closed" })}
                      disabled={isLoading}
                      style={{ padding: "10px 16px", cursor: "pointer" }}
                    >
                      Cancelar
                    </button>
                  </div>
                </form>
              </>
            ) : (
              <>
                <h2 style={{ fontSize: "20px", marginBottom: "16px" }}>
                  Editar usuario
                </h2>
                <form
                  onSubmit={handleEdit}
                  style={{ display: "flex", flexDirection: "column", gap: "12px" }}
                >
                  <input
                    type="text"
                    placeholder="Nombre completo"
                    value={editForm.fullName}
                    onChange={(event) =>
                      setEditForm((current) => ({
                        ...current,
                        fullName: event.target.value,
                      }))
                    }
                    required
                    style={{ padding: "10px" }}
                  />
                  <input
                    type="email"
                    placeholder="Correo electrónico"
                    value={editForm.email}
                    onChange={(event) =>
                      setEditForm((current) => ({
                        ...current,
                        email: event.target.value,
                      }))
                    }
                    required
                    style={{ padding: "10px" }}
                  />
                  {modal.user.email.trim().toLowerCase() !==
                    editForm.email.trim().toLowerCase() && (
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        fontSize: "14px",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={confirmEmailChange}
                        onChange={(event) =>
                          setConfirmEmailChange(event.target.checked)
                        }
                      />
                      Confirmar cambio de correo
                    </label>
                  )}
                  <div style={{ display: "flex", gap: "12px", marginTop: "8px" }}>
                    <button
                      type="submit"
                      disabled={isLoading}
                      style={{ padding: "10px 16px", cursor: "pointer" }}
                    >
                      {isLoading ? "Guardando..." : "Guardar cambios"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setModal({ type: "closed" })}
                      disabled={isLoading}
                      style={{ padding: "10px 16px", cursor: "pointer" }}
                    >
                      Cancelar
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
