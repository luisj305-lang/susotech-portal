"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  isWorkerSpecialty,
  WORKER_SPECIALTIES,
  WORKER_SPECIALTY_LABELS,
  type WorkerSpecialty,
} from "@/lib/auth/capabilities";
import type { PriceCategory, UserRole } from "@/lib/auth/session";
import {
  createUser,
  deleteUser,
  updateUserProfile,
  updateUserRoleAndStatus,
  updateTechnicianPriceCategory,
  updateWorkerSpecialty,
} from "@/lib/users/actions";

type ManagedProfile = {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  is_active: boolean;
  worker_specialty: WorkerSpecialty | null;
  crew_names: string[];
  price_category_id: string | null;
  price_category_name: string | null;
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
  canManage,
  priceCategories,
}: {
  currentUserId: string;
  initialUsers: ManagedProfile[];
  canManage: boolean;
  priceCategories: PriceCategory[];
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
        current.map((u) =>
          u.id === userId
            ? {
                ...u,
                role: newRole,
                worker_specialty:
                  newRole === "tecnico"
                    ? (u.worker_specialty ?? "tecnico")
                    : null,
              }
            : u,
        ),
      );
      setMessage(result.message);
    } else {
      setMessage(result.message);
    }
  };

  const handlePriceCategoryChange = async (userId: string, priceCategoryId: string | null) => {
    setIsLoading(true);
    const result = await updateTechnicianPriceCategory({ userId, priceCategoryId });
    setIsLoading(false);
    setMessage(result.message);
    if (result.success) {
      const category = priceCategories.find((item) => item.id === priceCategoryId) ?? null;
      setUsers((current) => current.map((user) => user.id === userId ? {
        ...user,
        price_category_id: category?.id ?? null,
        price_category_name: category?.name ?? null,
      } : user));
    }
  };

  const handleWorkerSpecialtyChange = async (
    userId: string,
    workerSpecialty: WorkerSpecialty,
  ) => {
    setIsLoading(true);
    setMessage("");
    const result = await updateWorkerSpecialty({ userId, workerSpecialty });
    setIsLoading(false);
    setMessage(result.message);

    if (result.success) {
      setUsers((current) =>
        current.map((user) =>
          user.id === userId ? { ...user, worker_specialty: workerSpecialty } : user,
        ),
      );
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
    <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
      <Link href="/dashboard" className="text-sm font-medium text-accent-600 hover:underline">
        ← Volver al dashboard
      </Link>
      <h1 className="mt-6 text-3xl font-bold text-ink">Usuarios</h1>
      <p className="mb-6 mt-2 text-ink-muted">
        {canManage ? "Crea usuarios, edita sus datos y gestiona permisos." : "Consulta usuarios, crews y categorías de precio."}
      </p>

      {message && (
        <p role="status" className="mb-4 text-sm font-medium text-ink-soft">
          {message}
        </p>
      )}

      {canManage && <div className="mb-6">
        <Button
          type="button"
          onClick={() => {
            setModal({ type: "create" });
            setMessage("");
          }}
          disabled={isLoading}
        >
          + Nuevo usuario
        </Button>
      </div>}

      <div className="overflow-x-auto rounded-2xl border border-line bg-white">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-surface-muted text-xs uppercase tracking-wide text-ink-muted">
              <th className="px-4 py-3 text-left font-semibold">Nombre</th>
              <th className="px-4 py-3 text-left font-semibold">Correo</th>
              <th className="px-4 py-3 text-left font-semibold">Rol</th>
              <th className="px-4 py-3 text-left font-semibold">Especialidad</th>
              <th className="px-4 py-3 text-left font-semibold">Categoría de precio</th>
              <th className="px-4 py-3 text-left font-semibold">Crew / Equipos</th>
              <th className="px-4 py-3 text-left font-semibold">Estado</th>
              <th className="px-4 py-3 text-left font-semibold">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const isCurrentUser = user.id === currentUserId;

              return (
                <tr key={user.id} className="border-t border-line">
                  <td className="px-4 py-3 text-ink-soft">
                    {user.full_name ?? "Sin nombre"}
                  </td>
                  <td className="px-4 py-3 text-ink-soft">{user.email}</td>
                  <td className="px-4 py-3">
                    <label>
                      <span className="sr-only">
                        Rol de {user.full_name ?? user.email}
                      </span>
                      {canManage ? <select
                        value={user.role}
                        disabled={isCurrentUser || isLoading}
                        onChange={(event) =>
                          void handleRoleChange(
                            user.id,
                            event.target.value as UserRole,
                          )
                        }
                        className="rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink focus:border-accent-500 focus:outline-none"
                      >
                        {Object.entries(roleLabels).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select> : <span className="text-ink-soft">{roleLabels[user.role]}</span>}
                    </label>
                  </td>
                  <td className="px-4 py-3">
                    {user.role === "tecnico" ? (
                      canManage ? (
                        <select
                          aria-label={`Especialidad de ${user.full_name ?? user.email}`}
                          value={user.worker_specialty ?? ""}
                          disabled={isLoading}
                          onChange={(event) => {
                            const specialty = event.target.value;
                            if (isWorkerSpecialty(specialty)) {
                              void handleWorkerSpecialtyChange(user.id, specialty);
                            }
                          }}
                          className="rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink focus:border-accent-500 focus:outline-none"
                        >
                          <option value="" disabled>
                            Sin especialidad
                          </option>
                          {WORKER_SPECIALTIES.map((specialty) => (
                            <option key={specialty} value={specialty}>
                              {WORKER_SPECIALTY_LABELS[specialty]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-ink-soft">
                          {user.worker_specialty
                            ? WORKER_SPECIALTY_LABELS[user.worker_specialty]
                            : "Sin especialidad"}
                        </span>
                      )
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3">{user.role === "tecnico" ? canManage ? <select aria-label={`Categoría de precio de ${user.full_name ?? user.email}`} value={user.price_category_id ?? ""} disabled={isLoading} onChange={(event) => void handlePriceCategoryChange(user.id, event.target.value || null)} className="rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink focus:border-accent-500 focus:outline-none"><option value="">Sin categoría</option>{priceCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select> : (user.price_category_name ?? "Sin categoría") : "—"}</td>
                  <td className="px-4 py-3">
                    {user.crew_names.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {user.crew_names.map((name) => (
                          <span
                            key={name}
                            className="rounded-full border border-line bg-surface-muted px-2 py-0.5 text-xs text-ink-soft"
                          >
                            {name}
                          </span>
                        ))}
                      </div>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {canManage ? <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={isCurrentUser || isLoading}
                      onClick={() => void handleStatusToggle(user.id)}
                    >
                      {user.is_active ? "Activo" : "Inactivo"}
                    </Button> : user.is_active ? "Activo" : "Inactivo"}
                    {isCurrentUser && <span className="ml-2 text-xs text-ink-muted"> (tu cuenta)</span>}
                  </td>
                  <td className="px-4 py-3">
                    {canManage && <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={isLoading}
                        onClick={() => openEdit(user)}
                      >
                        Editar
                      </Button>
                      <Button
                        type="button"
                        variant="danger"
                        size="sm"
                        disabled={isCurrentUser || isLoading}
                        onClick={() => {
                          setModal({ type: "delete", user });
                          setMessage("");
                        }}
                      >
                        Eliminar
                      </Button>
                    </div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {modal.type !== "closed" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-950/40 p-5">
          <div className="max-h-[90vh] w-full max-w-[450px] overflow-y-auto rounded-2xl border border-line bg-white p-6 shadow-card">
            {modal.type === "delete" ? (
              <>
                <h2 className="mb-4 text-xl font-semibold text-ink">
                  Eliminar usuario
                </h2>
                <p className="mb-4 text-sm text-ink-soft">
                  ¿Estás seguro de que deseas eliminar a{" "}
                  <strong className="font-semibold text-ink">{modal.user.full_name ?? modal.user.email}</strong>?
                  Esta acción no se puede deshacer.
                </p>
                <div className="flex gap-3">
                  <Button
                    type="button"
                    variant="dangerSolid"
                    onClick={handleDelete}
                    disabled={isLoading}
                  >
                    {isLoading ? "Eliminando..." : "Sí, eliminar"}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setModal({ type: "closed" })}
                    disabled={isLoading}
                  >
                    Cancelar
                  </Button>
                </div>
              </>
            ) : modal.type === "create" ? (
              <>
                <h2 className="mb-4 text-xl font-semibold text-ink">
                  Nuevo usuario
                </h2>
                <form onSubmit={handleCreate} className="flex flex-col gap-3">
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
                    className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none"
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
                    className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none"
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
                    className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none"
                  />
                  <select
                    value={createForm.role}
                    onChange={(event) =>
                      setCreateForm((current) => ({
                        ...current,
                        role: event.target.value as UserRole,
                      }))
                    }
                    className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none"
                  >
                    {Object.entries(roleLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <label className="flex items-center gap-2 text-sm text-ink-soft">
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
                  <div className="mt-2 flex gap-3">
                    <Button
                      type="submit"
                      variant="primary"
                      disabled={isLoading}
                    >
                      {isLoading ? "Guardando..." : "Crear usuario"}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setModal({ type: "closed" })}
                      disabled={isLoading}
                    >
                      Cancelar
                    </Button>
                  </div>
                </form>
              </>
            ) : (
              <>
                <h2 className="mb-4 text-xl font-semibold text-ink">
                  Editar usuario
                </h2>
                <form onSubmit={handleEdit} className="flex flex-col gap-3">
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
                    className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none"
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
                    className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none"
                  />
                  {modal.user.email.trim().toLowerCase() !==
                    editForm.email.trim().toLowerCase() && (
                    <label className="flex items-center gap-2 text-sm text-ink-soft">
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
                  <div className="mt-2 flex gap-3">
                    <Button
                      type="submit"
                      variant="primary"
                      disabled={isLoading}
                    >
                      {isLoading ? "Guardando..." : "Guardar cambios"}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setModal({ type: "closed" })}
                      disabled={isLoading}
                    >
                      Cancelar
                    </Button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
