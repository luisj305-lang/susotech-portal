"use client";

import { useState, useTransition } from "react";
import { addCrewMember, createCrew, removeCrewMember, setCrewActive, updateCrew } from "@/lib/jobs/actions";
import type { CrewOfficeDto, TechnicianDirectoryOption } from "@/lib/jobs/types";
import { availableCrewMembers, canRemoveCrewMember } from "./crew-manager-model";

type Feedback = { scope: string; message: string; error: boolean } | null;

export function CrewManager({ crews, technicians }: { crews: CrewOfficeDto[]; technicians: TechnicianDirectoryOption[] }) {
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [pending, startTransition] = useTransition();
  const run = (scope: string, action: () => Promise<{ success: boolean; message: string }>) => startTransition(async () => {
    try { const result = await action(); setFeedback({ scope, message: result.message, error: !result.success }); }
    catch { setFeedback({ scope, message: "No se pudo completar la operación. Intenta de nuevo.", error: true }); }
  });
  const status = (scope: string) => feedback?.scope === scope && <p role="status" className={`mt-3 text-sm font-medium ${feedback.error ? "text-red-700" : "text-emerald-700"}`}>{feedback.message}</p>;

  return <div className="grid gap-6">
    <section className="rounded-2xl border bg-white p-5 shadow-sm"><h2 className="text-lg font-bold">Crear equipo</h2><form className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); run("create", () => createCrew({ name: String(form.get("name")), leadTechnicianId: String(form.get("lead")) })); }}>
      <label className="grid gap-1 text-sm font-medium">Nombre<input name="name" required maxLength={120} className="rounded-lg border p-3" /></label>
      <label className="grid gap-1 text-sm font-medium">Responsable<select name="lead" required defaultValue="" className="rounded-lg border p-3"><option value="" disabled>Selecciona un técnico</option>{technicians.map((tech) => <option key={tech.id} value={tech.id}>{tech.label}</option>)}</select></label>
      <button disabled={pending || !technicians.length} className="self-end rounded-lg bg-slate-900 px-5 py-3 font-semibold text-white disabled:opacity-50">Crear equipo</button>
    </form>{status("create")}</section>

    {!crews.length ? <section className="rounded-2xl border border-dashed bg-white p-10 text-center"><h2 className="font-semibold">No hay equipos</h2><p className="mt-2 text-sm text-slate-600">Crear el primer equipo usando el formulario anterior.</p></section> : <div className="grid gap-5 lg:grid-cols-2">{crews.map((crew) => {
      const candidates = availableCrewMembers(crew, technicians);
      return <article key={crew.id} className="rounded-2xl border bg-white p-5 shadow-sm"><div className="flex items-start justify-between gap-3"><div><h2 className="text-xl font-bold">{crew.name}</h2><p className="text-sm text-slate-600">Responsable: {crew.lead_label}</p></div><span className={`rounded-full px-3 py-1 text-xs font-semibold ${crew.is_active ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"}`}>{crew.is_active ? "Activo" : "Inactivo"}</span></div>
        <form className="mt-5 grid gap-3" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); run(crew.id, () => updateCrew({ crewId: crew.id, name: String(form.get("name")), leadTechnicianId: String(form.get("lead")) })); }}>
          <label className="grid gap-1 text-sm font-medium">Nombre<input name="name" required maxLength={120} defaultValue={crew.name} className="rounded-lg border p-3" /></label>
          <label className="grid gap-1 text-sm font-medium">Responsable<select name="lead" required defaultValue={crew.lead_technician_id} className="rounded-lg border p-3">{!technicians.some((tech) => tech.id === crew.lead_technician_id) && <option value={crew.lead_technician_id}>Responsable no disponible</option>}{technicians.map((tech) => <option key={tech.id} value={tech.id}>{tech.label}</option>)}</select></label>
          <button disabled={pending} className="rounded-lg border px-4 py-3 font-semibold disabled:opacity-50">Guardar cambios</button>
        </form>
        <div className="mt-5"><h3 className="font-semibold">Integrantes</h3>{crew.members.length ? <ul className="mt-2 grid gap-2">{crew.members.map((member) => <li key={member.id} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 p-3"><span>{member.label}{member.id === crew.lead_technician_id ? " · Responsable" : ""}</span><button type="button" disabled={pending || !canRemoveCrewMember(crew, member.id)} onClick={() => window.confirm(`¿Quitar a ${member.label} del equipo?`) && run(crew.id, () => removeCrewMember({ crewId: crew.id, technicianId: member.id }))} className="rounded-md border px-3 py-2 text-sm font-semibold disabled:opacity-40">Quitar</button></li>)}</ul> : <p className="mt-2 text-sm text-slate-600">Sin integrantes adicionales.</p>}
          <form className="mt-3 flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); run(crew.id, () => addCrewMember({ crewId: crew.id, technicianId: String(form.get("member")) })); }}><label className="sr-only" htmlFor={`member-${crew.id}`}>Añadir integrante</label><select id={`member-${crew.id}`} name="member" required defaultValue="" className="min-w-0 flex-1 rounded-lg border p-3"><option value="" disabled>Añadir técnico</option>{candidates.map((tech) => <option key={tech.id} value={tech.id}>{tech.label}</option>)}</select><button disabled={pending || !candidates.length || !crew.is_active} className="rounded-lg border px-4 py-3 font-semibold disabled:opacity-50">Añadir</button></form>
        </div>
        <button type="button" disabled={pending} onClick={() => window.confirm(`¿${crew.is_active ? "Desactivar" : "Activar"} ${crew.name}?`) && run(crew.id, () => setCrewActive({ crewId: crew.id, active: !crew.is_active }))} className="mt-5 rounded-lg bg-slate-900 px-4 py-3 font-semibold text-white disabled:opacity-50">{crew.is_active ? "Desactivar equipo" : "Activar equipo"}</button>
        {status(crew.id)}
      </article>;
    })}</div>}
  </div>;
}
