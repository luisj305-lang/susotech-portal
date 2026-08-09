alter table public.profiles
add column full_name text;

update public.profiles
set full_name = 'Carlos', updated_at = now()
where email = 'carlos@susotech.org';

update public.profiles
set full_name = 'Bryan', role = 'supervisor', updated_at = now()
where email = 'bryan@susotech.org';

update public.profiles
set full_name = 'Kevin', role = 'tecnico', updated_at = now()
where email = 'goofypet@gmail.com';
