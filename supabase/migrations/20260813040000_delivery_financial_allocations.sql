-- Immutable, versioned financial distribution for the definitive current delivery.
-- Money is stored and apportioned as integer cents; percentages are basis points.

create table public.job_delivery_allocation_versions (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.job_deliveries(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  version integer not null check (version > 0),
  source_amount_cents bigint not null check (source_amount_cents >= 0),
  source_line_count integer not null check (source_line_count > 0),
  source_snapshot_hash text,
  request_payload jsonb not null check (jsonb_typeof(request_payload) = 'array'),
  idempotency_key uuid not null,
  reason text check (reason is null or char_length(reason) <= 1000),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default clock_timestamp(),
  replaces_version_id uuid references public.job_delivery_allocation_versions(id),
  superseded_at timestamptz,
  superseded_by uuid references public.profiles(id),
  voided_at timestamptz,
  voided_by uuid references public.profiles(id),
  void_reason text check (void_reason is null or char_length(void_reason) <= 1000),
  unique (delivery_id, version),
  unique (delivery_id, idempotency_key),
  check ((superseded_at is null) = (superseded_by is null)),
  check ((voided_at is null) = (voided_by is null))
);

create unique index job_delivery_allocation_one_current_idx
  on public.job_delivery_allocation_versions(delivery_id)
  where superseded_at is null and voided_at is null;

create table public.job_delivery_financial_allocations (
  id uuid primary key default gen_random_uuid(),
  allocation_version_id uuid not null references public.job_delivery_allocation_versions(id) on delete cascade,
  participant_id uuid not null references public.profiles(id) on delete restrict,
  participant_name_snapshot text not null,
  worker_specialty_snapshot text not null check (
    worker_specialty_snapshot in ('tecnico', 'splicer', 'liner', 'ayudante')
  ),
  percentage_basis_points integer not null check (percentage_basis_points between 1 and 10000),
  allocated_cents bigint not null check (allocated_cents >= 0),
  allocation_order integer not null check (allocation_order > 0),
  created_at timestamptz not null default clock_timestamp(),
  unique (allocation_version_id, participant_id),
  unique (allocation_version_id, allocation_order)
);

create index job_delivery_financial_participant_idx
  on public.job_delivery_financial_allocations(participant_id, allocation_version_id);

alter table public.job_delivery_allocation_versions enable row level security;
alter table public.job_delivery_financial_allocations enable row level security;

create policy "Office staff view allocation versions"
on public.job_delivery_allocation_versions for select to authenticated
using (public.is_office_staff());

create policy "Participants view own allocation versions"
on public.job_delivery_allocation_versions for select to authenticated
using (exists (
  select 1 from public.job_delivery_financial_allocations a
  where a.allocation_version_id = id and a.participant_id = auth.uid()
));

create policy "Office staff view financial allocations"
on public.job_delivery_financial_allocations for select to authenticated
using (public.is_office_staff());

create policy "Participants view own financial allocations"
on public.job_delivery_financial_allocations for select to authenticated
using (participant_id = auth.uid());

grant select on public.job_delivery_allocation_versions to authenticated;
grant select on public.job_delivery_financial_allocations to authenticated;
revoke insert, update, delete on public.job_delivery_allocation_versions from authenticated;
revoke insert, update, delete on public.job_delivery_financial_allocations from authenticated;

create or replace function public.create_delivery_allocation_version_internal(
  p_delivery_id uuid,
  p_expected_version integer,
  p_allocations jsonb,
  p_idempotency_key uuid,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  selected_delivery public.job_deliveries%rowtype;
  selected_job public.jobs%rowtype;
  current_version public.job_delivery_allocation_versions%rowtype;
  existing_version public.job_delivery_allocation_versions%rowtype;
  canonical_payload jsonb;
  total_cents bigint;
  line_count integer;
  null_amount_count integer;
  next_version integer;
  result_id uuid;
  clean_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if actor is null or not public.is_operational_worker(actor) then
    raise exception 'Operational worker required';
  end if;
  if p_idempotency_key is null then raise exception 'Idempotency key required'; end if;
  if jsonb_typeof(p_allocations) <> 'array'
    or jsonb_array_length(p_allocations) not between 1 and 100
  then raise exception 'One to 100 allocations are required'; end if;
  if clean_reason is not null and char_length(clean_reason) > 1000 then
    raise exception 'Allocation reason is too long';
  end if;

  create temporary table if not exists requested_delivery_allocations (
    participant_id uuid primary key,
    percentage_basis_points integer not null,
    allocation_order integer not null unique
  ) on commit drop;
  truncate table pg_temp.requested_delivery_allocations;

  begin
    insert into pg_temp.requested_delivery_allocations(
      participant_id, percentage_basis_points, allocation_order
    )
    select (item ->> 'participantId')::uuid,
      (item ->> 'percentageBasisPoints')::integer,
      ordinality::integer
    from jsonb_array_elements(p_allocations) with ordinality supplied(item, ordinality)
    where (item ->> 'percentageBasisPoints') ~ '^[0-9]+$';
  exception when unique_violation or invalid_text_representation or numeric_value_out_of_range then
    raise exception 'Allocations contain invalid or duplicate participants';
  end;

  if (select count(*) from pg_temp.requested_delivery_allocations) <> jsonb_array_length(p_allocations)
    or exists (select 1 from pg_temp.requested_delivery_allocations where percentage_basis_points not between 1 and 10000)
    or (select sum(percentage_basis_points) from pg_temp.requested_delivery_allocations) <> 10000
  then raise exception 'Allocation percentages must be positive and total exactly 100.00'; end if;

  if exists (
    select 1 from pg_temp.requested_delivery_allocations requested
    left join public.profiles p on p.id = requested.participant_id
      and p.role = 'tecnico' and p.is_active
      and p.worker_specialty in ('tecnico', 'splicer', 'liner', 'ayudante')
    where p.id is null
  ) then raise exception 'Every participant must be an active field worker'; end if;

  select * into selected_delivery from public.job_deliveries where id = p_delivery_id for update;
  if selected_delivery.id is null or not selected_delivery.submitted or selected_delivery.superseded_at is not null
    or selected_delivery.delivered_by is distinct from actor
  then raise exception 'Current submitted delivery unavailable'; end if;
  select * into selected_job from public.jobs where id = selected_delivery.job_id for update;
  if selected_job.current_delivery_id is distinct from selected_delivery.id then
    raise exception 'Financial allocation requires the current delivery';
  end if;

  select count(*)::integer,
    count(*) filter (where amount_snapshot is null)::integer,
    (sum(amount_snapshot) * 100)::bigint
  into line_count, null_amount_count, total_cents
  from public.job_delivery_production_lines
  where delivery_id = selected_delivery.id;
  if line_count = 0 or null_amount_count <> 0 or total_cents is null then
    raise exception 'Every delivered production line requires a server price snapshot';
  end if;

  select jsonb_agg(jsonb_build_object(
    'participantId', participant_id,
    'percentageBasisPoints', percentage_basis_points
  ) order by participant_id) into canonical_payload
  from pg_temp.requested_delivery_allocations;

  select * into existing_version
  from public.job_delivery_allocation_versions
  where delivery_id = selected_delivery.id and idempotency_key = p_idempotency_key;
  if existing_version.id is not null then
    if existing_version.request_payload is distinct from canonical_payload
      or existing_version.source_amount_cents <> total_cents
    then raise exception 'Idempotency key was already used with different allocation data'; end if;
    return existing_version.id;
  end if;

  select * into current_version
  from public.job_delivery_allocation_versions
  where delivery_id = selected_delivery.id and superseded_at is null and voided_at is null
  for update;
  if coalesce(current_version.version, 0) <> coalesce(p_expected_version, 0) then
    raise exception 'Allocation version conflict';
  end if;

  select coalesce(max(version), 0) + 1 into next_version
  from public.job_delivery_allocation_versions where delivery_id = selected_delivery.id;
  perform set_config('app.financial_allocation_mutation', actor::text, true);
  if current_version.id is not null then
    update public.job_delivery_allocation_versions
    set superseded_at = clock_timestamp(), superseded_by = actor
    where id = current_version.id;
  end if;

  insert into public.job_delivery_allocation_versions(
    delivery_id, job_id, version, source_amount_cents, source_line_count,
    source_snapshot_hash, request_payload, idempotency_key, reason,
    created_by, replaces_version_id
  ) values (
    selected_delivery.id, selected_delivery.job_id, next_version, total_cents,
    line_count, selected_delivery.snapshot_hash, canonical_payload,
    p_idempotency_key, clean_reason, actor, current_version.id
  ) returning id into result_id;

  with shares as (
    select requested.*,
      floor((total_cents::numeric * percentage_basis_points) / 10000)::bigint as base_cents,
      mod(total_cents::numeric * percentage_basis_points, 10000) as remainder
    from pg_temp.requested_delivery_allocations requested
  ), ranked as (
    select shares.*,
      row_number() over (order by remainder desc, allocation_order, participant_id) as remainder_rank,
      total_cents - sum(base_cents) over () as cents_left
    from shares
  )
  insert into public.job_delivery_financial_allocations(
    allocation_version_id, participant_id, participant_name_snapshot,
    worker_specialty_snapshot, percentage_basis_points, allocated_cents, allocation_order
  )
  select result_id, ranked.participant_id,
    coalesce(nullif(btrim(p.full_name), ''), p.email), p.worker_specialty,
    ranked.percentage_basis_points,
    ranked.base_cents + case when ranked.remainder_rank <= ranked.cents_left then 1 else 0 end,
    ranked.allocation_order
  from ranked join public.profiles p on p.id = ranked.participant_id;

  if (select sum(allocated_cents) from public.job_delivery_financial_allocations where allocation_version_id = result_id) <> total_cents
    or (select sum(percentage_basis_points) from public.job_delivery_financial_allocations where allocation_version_id = result_id) <> 10000
  then raise exception 'Financial allocation invariant failed'; end if;
  return result_id;
end;
$$;

create or replace function public.replace_delivery_financial_allocation(
  p_delivery_id uuid,
  p_expected_version integer,
  p_allocations jsonb,
  p_idempotency_key uuid,
  p_reason text default null
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select public.create_delivery_allocation_version_internal(
    p_delivery_id, p_expected_version, p_allocations, p_idempotency_key, p_reason
  );
$$;

create or replace function public.void_current_delivery_allocation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.superseded_at is null and new.superseded_at is not null then
    perform set_config('app.financial_allocation_mutation', coalesce(auth.uid()::text, 'system'), true);
    update public.job_delivery_allocation_versions
    set voided_at = new.superseded_at,
        voided_by = coalesce(auth.uid(), created_by),
        void_reason = 'Delivery superseded'
    where delivery_id = new.id and superseded_at is null and voided_at is null;
  end if;
  return new;
end;
$$;

create trigger void_allocation_after_delivery_superseded
after update of superseded_at on public.job_deliveries
for each row execute function public.void_current_delivery_allocation();

alter function public.confirm_delivered_job_pdf_complete(uuid, text, uuid[], uuid[], boolean, integer, text)
  rename to confirm_delivered_job_pdf_complete_before_allocations;
revoke all on function public.confirm_delivered_job_pdf_complete_before_allocations(uuid, text, uuid[], uuid[], boolean, integer, text) from public;
revoke all on function public.confirm_delivered_job_pdf_complete_before_allocations(uuid, text, uuid[], uuid[], boolean, integer, text) from authenticated;

create function public.confirm_delivered_job_pdf_with_allocations(
  p_job_id uuid, p_storage_path text, p_source_photo_ids uuid[],
  p_source_document_ids uuid[], p_submit boolean,
  p_expected_draft_version integer, p_snapshot_hash text,
  p_allocations jsonb, p_allocation_idempotency_key uuid
)
returns table(previous_storage_path text, delivered_status public.job_status, delivery_id uuid, allocation_version_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  confirmed record;
  existing public.job_deliveries%rowtype;
  previous_path text;
  allocation_id uuid;
begin
  if not public.can_mutate_job(p_job_id, actor) or not public.is_operational_worker(actor) then
    raise exception 'Job unavailable';
  end if;
  if p_submit and (p_allocation_idempotency_key is null or jsonb_typeof(p_allocations) <> 'array') then
    raise exception 'A valid financial allocation is required for delivery';
  end if;

  select * into existing from public.job_deliveries where storage_path = p_storage_path;
  if existing.id is not null then
    if not p_submit or not existing.submitted or existing.superseded_at is not null
      or existing.job_id <> p_job_id or existing.delivered_by is distinct from actor
    then raise exception 'Delivery idempotency conflict'; end if;
    select d.storage_path into previous_path from public.job_deliveries d where d.id = existing.replaces_delivery_id;
    allocation_id := public.create_delivery_allocation_version_internal(
      existing.id, 0, p_allocations, p_allocation_idempotency_key, 'Initial delivery allocation'
    );
    return query select previous_path, 'enviado_revision'::public.job_status, existing.id, allocation_id;
    return;
  end if;

  select * into confirmed from public.confirm_delivered_job_pdf_complete_before_allocations(
    p_job_id, p_storage_path, p_source_photo_ids, p_source_document_ids,
    p_submit, p_expected_draft_version, p_snapshot_hash
  );
  if p_submit then
    allocation_id := public.create_delivery_allocation_version_internal(
      confirmed.delivery_id, 0, p_allocations, p_allocation_idempotency_key,
      'Initial delivery allocation'
    );
  end if;
  return query select confirmed.previous_storage_path, confirmed.delivered_status,
    confirmed.delivery_id, allocation_id;
end;
$$;

create function public.confirm_delivered_job_pdf_complete(
  p_job_id uuid, p_storage_path text, p_source_photo_ids uuid[],
  p_source_document_ids uuid[], p_submit boolean,
  p_expected_draft_version integer, p_snapshot_hash text
)
returns table(previous_storage_path text, delivered_status public.job_status, delivery_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  select confirmed.previous_storage_path, confirmed.delivered_status, confirmed.delivery_id
  from public.confirm_delivered_job_pdf_with_allocations(
    p_job_id, p_storage_path, p_source_photo_ids, p_source_document_ids,
    p_submit, p_expected_draft_version, p_snapshot_hash,
    case when p_submit then jsonb_build_array(jsonb_build_object(
      'participantId', auth.uid(), 'percentageBasisPoints', 10000
    )) else '[]'::jsonb end,
    case when p_submit then md5(p_storage_path)::uuid else gen_random_uuid() end
  ) confirmed;
end;
$$;

revoke all on function public.create_delivery_allocation_version_internal(uuid, integer, jsonb, uuid, text) from public;
revoke all on function public.create_delivery_allocation_version_internal(uuid, integer, jsonb, uuid, text) from authenticated;
revoke all on function public.void_current_delivery_allocation() from public;
revoke all on function public.replace_delivery_financial_allocation(uuid, integer, jsonb, uuid, text) from public;
revoke all on function public.confirm_delivered_job_pdf_with_allocations(uuid, text, uuid[], uuid[], boolean, integer, text, jsonb, uuid) from public;
revoke all on function public.confirm_delivered_job_pdf_complete(uuid, text, uuid[], uuid[], boolean, integer, text) from public;
grant execute on function public.replace_delivery_financial_allocation(uuid, integer, jsonb, uuid, text) to authenticated;
grant execute on function public.confirm_delivered_job_pdf_with_allocations(uuid, text, uuid[], uuid[], boolean, integer, text, jsonb, uuid) to authenticated;
grant execute on function public.confirm_delivered_job_pdf_complete(uuid, text, uuid[], uuid[], boolean, integer, text) to authenticated;
