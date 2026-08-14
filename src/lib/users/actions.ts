"use server";

import { revalidatePath } from "next/cache";
import {
  isWorkerSpecialty,
  type WorkerSpecialty,
} from "@/lib/auth/capabilities";
import { requireAdmin } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/auth/session";

const allowedRoles: UserRole[] = ["admin", "supervisor", "tecnico"];

type ActionResult =
  | { success: true; message: string }
  | { success: false; message: string };

function validateEmail(email: string): string | null {
  if (!email || email.trim().length === 0) {
    return "El correo es obligatorio.";
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return "El correo no tiene un formato válido.";
  }

  return null;
}

function validateFullName(fullName: string): string | null {
  if (!fullName || fullName.trim().length === 0) {
    return "El nombre completo es obligatorio.";
  }

  return null;
}

function validatePassword(password: string): string | null {
  if (!password || password.length < 6) {
    return "La contraseña debe tener al menos 6 caracteres.";
  }

  return null;
}

function validateRole(role: string): string | null {
  if (!allowedRoles.includes(role as UserRole)) {
    return "El rol no es válido.";
  }

  return null;
}

export async function createUser(input: {
  email: string;
  password: string;
  fullName: string;
  role: UserRole;
  isActive: boolean;
}): Promise<ActionResult> {
  try {
    await requireAdmin();

    const emailError = validateEmail(input.email);
    if (emailError) return { success: false, message: emailError };

    const passwordError = validatePassword(input.password);
    if (passwordError) return { success: false, message: passwordError };

    const fullNameError = validateFullName(input.fullName);
    if (fullNameError) return { success: false, message: fullNameError };

    const roleError = validateRole(input.role);
    if (roleError) return { success: false, message: roleError };

    const serviceClient = createServiceClient();

    const { data: existing } = await serviceClient
      .from("profiles")
      .select("id")
      .eq("email", input.email)
      .maybeSingle();

    if (existing) {
      return { success: false, message: "Ya existe un usuario con ese correo." };
    }

    const { data: authData, error: authError } =
      await serviceClient.auth.admin.createUser({
        email: input.email,
        password: input.password,
        email_confirm: true,
      });

    if (authError || !authData.user) {
      return {
        success: false,
        message: authError?.message || "No se pudo crear el usuario en Auth.",
      };
    }

    const { error: profileError } = await serviceClient
      .from("profiles")
      .update({
        full_name: input.fullName.trim(),
        role: input.role,
        is_active: input.isActive,
        updated_at: new Date().toISOString(),
      })
      .eq("id", authData.user.id);

    if (profileError) {
      await serviceClient.auth.admin.deleteUser(authData.user.id);
      return {
        success: false,
        message: "No se pudo guardar el perfil. El usuario fue descartado.",
      };
    }

    revalidatePath("/usuarios");
    return { success: true, message: "Usuario creado correctamente." };
  } catch (error) {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") {
      throw error;
    }

    return {
      success: false,
      message:
        error instanceof Error ? error.message : "Error al crear el usuario.",
    };
  }
}

export async function updateUserProfile(input: {
  userId: string;
  fullName: string;
  email: string;
  currentEmail: string;
}): Promise<ActionResult> {
  try {
    await requireAdmin();

    const emailError = validateEmail(input.email);
    if (emailError) return { success: false, message: emailError };

    const fullNameError = validateFullName(input.fullName);
    if (fullNameError) return { success: false, message: fullNameError };

    const normalizedEmail = input.email.trim().toLowerCase();
    const normalizedCurrentEmail = input.currentEmail.trim().toLowerCase();
    const emailChanged = normalizedEmail !== normalizedCurrentEmail;

    if (emailChanged) {
      const serviceClient = createServiceClient();

      const { data: existing } = await serviceClient
        .from("profiles")
        .select("id")
        .eq("email", normalizedEmail)
        .neq("id", input.userId)
        .maybeSingle();

      if (existing) {
        return { success: false, message: "Ya existe otro usuario con ese correo." };
      }

      const { error: authError } =
        await serviceClient.auth.admin.updateUserById(input.userId, {
          email: normalizedEmail,
        });

      if (authError) {
        return {
          success: false,
          message: `No se pudo actualizar el correo en Auth: ${authError.message}`,
        };
      }

      const { error: profileError } = await serviceClient
        .from("profiles")
        .update({
          email: normalizedEmail,
          full_name: input.fullName.trim(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", input.userId);

      if (profileError) {
        await serviceClient.auth.admin.updateUserById(input.userId, {
          email: normalizedCurrentEmail,
        });

        return {
          success: false,
          message:
            "No se pudo actualizar el perfil. El correo en Auth fue revertido.",
        };
      }
    } else {
      const serviceClient = createServiceClient();

      const { error: profileError } = await serviceClient
        .from("profiles")
        .update({
          full_name: input.fullName.trim(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", input.userId);

      if (profileError) {
        return {
          success: false,
          message: "No se pudo actualizar el perfil.",
        };
      }
    }

    revalidatePath("/usuarios");
    return { success: true, message: "Usuario actualizado correctamente." };
  } catch (error) {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") {
      throw error;
    }

    return {
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "Error al actualizar el usuario.",
    };
  }
}

export async function updateUserRoleAndStatus(input: {
  userId: string;
  role: UserRole;
  isActive: boolean;
  currentAdminId: string;
}): Promise<ActionResult> {
  try {
    await requireAdmin();

    if (input.userId === input.currentAdminId) {
      return {
        success: false,
        message: "No puedes modificar tu propio rol o estado.",
      };
    }

    const roleError = validateRole(input.role);
    if (roleError) return { success: false, message: roleError };

    const serviceClient = createServiceClient();

    const { error } = await serviceClient
      .from("profiles")
      .update({
        role: input.role,
        is_active: input.isActive,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.userId);

    if (error) {
      return {
        success: false,
        message: "No se pudo actualizar el rol o estado.",
      };
    }

    revalidatePath("/usuarios");
    return { success: true, message: "Rol y estado actualizados." };
  } catch (error) {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") {
      throw error;
    }

    return {
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "Error al actualizar rol o estado.",
    };
  }
}

export async function deleteUser(input: {
  userId: string;
  currentAdminId: string;
}): Promise<ActionResult> {
  try {
    await requireAdmin();

    if (input.userId === input.currentAdminId) {
      return {
        success: false,
        message: "No puedes eliminar tu propia cuenta.",
      };
    }

    const serviceClient = createServiceClient();

    const { error: authError } = await serviceClient.auth.admin.deleteUser(
      input.userId,
    );

    if (authError) {
      return {
        success: false,
        message: `No se pudo eliminar el usuario: ${authError.message}`,
      };
    }

    revalidatePath("/usuarios");
    return { success: true, message: "Usuario eliminado correctamente." };
  } catch (error) {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") {
      throw error;
    }

    return {
      success: false,
      message:
        error instanceof Error ? error.message : "Error al eliminar el usuario.",
    };
  }
}

export async function updateTechnicianPriceCategory(input: { userId: string; priceCategoryId: string | null }): Promise<ActionResult> {
  try {
    await requireAdmin();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(input.userId)
      || (input.priceCategoryId !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(input.priceCategoryId))) {
      return { success: false, message: "La categoría de precio no es válida." };
    }
    const { error } = await (await createClient()).rpc("set_technician_price_category", {
      p_technician_id: input.userId,
      p_price_category_id: input.priceCategoryId,
    });
    if (error) return { success: false, message: "No se pudo actualizar la categoría de precio." };
    revalidatePath("/usuarios");
    return { success: true, message: "Categoría de precio actualizada." };
  } catch (error) {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") throw error;
    return { success: false, message: "No se pudo actualizar la categoría de precio." };
  }
}

export async function updateWorkerSpecialty(input: {
  userId: string;
  workerSpecialty: WorkerSpecialty;
}): Promise<ActionResult> {
  try {
    await requireAdmin();

    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        input.userId,
      ) ||
      !isWorkerSpecialty(input.workerSpecialty)
    ) {
      return { success: false, message: "La especialidad no es válida." };
    }

    const supabase = await createClient();
    const { error } = await supabase.rpc("set_worker_specialty", {
      p_profile_id: input.userId,
      p_worker_specialty: input.workerSpecialty,
    });

    if (error) {
      return {
        success: false,
        message: "No se pudo actualizar la especialidad.",
      };
    }

    revalidatePath("/usuarios");
    return { success: true, message: "Especialidad actualizada." };
  } catch (error) {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") {
      throw error;
    }

    return {
      success: false,
      message: "No se pudo actualizar la especialidad.",
    };
  }
}
