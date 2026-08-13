import { redirect } from "next/navigation";
import { StartShiftForm } from "@/components/work-shifts/start-shift-form";
import { requireProfile } from "@/lib/auth/session";
import { getWorkShiftAccess } from "@/lib/work-shifts/access";
import { ACTIVE_SHIFT_REQUIRED_MESSAGE } from "@/lib/work-shifts/types";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function StartShiftPage({ searchParams }: { searchParams: SearchParams }) {
  const profile = await requireProfile();
  if (profile.role !== "tecnico") redirect("/dashboard");

  const access = await getWorkShiftAccess();
  if (access.active) redirect("/dashboard");

  const values = await searchParams;
  const reason = Array.isArray(values.reason) ? values.reason[0] : values.reason;

  return (
    <main className="min-h-screen bg-black px-4 py-8 text-white sm:py-12">
      <div className="mx-auto grid w-full max-w-lg gap-4">
        {reason === "expired" && (
          <p role="alert" className="rounded-2xl border border-amber-300/60 bg-amber-950/40 p-4 text-sm font-semibold text-amber-100">
            {ACTIVE_SHIFT_REQUIRED_MESSAGE}
          </p>
        )}
        <StartShiftForm />
      </div>
    </main>
  );
}
