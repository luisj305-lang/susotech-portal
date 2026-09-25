"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

export function RecruitmentSubmitButton() {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending} className="w-full">{pending ? "Guardando..." : "Guardar seguimiento"}</Button>;
}
