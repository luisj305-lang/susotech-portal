-- Notificaciones in-app: tabla, RLS y trigger de cambios de estado/incidencia.

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_created_idx on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "Users can view their own notifications" on public.notifications;
create policy "Users can view their own notifications" on public.notifications
for select to authenticated using (auth.uid() = user_id);

drop policy if exists "Users can update their own notifications" on public.notifications;
create policy "Users can update their own notifications" on public.notifications
for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.notify_on_job_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  assigned uuid;
begin
  select ja.technician_id into assigned
  from public.job_assignments ja
  where ja.job_id = new.id and ja.active and ja.is_primary
  limit 1;

  if new.main_status is distinct from old.main_status then
    if new.main_status = 'asignado' and assigned is not null then
      insert into public.notifications (user_id, type, title, body, link)
      values (assigned, 'job_assigned', 'Trabajo asignado', 'Se te asignó un trabajo.', '/trabajos/' || new.id);
    elsif new.main_status = 'en_revision' then
      insert into public.notifications (user_id, type, title, body, link)
      select id, 'job_submitted', 'Trabajo en revisión', 'Un trabajo fue enviado a revisión.', '/trabajos/' || new.id
      from public.profiles where role in ('admin','supervisor') and is_active;
    elsif new.main_status = 'aprobado' and assigned is not null then
      insert into public.notifications (user_id, type, title, body, link)
      values (assigned, 'job_approved', 'Trabajo aprobado', 'Tu trabajo fue aprobado.', '/trabajos/' || new.id);
    end if;
  end if;

  if new.incident is distinct from old.incident and new.incident is not null then
    insert into public.notifications (user_id, type, title, body, link)
    select id, 'job_incident', 'Incidencia reportada', 'Se reportó una incidencia en un trabajo.', '/trabajos/' || new.id
    from public.profiles where role in ('admin','supervisor') and is_active;
  end if;

  return new;
end;
$$;

drop trigger if exists jobs_notify_on_change on public.jobs;
create trigger jobs_notify_on_change
after update of main_status, incident on public.jobs
for each row execute function public.notify_on_job_change();
