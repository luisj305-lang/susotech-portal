-- Extend the established office viewer predicate to immutable engine-hour history.
create policy "Office viewers view fleet engine hours"
on public.fleet_engine_hour_readings for select to authenticated
using (public.is_office_viewer());
