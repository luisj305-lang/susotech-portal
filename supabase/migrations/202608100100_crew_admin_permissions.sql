-- Solo administradores modifican equipos; supervisores conservan acceso de lectura.

drop policy if exists "Office staff can manage crews" on public.crews;
drop policy if exists "Office staff can view crews" on public.crews;
drop policy if exists "Admins can manage crews" on public.crews;

create policy "Office staff can view crews"
on public.crews for select
to authenticated
using (public.is_office_staff());

create policy "Admins can manage crews"
on public.crews for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Office staff can manage crew members" on public.crew_members;
drop policy if exists "Office staff can view crew members" on public.crew_members;
drop policy if exists "Admins can manage crew members" on public.crew_members;

create policy "Office staff can view crew members"
on public.crew_members for select
to authenticated
using (public.is_office_staff());

create policy "Admins can manage crew members"
on public.crew_members for all
to authenticated
using (public.is_admin())
with check (public.is_admin());
