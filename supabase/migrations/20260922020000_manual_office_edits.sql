-- Atomic corrections for feature-era records only. Preserve all legacy data.
begin;

create table public.manual_job_edits (
  id uuid primary key default gen_random_uuid(),
  manual_job_id uuid not null references public.manual_jobs(id) on delete restrict,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  edited_at timestamptz not null default clock_timestamp(),
  from_revision integer not null,
  to_revision integer not null,
  before_snapshot jsonb not null,
  after_snapshot jsonb not null,
  unique (manual_job_id, to_revision),
  check (to_revision = from_revision + 1)
);
alter table public.manual_job_edits enable row level security;
revoke all on public.manual_job_edits from public, anon, authenticated, service_role;
grant select on public.manual_job_edits to authenticated;
create policy manual_job_edits_office_read on public.manual_job_edits
  for select to authenticated using (public.is_office_viewer(auth.uid()));

create function public.update_manual_job(
  p_manual_job_id uuid, p_expected_revision integer,
  p_prism_number text, p_value_cents bigint, p_workers jsonb,
  p_description text, p_work_date date, p_financial_week date
)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  previous public.manual_jobs%rowtype;
  changed public.manual_jobs%rowtype;
  before_workers jsonb;
  after_workers jsonb;
  first_week date;
begin
  if not public.is_office_staff(auth.uid()) then raise exception 'Office access required'; end if;
  select * into previous from public.manual_jobs where id = p_manual_job_id for update;
  if not found then raise exception 'Manual job unavailable'; end if;
  if previous.revision is null or previous.financial_week_start is null then
    raise exception 'Legacy manual jobs cannot be edited';
  end if;
  select a.first_financial_week into strict first_week from public.manual_job_feature_activation a;
  if previous.financial_week_start < first_week then raise exception 'Historical financial period is protected'; end if;
  if p_expected_revision is null or previous.revision <> p_expected_revision then
    raise exception 'Manual job changed; reload before editing';
  end if;
  if nullif(btrim(p_description), '') is null then raise exception 'Description required'; end if;
  perform public.validate_manual_job_input(p_prism_number, p_value_cents, p_workers,
    p_description, p_work_date, p_financial_week);
  select coalesce(jsonb_agg(to_jsonb(w) order by w.technician_id, w.id), '[]'::jsonb)
    into before_workers from public.manual_job_workers w where w.manual_job_id = previous.id;

  -- Never set status, created_at, reviewed_by, reviewed_at or rejection_reason.
  update public.manual_jobs set prism_number = upper(btrim(p_prism_number)),
    value_cents = p_value_cents, description = btrim(p_description), work_date = p_work_date,
    financial_week_start = p_financial_week, revision = revision + 1,
    pdf_path = null, updated_at = clock_timestamp()
  where id = previous.id returning * into changed;
  delete from public.manual_job_workers where manual_job_id = previous.id;
  insert into public.manual_job_workers (manual_job_id, technician_id, percentage_basis_points)
  select previous.id, (w->>'technicianId')::uuid, (w->>'percentageBasisPoints')::integer
  from jsonb_array_elements(p_workers) w;
  select jsonb_agg(to_jsonb(w) order by w.technician_id, w.id)
    into after_workers from public.manual_job_workers w where w.manual_job_id = previous.id;
  insert into public.manual_job_edits (
    manual_job_id, actor_id, from_revision, to_revision, before_snapshot, after_snapshot
  ) values (previous.id, auth.uid(), previous.revision, changed.revision,
    to_jsonb(previous) || jsonb_build_object('workers', before_workers),
    to_jsonb(changed) || jsonb_build_object('workers', after_workers));
  return changed.revision;
end;
$$;

-- Preserve legacy review semantics, but never rewrite a new approval's identity
-- on retries or use review as an implicit unapproval path after corrections.
create or replace function public.review_manual_job(p_manual_job_id uuid, p_approve boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare previous public.manual_jobs%rowtype;
begin
  if not public.is_office_staff(auth.uid()) then raise exception 'Office access required'; end if;
  select * into previous from public.manual_jobs where id = p_manual_job_id for update;
  if not found then raise exception 'Manual job unavailable'; end if;
  if previous.revision is not null then
    if p_approve is null then raise exception 'Review decision required'; end if;
    if previous.status = 'approved' then
      if p_approve then return; end if;
      raise exception 'Approved manual jobs cannot be rejected through review';
    end if;
  end if;
  update public.manual_jobs set status = case when p_approve then 'approved' else 'rejected' end,
    reviewed_by = auth.uid(), reviewed_at = clock_timestamp(),
    rejection_reason = case when p_approve then null else nullif(btrim(coalesce(p_reason, '')), '') end,
    updated_at = clock_timestamp()
  where id = previous.id;
end;
$$;

-- An upload racing an edit can never reattach an obsolete receipt. Storage keys
-- are revision-specific; the legacy setter is rejected for feature-era records.
create function public.set_manual_job_pdf_path_v2(p_manual_job_id uuid, p_expected_revision integer, p_pdf_path text)
returns void language plpgsql security definer set search_path = '' as $$
declare current_job public.manual_jobs%rowtype;
begin
  select * into current_job from public.manual_jobs where id = p_manual_job_id for update;
  if not found then raise exception 'Manual job unavailable'; end if;
  if not (public.is_office_staff(auth.uid()) or
    (current_job.created_by = auth.uid() and public.is_field_worker(auth.uid()))) then
    raise exception 'Manual job unavailable';
  end if;
  if current_job.revision is null or p_expected_revision is null or current_job.revision <> p_expected_revision then
    raise exception 'Manual job changed; receipt is obsolete';
  end if;
  if p_pdf_path is distinct from ('manual-jobs/' || current_job.id || '/revision-' || current_job.revision || '.pdf') then
    raise exception 'Invalid manual receipt path';
  end if;
  update public.manual_jobs set pdf_path = p_pdf_path, updated_at = clock_timestamp() where id = current_job.id;
end;
$$;

create or replace function public.set_manual_job_pdf_path(p_manual_job_id uuid, p_pdf_path text)
returns void language plpgsql security definer set search_path = '' as $$
declare current_job public.manual_jobs%rowtype;
begin
  select * into current_job from public.manual_jobs where id = p_manual_job_id for update;
  if not found then raise exception 'Manual job unavailable'; end if;
  if not exists (select 1 from public.manual_jobs mj where mj.id = p_manual_job_id and mj.created_by = auth.uid())
     and not public.is_office_staff(auth.uid()) then raise exception 'Manual job unavailable'; end if;
  if current_job.revision is not null then raise exception 'Versioned receipt required'; end if;
  update public.manual_jobs set pdf_path = p_pdf_path, updated_at = clock_timestamp() where id = current_job.id;
end;
$$;

revoke all on function public.update_manual_job(uuid, integer, text, bigint, jsonb, text, date, date) from public, anon, authenticated, service_role;
revoke all on function public.set_manual_job_pdf_path_v2(uuid, integer, text) from public, anon, authenticated, service_role;
grant execute on function public.update_manual_job(uuid, integer, text, bigint, jsonb, text, date, date) to authenticated;
grant execute on function public.set_manual_job_pdf_path_v2(uuid, integer, text) to authenticated;

commit;
