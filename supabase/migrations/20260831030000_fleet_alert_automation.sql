-- Transactional, idempotent in-portal alerts for fleet operations.

alter table public.fleet_insurance_policies
  add column if not exists payment_due_on date;

alter table public.fleet_insurance_policies
  drop constraint if exists fleet_insurance_policies_payment_due_check;
alter table public.fleet_insurance_policies
  add constraint fleet_insurance_policies_payment_due_check check (
    payment_due_on is null or payment_due_on <= expires_on
  );

create index if not exists fleet_insurance_policies_payment_due_idx
  on public.fleet_insurance_policies (payment_due_on, status)
  where payment_due_on is not null and premium_cents > 0;

create or replace function public.fleet_alert_offsets_are_valid(offsets smallint[])
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select cardinality(offsets) between 1 and 10
    and not exists (
      select 1
      from unnest(offsets) as entry(value)
      where value not between 0 and 365
    )
    and cardinality(offsets) = (
      select count(distinct value)
      from unnest(offsets) as entry(value)
    );
$$;

revoke all on function public.fleet_alert_offsets_are_valid(smallint[]) from public;
grant execute on function public.fleet_alert_offsets_are_valid(smallint[]) to authenticated, service_role;

alter table public.fleet_settings
  drop constraint if exists fleet_settings_alert_day_offsets_check;
alter table public.fleet_settings
  add constraint fleet_settings_alert_day_offsets_check
  check (public.fleet_alert_offsets_are_valid(alert_day_offsets));

create or replace function public.generate_fleet_alerts()
returns table (generated_count bigint, skipped_count bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_timezone text;
  v_alert_day_offsets smallint[];
  v_weekly_odometer_day smallint;
  v_weekly_odometer_required boolean;
  v_today date;
  v_week_start date;
  v_week_end date;
  -- A single reminder inside 500 miles is operationally useful without being noisy.
  v_mileage_warning_miles constant bigint := 500;
begin
  if coalesce(auth.role(), '') <> 'service_role'
    and not coalesce(public.is_office_staff(auth.uid()), false) then
    raise exception 'Office authorization required to generate fleet alerts'
      using errcode = '42501';
  end if;

  select
    coalesce((select settings.timezone from public.fleet_settings settings where settings.id = 1), 'America/New_York'),
    coalesce((select settings.alert_day_offsets from public.fleet_settings settings where settings.id = 1), array[30, 14, 7, 0]::smallint[]),
    coalesce((select settings.weekly_odometer_day from public.fleet_settings settings where settings.id = 1), 1::smallint),
    coalesce((select settings.weekly_odometer_required from public.fleet_settings settings where settings.id = 1), false)
  into v_timezone, v_alert_day_offsets, v_weekly_odometer_day, v_weekly_odometer_required;

  v_today := (clock_timestamp() at time zone v_timezone)::date;
  v_week_start := v_today - ((extract(dow from v_today)::integer + 6) % 7);
  v_week_end := v_week_start + 6;

  with office_profiles as (
    select profile.id
    from public.profiles profile
    where profile.role in ('admin', 'supervisor')
      and profile.is_active
  ),
  payment_totals as (
    select payment.policy_id, sum(payment.amount_cents)::bigint as paid_cents
    from public.fleet_insurance_payments payment
    group by payment.policy_id
  ),
  maintenance_dates as (
    select
      maintenance.*,
      case
        when maintenance.status = 'completed' then maintenance.next_due_on
        else coalesce(maintenance.scheduled_for, maintenance.next_due_on)
      end as maintenance_due_on
    from public.fleet_maintenance_records maintenance
    where maintenance.status <> 'cancelled'
  ),
  candidate_notifications (user_id, type, title, body, link, source_key) as (
    select
      profile.id,
      'fleet_insurance_expiration',
      U&'Seguro de cami\00F3n por vencer',
      'Unidad ' || vehicle.unit_number || U&': la p\00F3liza de ' || policy.provider
        || ' vence el ' || policy.expires_on::text || '.',
      '/camiones/' || vehicle.id::text || '?tab=seguro',
      'fleet:insurance-expiration:' || policy.id::text || ':' || policy.expires_on::text
        || ':' || (policy.expires_on - v_today)::text
    from public.fleet_insurance_policies policy
    join public.fleet_vehicles vehicle on vehicle.id = policy.vehicle_id
    cross join office_profiles profile
    where policy.status = 'active'
      and vehicle.status <> 'retired'
      and policy.expires_on - v_today = any(v_alert_day_offsets)

    union all

    select
      profile.id,
      'fleet_insurance_payment',
      'Pago de seguro pendiente',
      'Unidad ' || vehicle.unit_number || ': quedan '
        || (policy.premium_cents - coalesce(payments.paid_cents, 0))::text
        || ' centavos USD por pagar antes del ' || policy.payment_due_on::text || '.',
      '/camiones/' || vehicle.id::text || '?tab=seguro',
      'fleet:insurance-payment:' || policy.id::text || ':' || policy.payment_due_on::text
        || ':' || (policy.payment_due_on - v_today)::text
    from public.fleet_insurance_policies policy
    join public.fleet_vehicles vehicle on vehicle.id = policy.vehicle_id
    left join payment_totals payments on payments.policy_id = policy.id
    cross join office_profiles profile
    where policy.status in ('pending', 'active')
      and vehicle.status <> 'retired'
      and policy.payment_due_on is not null
      and policy.premium_cents > 0
      and coalesce(payments.paid_cents, 0) < policy.premium_cents
      and policy.payment_due_on - v_today = any(v_alert_day_offsets)

    union all

    select
      profile.id,
      'fleet_maintenance_date',
      U&'Mantenimiento de cami\00F3n pr\00F3ximo',
      'Unidad ' || vehicle.unit_number || ': ' || maintenance.service_type
        || ' vence el ' || maintenance.maintenance_due_on::text || '.',
      '/camiones/' || vehicle.id::text || '?tab=mantenimiento',
      'fleet:maintenance-date:' || maintenance.id::text || ':' || maintenance.maintenance_due_on::text
        || ':' || (maintenance.maintenance_due_on - v_today)::text
    from maintenance_dates maintenance
    join public.fleet_vehicles vehicle on vehicle.id = maintenance.vehicle_id
    cross join office_profiles profile
    where vehicle.status <> 'retired'
      and maintenance.maintenance_due_on is not null
      and maintenance.maintenance_due_on - v_today = any(v_alert_day_offsets)

    union all

    select
      profile.id,
      'fleet_maintenance_mileage',
      'Mantenimiento por millaje',
      'Unidad ' || vehicle.unit_number || ': ' || maintenance.service_type
        || ' requiere servicio a las ' || maintenance.next_due_odometer_miles::text || ' mi; millaje actual '
        || vehicle.current_odometer_miles::text || ' mi.',
      '/camiones/' || vehicle.id::text || '?tab=mantenimiento',
      'fleet:maintenance-mileage:' || maintenance.id::text || ':' || maintenance.next_due_odometer_miles::text
    from public.fleet_maintenance_records maintenance
    join public.fleet_vehicles vehicle on vehicle.id = maintenance.vehicle_id
    cross join office_profiles profile
    where maintenance.status <> 'cancelled'
      and vehicle.status <> 'retired'
      and maintenance.next_due_odometer_miles is not null
      and vehicle.current_odometer_miles >= maintenance.next_due_odometer_miles - v_mileage_warning_miles

    union all

    select
      profile.id,
      'fleet_document_expiration',
      U&'Documento de cami\00F3n por vencer',
      'Unidad ' || vehicle.unit_number || ': ' || document.title
        || ' vence el ' || document.expires_on::text || '.',
      '/camiones/' || vehicle.id::text || '?tab=documentos',
      'fleet:document-expiration:' || document.id::text || ':' || document.expires_on::text
        || ':' || (document.expires_on - v_today)::text
    from public.fleet_documents document
    join public.fleet_vehicles vehicle on vehicle.id = document.vehicle_id
    cross join office_profiles profile
    where vehicle.status <> 'retired'
      and document.expires_on is not null
      and document.expires_on - v_today = any(v_alert_day_offsets)

    union all

    select
      profile.id,
      case when v_weekly_odometer_required then 'fleet_weekly_odometer_required' else 'fleet_weekly_odometer' end,
      case when v_weekly_odometer_required then 'Millaje semanal requerido' else 'Recordatorio de millaje semanal' end,
      'Registre el millaje actual de la unidad ' || vehicle.unit_number || U&' desde Mi cami\00F3n.',
      '/camiones/mi-camion',
      'fleet:weekly-odometer:' || assignment.id::text || ':' || v_week_start::text
    from public.fleet_vehicle_assignments assignment
    join public.profiles profile on profile.id = assignment.technician_id
    join public.fleet_vehicles vehicle on vehicle.id = assignment.vehicle_id
    where extract(dow from v_today)::smallint = v_weekly_odometer_day
      and assignment.assignment_role = 'primary'
      and assignment.starts_on <= v_today
      and (assignment.ends_on is null or assignment.ends_on >= v_today)
      and profile.role = 'tecnico'
      and profile.is_active
      and vehicle.status <> 'retired'
      and not exists (
        select 1
        from public.fleet_odometer_readings reading
        where reading.vehicle_id = assignment.vehicle_id
          and reading.submitted_by = assignment.technician_id
          and reading.recorded_on between v_week_start and v_week_end
      )
  ),
  inserted as (
    insert into public.notifications (user_id, type, title, body, link, source_key)
    select candidate.user_id, candidate.type, candidate.title, candidate.body, candidate.link, candidate.source_key
    from candidate_notifications candidate
    on conflict (user_id, source_key) where source_key is not null do nothing
    returning 1
  )
  select
    (select count(*) from inserted),
    (select count(*) from candidate_notifications) - (select count(*) from inserted)
  into generated_count, skipped_count;

  return next;
end;
$$;

revoke all on function public.generate_fleet_alerts() from public;
revoke all on function public.generate_fleet_alerts() from anon;
grant execute on function public.generate_fleet_alerts() to authenticated, service_role;
