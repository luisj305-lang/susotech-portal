"use client";

import { useState, useTransition } from "react";
import { addCrewMember, createCrew, removeCrewMember, setCrewActive, updateCrew } from "@/lib/jobs/actions";
import type { CrewOfficeDto, TechnicianDirectoryOption } from "@/lib/jobs/types";
import { availableCrewMembers, canRemoveCrewMember } from "./crew-manager-model";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";

type Feedback = { scope: string; message: string; error: boolean } | null;

export function CrewManager({ crews, technicians, canManage }: { crews: CrewOfficeDto[]; technicians: TechnicianDirectoryOption[]; canManage: boolean }) {
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [pending, startTransition] = useTransition();
  const run = (scope: string, action: () => Promise<{ success: boolean; message: string }>) => startTransition(async () => {
    try { const result = await action(); setFeedback({ scope, message: result.message, error: !result.success }); }
    catch { setFeedback({ scope, message: "No se pudo completar la operación. Intenta de nuevo.", error: true }); }
  });
  const status = (scope: string) => feedback?.scope === scope && <p role="status" className="mt-3 text-sm font-medium text-ink-soft">{feedback.message}</p>;

  return <div className="grid gap-6">
    {canManage ? <section className="rounded-2xl border border-line bg-white p-6 shadow-card"><h2 className="text-lg font-bold">Crear equipo</h2><form className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); run("create", () => createCrew({ name: String(form.get("name")), leadTechnicianId: String(form.get("lead")) })); }}>
      <label className="grid gap-1 text-sm font-medium text-ink-soft">Nombre<input name="name" required maxLength={120} className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none" /></label>
      <label className="grid gap-1 text-sm font-medium text-ink-soft">Líder técnico<select name="lead" required defaultValue="" className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none"><option value="" disabled>Selecciona un técnico</option>{technicians.map((tech) => <option key={tech.id} value={tech.id}>{tech.label}</option>)}</select></label>
      <Button disabled={pending || !technicians.length} className="self-end" variant="primary">Crear equipo</Button>
    </form>{status("create")}</section> : <section className="rounded-2xl border border-line bg-white p-4 text-sm text-ink-soft"><strong>Modo consulta.</strong> Solo los administradores pueden modificar equipos y membresías.</section>}

    {!crews.length ? <section className="rounded-2xl border border-dashed border-line bg-white p-10 text-center"><h2 className="font-semibold text-ink">No hay equipos</h2><p className="mt-2 text-sm text-ink-soft">{canManage ? "Crea el primer equipo usando el formulario anterior." : "No hay equipos disponibles para consultar."}</p></section> : <div className="grid gap-5 lg:grid-cols-2">{crews.map((crew) => {
      const candidates = availableCrewMembers(crew, technicians);
      return <article key={crew.id} className="rounded-2xl border border-line bg-white p-6 shadow-card"><div className="flex items-start justify-between gap-3"><div><h2 className="text-xl font-bold text-ink">{crew.name}</h2><p className="text-sm text-ink-soft">Líder técnico: {crew.lead_label}</p></div><StatusBadge status={crew.is_active ? "activo" : "inactivo"} /></div>
        {canManage && <form className="mt-5 grid gap-3" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); run(crew.id, () => updateCrew({ crewId: crew.id, name: String(form.get("name")), leadTechnicianId: String(form.get("lead")) })); }}>
          <label className="grid gap-1 text-sm font-medium text-ink-soft">Nombre<input name="name" required maxLength={120} defaultValue={crew.name} className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none" /></label>
          <label className="grid gap-1 text-sm font-medium text-ink-soft">Líder técnico<select name="lead" required defaultValue={crew.lead_technician_id} className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none">{!technicians.some((tech) => tech.id === crew.lead_technician_id) && <option value={crew.lead_technician_id}>Líder no disponible</option>}{technicians.map((tech) => <option key={tech.id} value={tech.id}>{tech.label}</option>)}</select></label>
          <Button disabled={pending} variant="secondary" size="sm">Guardar cambios</Button>
        </form>}
        <div className="mt-5"><h3 className="font-semibold text-ink">Técnicos miembros</h3>{crew.members.length ? <ul className="mt-2 grid gap-2">{crew.members.map((member) => <li key={member.id} className="flex items-center justify-between gap-3 rounded-xl border border-line p-3"><span className="text-ink">{member.label}{member.id === crew.lead_technician_id ? " · Líder" : ""}</span>{canManage && <Button type="button" disabled={pending || !canRemoveCrewMember(crew, member.id)} onClick={() => window.confirm(`¿Quitar a ${member.label} del equipo?`) && run(crew.id, () => removeCrewMember({ crewId: crew.id, technicianId: member.id }))} variant="secondary" size="sm">Quitar</Button>}</li>)}</ul> : <p className="mt-2 text-sm text-ink-soft">Sin integrantes adicionales.</p>}
          {canManage && <form className="mt-3 flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); run(crew.id, () => addCrewMember({ crewId: crew.id, technicianId: String(form.get("member")) })); }}><label className="sr-only" htmlFor={`member-${crew.id}`}>Añadir integrante</label><select id={`member-${crew.id}`} name="member" required defaultValue="" className="min-w-0 flex-1 rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none"><option value="" disabled>Añadir técnico</option>{candidates.map((tech) => <option key={tech.id} value={tech.id}>{tech.label}</option>)}</select><Button disabled={pending || !candidates.length || !crew.is_active} variant="secondary" size="sm">Añadir</Button></form>}
        </div>
        {canManage && <Button type="button" disabled={pending} onClick={() => window.confirm(`¿${crew.is_active ? "Desactivar" : "Activar"} ${crew.name}?`) && run(crew.id, () => setCrewActive({ crewId: crew.id, active: !crew.is_active }))} className="mt-5" variant="primary">{crew.is_active ? "Desactivar equipo" : "Activar equipo"}</Button>}
        {status(crew.id)}
      </article>;
    })}</div>}
  </div>;
}
