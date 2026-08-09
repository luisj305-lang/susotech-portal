# Password Recovery Flow

## Purpose

Permitir que los usuarios recuperen el acceso a Susotech Portal mediante restablecimiento de contraseña por correo electrónico.

## Requirements

### Requirement: Enlace de recuperación

La pantalla de inicio de sesión SHALL mostrar un enlace para iniciar la recuperación de contraseña.

- GIVEN un usuario en `/login`
- WHEN carga la página
- THEN SHALL ver un enlace "¿Olvidaste tu contraseña?"

### Requirement: Solicitud de correo

El sistema SHALL enviar un correo de recuperación cuando el usuario proporcione una dirección válida.

- GIVEN un usuario que ingresa `correo@ejemplo.com` en el formulario de recuperación
- WHEN envía la solicitud
- THEN SHALL llamar a `supabase.auth.resetPasswordForEmail` y mostrar un mensaje de confirmación

### Requirement: Validación de formato

El formulario de recuperación SHALL validar que el correo tenga formato válido antes de enviar.

- GIVEN un usuario que ingresa `no-es-correo` en el formulario
- WHEN intenta enviar
- THEN SHALL mostrar un mensaje de error de validación sin llamar a Supabase

### Requirement: Página de restablecimiento

El sistema SHALL permitir establecer una nueva contraseña cuando el usuario acceda con un token de recuperación válido.

- GIVEN un usuario que accede al enlace de recuperación con token válido
- WHEN envía una nueva contraseña que cumple los requisitos
- THEN SHALL actualizar la contraseña y redirigir a `/login`
