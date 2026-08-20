-- Punto 2: el título del trabajo deja de ser obligatorio (se quita de todo el portal).
alter table public.jobs alter column title drop not null;
