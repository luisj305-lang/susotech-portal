# Profile RLS Hardening

## Purpose

Asegurar que el acceso a la tabla `profiles` esté restringido por identidad, rol y estado activo.

## Requirements

### Requirement: Lectura propia

Un usuario autenticado SHALL leer únicamente su propio perfil.

- GIVEN un usuario autenticado con `id = A`
- WHEN selecciona filas de `profiles`
- THEN SHALL recibir únicamente la fila donde `id = A`

### Requirement: Lectura administrativa

Un usuario `admin` activo SHALL poder leer todos los perfiles.

- GIVEN un usuario `admin` activo
- WHEN selecciona filas de `profiles`
- THEN SHALL recibir todos los perfiles

### Requirement: Actualización administrativa

Un usuario `admin` activo SHALL poder actualizar roles y estado de otros perfiles.

- GIVEN un usuario `admin` activo
- WHEN actualiza el rol de otro perfil
- THEN SHALL persistir el cambio

### Requirement: Usuarios inactivos

Un usuario inactivo SHALL NOT realizar operaciones de lectura ni escritura en `profiles`.

- GIVEN un usuario autenticado con `is_active = false`
- WHEN intenta leer su propio perfil
- THEN SHALL recibir cero filas
