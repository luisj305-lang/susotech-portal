-- Punto 10: formulario de captación de posibles empleados (landing público).
create table if not exists public.job_applications (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text,
  email text,
  position text,
  experience text,
  message text,
  created_at timestamptz not null default now()
);
