import { redirect } from "next/navigation";
import { StartShiftForm } from "@/components/work-shifts/start-shift-form";
import { requireProfile } from "@/lib/auth/session";
import { getWorkShiftAccess } from "@/lib/work-shifts/access";

export default async function StartShiftPage() {
  const profile = await requireProfile();
  if (profile.role !== "tecnico") redirect("/dashboard");

  const access = await getWorkShiftAccess();
  if (access.active) redirect("/dashboard");

  return (
    <main className="min-h-screen bg-white px-4 py-8 text-black sm:py-12">
      <div className="mx-auto grid w-full max-w-lg gap-4">
        <StartShiftForm />
      </div>
    </main>
  );
}
