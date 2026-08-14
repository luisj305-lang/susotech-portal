-- Keep allocation creation statically analyzable and concurrency-safe without
-- session-local relation state.
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
  requested_participant_ids uuid[];
  requested_basis_points integer[];
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

  begin
    select
      array_agg((item ->> 'participantId')::uuid order by ordinality),
      array_agg((item ->> 'percentageBasisPoints')::integer order by ordinality)
    into requested_participant_ids, requested_basis_points
    from jsonb_array_elements(p_allocations) with ordinality supplied(item, ordinality)
    where (item ->> 'percentageBasisPoints') ~ '^[0-9]+$';
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'Allocations contain invalid or duplicate participants';
  end;

  if coalesce(cardinality(requested_participant_ids), 0) <> jsonb_array_length(p_allocations)
    or exists (
      select 1 from unnest(requested_participant_ids, requested_basis_points)
        requested(participant_id, percentage_basis_points)
      where participant_id is null or percentage_basis_points not between 1 and 10000
    )
    or (select count(distinct participant_id) from unnest(requested_participant_ids) requested(participant_id))
      <> cardinality(requested_participant_ids)
    or (select sum(percentage_basis_points) from unnest(requested_basis_points) requested(percentage_basis_points)) <> 10000
  then raise exception 'Allocation percentages must be positive and total exactly 100.00'; end if;

  if exists (
    select 1
    from unnest(requested_participant_ids) requested(participant_id)
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
  ) order by participant_id)
  into canonical_payload
  from unnest(requested_participant_ids, requested_basis_points)
    requested(participant_id, percentage_basis_points);

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

  with requested as (
    select participant_id, percentage_basis_points, allocation_order::integer
    from unnest(requested_participant_ids, requested_basis_points) with ordinality
      supplied(participant_id, percentage_basis_points, allocation_order)
  ), shares as (
    select requested.*,
      floor((total_cents::numeric * percentage_basis_points) / 10000)::bigint as base_cents,
      mod(total_cents::numeric * percentage_basis_points, 10000) as remainder
    from requested
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

revoke all on function public.create_delivery_allocation_version_internal(uuid, integer, jsonb, uuid, text) from public;
revoke all on function public.create_delivery_allocation_version_internal(uuid, integer, jsonb, uuid, text) from authenticated;
