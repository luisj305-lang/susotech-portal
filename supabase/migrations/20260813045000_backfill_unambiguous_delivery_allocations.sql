-- Backfill only current submitted legacy deliveries whose immutable production
-- ledger proves one credited worker, matching the recorded delivery actor.
create or replace function public.backfill_unambiguous_delivery_allocations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_count integer;
begin
  perform pg_advisory_xact_lock(hashtext('backfill_unambiguous_delivery_allocations_v1'));

  with candidates as (
    select
      d.id as delivery_id,
      d.job_id,
      d.delivered_by as participant_id,
      count(l.id)::integer as source_line_count,
      (sum(l.amount_snapshot) * 100)::bigint as source_amount_cents,
      d.snapshot_hash,
      coalesce(nullif(btrim(p.full_name), ''), p.email) as participant_name_snapshot,
      p.worker_specialty as worker_specialty_snapshot
    from public.job_deliveries d
    join public.jobs j
      on j.id = d.job_id and j.current_delivery_id = d.id
    join public.job_delivery_production_lines l
      on l.delivery_id = d.id and l.job_id = d.job_id
    join public.profiles p
      on p.id = d.delivered_by
      and p.role = 'tecnico'
      and p.is_active
      and p.worker_specialty in ('tecnico', 'splicer', 'liner', 'ayudante')
    where d.submitted
      and d.superseded_at is null
      and not exists (
        select 1
        from public.job_delivery_allocation_versions existing
        where existing.delivery_id = d.id
      )
    group by d.id, d.job_id, d.delivered_by, d.snapshot_hash,
      p.full_name, p.email, p.worker_specialty
    having count(l.id) > 0
      and count(l.id) filter (where l.amount_snapshot is null) = 0
      and count(distinct l.credited_technician_id) = 1
      and bool_and(l.credited_technician_id = d.delivered_by)
  ), inserted_versions as (
    insert into public.job_delivery_allocation_versions (
      delivery_id, job_id, version, source_amount_cents, source_line_count,
      source_snapshot_hash, request_payload, idempotency_key, reason, created_by
    )
    select
      c.delivery_id,
      c.job_id,
      1,
      c.source_amount_cents,
      c.source_line_count,
      c.snapshot_hash,
      jsonb_build_array(jsonb_build_object(
        'participantId', c.participant_id,
        'percentageBasisPoints', 10000
      )),
      md5('unambiguous-delivery-allocation-backfill-v1:' || c.delivery_id::text)::uuid,
      'Unambiguous legacy delivery backfill',
      c.participant_id
    from candidates c
    on conflict do nothing
    returning id, delivery_id
  )
  insert into public.job_delivery_financial_allocations (
    allocation_version_id, participant_id, participant_name_snapshot,
    worker_specialty_snapshot, percentage_basis_points, allocated_cents,
    allocation_order
  )
  select
    inserted.id,
    c.participant_id,
    c.participant_name_snapshot,
    c.worker_specialty_snapshot,
    10000,
    c.source_amount_cents,
    1
  from inserted_versions inserted
  join candidates c on c.delivery_id = inserted.delivery_id;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

revoke all on function public.backfill_unambiguous_delivery_allocations() from public;
revoke all on function public.backfill_unambiguous_delivery_allocations() from authenticated;
grant execute on function public.backfill_unambiguous_delivery_allocations() to service_role;

select public.backfill_unambiguous_delivery_allocations();
