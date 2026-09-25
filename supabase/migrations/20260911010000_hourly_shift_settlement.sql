-- Automatic midnight settlement of unclosed hourly shifts (Work Unit 3 of the
-- hourly payroll plan).
--
-- This migration is additive only: it creates a single service-role-only
-- function and never drops a column, table, or existing constraint. The
-- existing `close_my_hourly_shift` self-close path and
-- `refresh_hourly_pay_period` helper are left untouched.
--
-- A protected cron route invokes this function every 15 minutes. It settles any
-- hourly shift whose settlement deadline has passed and that the technician did
-- not close themselves. Settlement is deterministic: `settled_at` is pinned to
-- the stored ET-midnight deadline and `payable_minutes` is a flat 4 hours, so
-- re-running the cron is idempotent (unsettled rows whose deadline has not yet
-- passed are never touched).

-- ---------------------------------------------------------------------------
-- A. settle_due_hourly_shifts
--    Service-role-only sweep that auto-settles overdue open hourly shifts at a
--    flat 4 hours and refreshes each affected Friday–Thursday pay period.
-- ---------------------------------------------------------------------------
create or replace function public.settle_due_hourly_shifts()
returns table (settled_count bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count bigint := 0;
  v_shift record;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required'
      using errcode = '42501';
  end if;

  for v_shift in
    select s.id, s.technician_id, s.work_date, s.settlement_due_at, s.hourly_rate_cents
    from public.technician_shifts s
    where s.compensation_mode = 'hourly'
      and s.settled_at is null
      and s.settlement_due_at <= now()
    order by s.started_at
    for update
  loop
    update public.technician_shifts s
    set settled_at = v_shift.settlement_due_at,
        settlement_kind = 'auto',
        payable_minutes = 240,
        payable_cents = 4 * v_shift.hourly_rate_cents,
        updated_at = now()
    where s.id = v_shift.id;

    perform public.refresh_hourly_pay_period(v_shift.technician_id, v_shift.work_date);

    v_count := v_count + 1;
  end loop;

  settled_count := v_count;
  return next;
end;
$$;

comment on function public.settle_due_hourly_shifts() is
  'Auto-settles overdue open hourly shifts at a flat 4 hours, pinning settled_at to the stored ET-midnight deadline, and refreshes each affected Friday–Thursday pay period. Service role only; idempotent.';

-- ---------------------------------------------------------------------------
-- B. Grants
--    Service role only: revoked from public and authenticated.
-- ---------------------------------------------------------------------------
revoke all on function public.settle_due_hourly_shifts() from public;
revoke all on function public.settle_due_hourly_shifts() from authenticated;

grant execute on function public.settle_due_hourly_shifts() to service_role;
