-- Active supervisors may inspect reminders, but connection secrets and all
-- reminder mutations remain admin-only.

create policy "Active supervisors can view calendar reminders"
on public.calendar_reminders
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'supervisor'
      and p.is_active
  )
);

