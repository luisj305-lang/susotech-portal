# Global Auth Middleware

## Purpose

Proteger las rutas privadas de Susotech Portal y refrescar la sesión de Supabase en cada petición al edge.

## Requirements

### Requirement: Protección de rutas privadas

El middleware SHALL interceptar todas las peticiones a rutas privadas (`/dashboard`, `/usuarios` y subrutas).

- GIVEN un usuario sin sesión que accede a `/dashboard`
- WHEN el middleware procesa la petición
- THEN SHALL redirigir a `/login`

- GIVEN un usuario sin sesión que accede a `/usuarios`
- WHEN el middleware procesa la petición
- THEN SHALL redirigir a `/login`

### Requirement: Refresco de sesión

El middleware SHALL refrescar la cookie de sesión de Supabase cuando el usuario tenga una sesión válida.

- GIVEN un usuario con sesión válida que accede a `/dashboard`
- WHEN el middleware procesa la petición
- THEN SHALL refrescar las cookies y permitir el acceso

### Requirement: Rutas públicas

El middleware SHALL permitir el acceso sin sesión a rutas públicas (`/`, `/login`, `/acceso-denegado`).

- GIVEN un usuario sin sesión que accede a `/login`
- WHEN el middleware procesa la petición
- THEN SHALL permitir la petición sin redirigir
