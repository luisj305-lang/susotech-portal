-- Módulo de trabajos: enums, tablas, invariantes, RLS, historial y Storage privado.

-- Enums

create type public.job_status as enum (
  'asignado',
  'en_progreso',
  'enviado_revision',
  'aprobado',
  'listo_pagar',
  'pagado'
);

create type public.incident_type as enum (
  'need_splicing',
  'no_access',
  'need_cr',
  'permit_pending',
  'returned',
  'incomplete'
);

create type public.assignee_type as enum ('technician', 'crew');

create type public.job_category as enum ('categoria_1', 'categoria_2', 'categoria_3');

-- Helper: admin o supervisor activo

create or replace function public.is_office_staff(check_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = check_user_id
      and role in ('admin', 'supervisor')
      and is_active
  );
$$;

revoke all on function public.is_office_staff(uuid) from public;
grant execute on function public.is_office_staff(uuid) to authenticated;

-- Helper: técnico activo

create or replace function public.is_technician(check_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = check_user_id
      and role = 'tecnico'
      and is_active
  );
$$;

revoke all on function public.is_technician(uuid) from public;
grant execute on function public.is_technician(uuid) to authenticated;

-- Tablas

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  prism_number text,
  njuns_number text,
  title text not null check (btrim(title) <> ''),
  address text,
  location text,
  job_type text,
  description text,
  special_instructions text,
  required_material text,
  category public.job_category not null default 'categoria_1',
  main_status public.job_status not null default 'asignado',
  incident public.incident_type,
  incident_notes text,
  comments text,
  estimated_total numeric,
  project_map_url text,
  project_pdf_url text,
  assignment_date timestamptz,
  deadline_date timestamptz,
  submitted_at timestamptz,
  approved_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.jobs enable row level security;

create table public.crews (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  lead_technician_id uuid not null references public.profiles(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.crews enable row level security;

create table public.crew_members (
  crew_id uuid not null references public.crews(id) on delete cascade,
  technician_id uuid not null references public.profiles(id),
  primary key (crew_id, technician_id)
);

alter table public.crew_members enable row level security;

create table public.job_assignments (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  assignee_type public.assignee_type not null,
  technician_id uuid references public.profiles(id),
  crew_id uuid references public.crews(id),
  assigned_by uuid not null references public.profiles(id),
  assigned_at timestamptz not null default now(),
  is_primary boolean not null default true,
  active boolean not null default true,
  constraint valid_assignee check (
    (assignee_type = 'technician' and technician_id is not null and crew_id is null) or
    (assignee_type = 'crew' and crew_id is not null and technician_id is null)
  )
);

alter table public.job_assignments enable row level security;

create unique index job_assignments_one_active_primary_idx
on public.job_assignments (job_id)
where active and is_primary;

create index job_assignments_technician_idx
on public.job_assignments (technician_id, job_id)
where active;

create index job_assignments_crew_idx
on public.job_assignments (crew_id, job_id)
where active;

create table public.job_status_history (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  previous_status public.job_status,
  new_status public.job_status,
  previous_incident public.incident_type,
  new_incident public.incident_type,
  changed_by uuid not null references public.profiles(id),
  notes text,
  created_at timestamptz not null default now()
);

alter table public.job_status_history enable row level security;

create index job_status_history_job_created_idx
on public.job_status_history (job_id, created_at desc);

create table public.job_production_codes (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  code text not null check (btrim(code) <> ''),
  quantity numeric not null default 1 check (quantity > 0),
  notes text,
  added_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.job_production_codes enable row level security;

create table public.job_photos (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  storage_path text not null unique check (btrim(storage_path) <> ''),
  photo_type text not null check (photo_type in ('before', 'after', 'evidence')),
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.job_photos enable row level security;

-- Authorization helpers run as definer to avoid mutually recursive RLS policies.

create or replace function public.can_access_crew(
  check_crew_id uuid,
  check_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select public.is_office_staff(check_user_id)
    or (
      public.is_technician(check_user_id)
      and exists (
        select 1
        from public.crews c
        where c.id = check_crew_id
          and (
            c.lead_technician_id = check_user_id
            or exists (
              select 1
              from public.crew_members cm
              where cm.crew_id = c.id
                and cm.technician_id = check_user_id
            )
          )
      )
    );
$$;

create or replace function public.can_access_job(
  check_job_id uuid,
  check_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select public.is_office_staff(check_user_id)
    or (
      public.is_technician(check_user_id)
      and exists (
        select 1
        from public.job_assignments ja
        where ja.job_id = check_job_id
          and ja.active
          and (
            (ja.assignee_type = 'technician' and ja.technician_id = check_user_id)
            or (
              ja.assignee_type = 'crew'
              and exists (
                select 1
                from public.crews c
                where c.id = ja.crew_id
                  and c.is_active
                  and (
                    c.lead_technician_id = check_user_id
                    or exists (
                      select 1
                      from public.crew_members cm
                      where cm.crew_id = c.id
                        and cm.technician_id = check_user_id
                    )
                  )
              )
            )
          )
      )
    );
$$;

create or replace function public.job_id_from_storage_path(object_name text)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
begin
  return nullif((storage.foldername(object_name))[1], '')::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

revoke all on function public.can_access_crew(uuid, uuid) from public;
revoke all on function public.can_access_job(uuid, uuid) from public;
revoke all on function public.job_id_from_storage_path(text) from public;
grant execute on function public.can_access_crew(uuid, uuid) to authenticated;
grant execute on function public.can_access_job(uuid, uuid) to authenticated;
grant execute on function public.job_id_from_storage_path(text) to authenticated;

-- Políticas RLS

-- jobs

create policy "Office staff can manage jobs"
on public.jobs for all
to authenticated
using (public.is_office_staff())
with check (public.is_office_staff());

create policy "Technicians can view assigned jobs"
on public.jobs for select
to authenticated
using (public.is_technician() and public.can_access_job(id));

create policy "Technicians can update assigned job operations"
on public.jobs for update
to authenticated
using (public.is_technician() and public.can_access_job(id))
with check (public.is_technician() and public.can_access_job(id));

-- crews

create policy "Office staff can manage crews"
on public.crews for all
to authenticated
using (public.is_office_staff())
with check (public.is_office_staff());

create policy "Technicians can view their crews"
on public.crews for select
to authenticated
using (public.is_technician() and public.can_access_crew(id));

-- crew_members

create policy "Office staff can manage crew members"
on public.crew_members for all
to authenticated
using (public.is_office_staff())
with check (public.is_office_staff());

create policy "Technicians can view their crew members"
on public.crew_members for select
to authenticated
using (public.is_technician() and public.can_access_crew(crew_id));

-- job_assignments

create policy "Office staff can manage assignments"
on public.job_assignments for all
to authenticated
using (public.is_office_staff())
with check (public.is_office_staff());

create policy "Technicians can view their assignments"
on public.job_assignments for select
to authenticated
using (
  public.is_technician()
  and active
  and (
    (assignee_type = 'technician' and technician_id = auth.uid())
    or (assignee_type = 'crew' and public.can_access_crew(crew_id))
  )
);

-- job_status_history

create policy "Office staff can view history"
on public.job_status_history for select
to authenticated
using (public.is_office_staff());

create policy "Office staff can append history"
on public.job_status_history for insert
to authenticated
with check (public.is_office_staff() and changed_by = auth.uid());

create policy "Technicians can view history of assigned jobs"
on public.job_status_history for select
to authenticated
using (public.is_technician() and public.can_access_job(job_id));

-- job_production_codes

create policy "Office staff can manage production codes"
on public.job_production_codes for all
to authenticated
using (public.is_office_staff())
with check (public.is_office_staff());

create policy "Technicians can view production codes of assigned jobs"
on public.job_production_codes for select
to authenticated
using (public.is_technician() and public.can_access_job(job_id));

create policy "Technicians can add production codes to assigned jobs"
on public.job_production_codes for insert
to authenticated
with check (
  public.is_technician()
  and added_by = auth.uid()
  and public.can_access_job(job_id)
  and exists (
    select 1 from public.jobs
    where id = job_id and main_status = 'en_progreso'
  )
);

-- job_photos

create policy "Office staff can manage photos"
on public.job_photos for all
to authenticated
using (public.is_office_staff())
with check (public.is_office_staff());

create policy "Technicians can view photos of assigned jobs"
on public.job_photos for select
to authenticated
using (public.is_technician() and public.can_access_job(job_id));

create policy "Technicians can add photos to assigned jobs"
on public.job_photos for insert
to authenticated
with check (
  public.is_technician()
  and uploaded_by = auth.uid()
  and public.can_access_job(job_id)
  and public.job_id_from_storage_path(storage_path) = job_id
);

-- Trigger de historial

create or replace function public.validate_crew_lead()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles where id = new.lead_technician_id and role = 'tecnico' and is_active) then
    raise exception 'Crew lead must be an active technician';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.ensure_crew_lead_membership()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.crew_members (crew_id, technician_id)
  values (new.id, new.lead_technician_id) on conflict do nothing;
  return new;
end;
$$;

create or replace function public.validate_crew_member()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles where id = new.technician_id and role = 'tecnico' and is_active) then
    raise exception 'Crew member must be an active technician';
  end if;
  if not exists (select 1 from public.crews where id = new.crew_id and is_active) then
    raise exception 'Crew must be active';
  end if;
  return new;
end;
$$;

create or replace function public.validate_job_assignment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if not public.is_office_staff(auth.uid()) then
      raise exception 'Only active office staff can assign jobs';
    end if;
    new.assigned_by := auth.uid();
    new.assigned_at := now();
  elsif new.assigned_by is distinct from old.assigned_by or new.assigned_at is distinct from old.assigned_at then
    raise exception 'Assignment actor and date are immutable';
  end if;
  if tg_op = 'UPDATE' and (new.job_id is distinct from old.job_id
    or new.assignee_type is distinct from old.assignee_type
    or new.technician_id is distinct from old.technician_id
    or new.crew_id is distinct from old.crew_id) then
    raise exception 'Reassignment must preserve the previous assignment row';
  end if;
  if new.active and new.assignee_type = 'technician' and not exists (
    select 1 from public.profiles where id = new.technician_id and role = 'tecnico' and is_active
  ) then raise exception 'Assignee must be an active technician'; end if;
  if new.active and new.assignee_type = 'crew' and not exists (
    select 1 from public.crews where id = new.crew_id and is_active
  ) then raise exception 'Assignee must be an active crew'; end if;
  return new;
end;
$$;

create or replace function public.validate_job_update()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  status_changed boolean := old.main_status is distinct from new.main_status;
  incident_changed boolean := old.incident is distinct from new.incident;
begin
  if status_changed and incident_changed then raise exception 'Status and incident must be changed separately'; end if;
  if public.is_office_staff(auth.uid()) then
    if status_changed and not (
      (old.main_status = 'asignado' and new.main_status = 'en_progreso')
      or (old.main_status = 'en_progreso' and new.main_status = 'enviado_revision')
      or (old.main_status = 'enviado_revision' and new.main_status in ('aprobado', 'en_progreso'))
      or (old.main_status = 'aprobado' and new.main_status = 'listo_pagar')
      or (old.main_status = 'listo_pagar' and new.main_status = 'pagado')
    ) then raise exception 'Office status transition is not allowed'; end if;
    if old.main_status = 'enviado_revision' and new.main_status = 'en_progreso'
      and nullif(btrim(new.comments), '') is null then
      raise exception 'Returning a job to progress requires a reason';
    end if;
  else
    if not public.is_technician() or not public.can_access_job(old.id) then raise exception 'Job update not authorized'; end if;
    if (to_jsonb(new) - array['main_status','incident','incident_notes','comments','updated_at'])
      is distinct from (to_jsonb(old) - array['main_status','incident','incident_notes','comments','updated_at']) then
      raise exception 'Technicians cannot update office-managed fields';
    end if;
    if status_changed and not ((old.main_status = 'asignado' and new.main_status = 'en_progreso')
      or (old.main_status = 'en_progreso' and new.main_status = 'enviado_revision')) then
      raise exception 'Technician status transition is not allowed';
    end if;
  end if;
  if status_changed and new.main_status = 'enviado_revision' then new.submitted_at := now(); end if;
  if status_changed and new.main_status = 'aprobado' then new.approved_at := now(); end if;
  if status_changed and new.main_status = 'pagado' then new.paid_at := now(); end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.handle_job_change()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if (
    old.main_status is distinct from new.main_status
    or old.incident is distinct from new.incident
  ) then
    if auth.uid() is null then
      raise exception 'A status or incident change requires an authenticated actor';
    end if;
    insert into public.job_status_history (
      job_id,
      previous_status,
      new_status,
      previous_incident,
      new_incident,
      changed_by,
      notes
    ) values (
      new.id,
      old.main_status,
      new.main_status,
      old.incident,
      new.incident,
      auth.uid(),
      case
        when old.incident is distinct from new.incident then new.incident_notes
        else new.comments
      end
    );
  end if;

  return new;
end;
$$;

create trigger validate_crew_lead_before_write before insert or update on public.crews
  for each row execute function public.validate_crew_lead();
create trigger ensure_crew_lead_after_write after insert or update of lead_technician_id on public.crews
  for each row execute function public.ensure_crew_lead_membership();
create trigger validate_crew_member_before_write before insert or update on public.crew_members
  for each row execute function public.validate_crew_member();
create trigger validate_assignment_before_write before insert or update on public.job_assignments
  for each row execute function public.validate_job_assignment();
create trigger validate_job_before_update before update on public.jobs
  for each row execute function public.validate_job_update();
create trigger on_job_updated
  after update on public.jobs
  for each row execute function public.handle_job_change();

-- Buckets de Storage

insert into storage.buckets (id, name, public) values
  ('project-files', 'project-files', false),
  ('job-evidence', 'job-evidence', false)
on conflict (id) do update set public = false;

-- Every object path starts with the related job UUID: <job-id>/<filename>.
create policy "Office staff can manage project files"
on storage.objects for all to authenticated
using (bucket_id = 'project-files' and public.is_office_staff())
with check (bucket_id = 'project-files' and public.is_office_staff());
create policy "Technicians can read assigned project files"
on storage.objects for select to authenticated using (
  bucket_id = 'project-files' and public.is_technician()
  and public.can_access_job(public.job_id_from_storage_path(name))
);
create policy "Office staff can manage job evidence objects"
on storage.objects for all to authenticated
using (bucket_id = 'job-evidence' and public.is_office_staff())
with check (bucket_id = 'job-evidence' and public.is_office_staff());
create policy "Technicians can read assigned evidence objects"
on storage.objects for select to authenticated using (
  bucket_id = 'job-evidence' and public.is_technician()
  and public.can_access_job(public.job_id_from_storage_path(name))
);
create policy "Technicians can upload assigned evidence objects"
on storage.objects for insert to authenticated with check (
  bucket_id = 'job-evidence' and public.is_technician()
  and public.can_access_job(public.job_id_from_storage_path(name))
);
create policy "Technicians can retry assigned evidence uploads"
on storage.objects for update to authenticated
using (bucket_id = 'job-evidence' and public.is_technician()
  and public.can_access_job(public.job_id_from_storage_path(name)))
with check (bucket_id = 'job-evidence' and public.is_technician()
  and public.can_access_job(public.job_id_from_storage_path(name)));
