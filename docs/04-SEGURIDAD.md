# 04 — Seguridad

## Modelo de confianza

El navegador se considera un entorno no confiable. Ocultar un botón no autoriza una operación. La seguridad se aplicará en RLS, funciones de servidor y restricciones de base de datos.

## Identidad

- Supabase Auth administra credenciales y sesión.
- `auth.uid()` identifica al usuario ante PostgreSQL.
- `profiles.id` referencia el UUID de `auth.users`.
- Un usuario inactivo no debe conservar acceso funcional aunque su sesión siga vigente.
- Las operaciones administrativas requieren verificación explícita de rol.

## Matriz inicial de acceso

| Recurso | Admin | Oficina | Técnico | Revisor | Producción |
|---|---|---|---|---|---|
| Usuarios y roles | Administrar | Lectura limitada | Propio perfil | Propio perfil | Propio perfil |
| Trabajos | Todo | Crear/editar | Asignados | En revisión | Aprobados |
| Asignaciones | Todo | Administrar | Leer propias | Leer | Leer |
| Evidencias | Todo | Leer/subir | Subir asignados | Leer | Leer autorizadas |
| Tarifas técnicas | Todo | Según política | No | Según política | Autorizado |
| Tarifas cliente | Todo | Autorizado | No | No | Autorizado |
| Aprobación | Todo | No por defecto | No | Sí | Lectura |

La matriz debe validarse con el propietario del proceso antes de cerrar las políticas.

## Políticas RLS

Cada tabla debe responder estas preguntas:

1. ¿Quién puede leer una fila?
2. ¿Quién puede insertarla?
3. ¿Quién puede actualizarla y qué condición debe mantenerse?
4. ¿Quién puede eliminarla, si alguien?

Patrones:

- Perfil propio: `id = auth.uid()`.
- Trabajo asignado: existencia de asignación activa para `auth.uid()`.
- Rol autorizado: función SQL estable que comprueba `user_roles`.
- Archivos: acceso heredado del trabajo relacionado.

Evitar políticas recursivas o funciones que permitan elevar privilegios accidentalmente.

## Claves y variables

- La clave anónima pública puede usarse en navegador junto con RLS.
- La clave `service_role` nunca se incluye en código cliente.
- Los secretos no se registran, imprimen ni incluyen en mensajes de error.
- `.env.local` permanece ignorado por Git.
- Producción utiliza secretos gestionados por la plataforma.

## Storage

- Buckets privados.
- Rutas con UUID generado por el sistema.
- Validación de extensión, MIME y tamaño.
- URLs firmadas de corta duración.
- Autorización basada en la relación con `job_id`.
- Metadatos en `job_files` para auditoría y clasificación.
- Si se aceptan formatos riesgosos, incorporar análisis antimalware antes de producción.

## Seguridad de aplicación

- Validar entradas en servidor.
- Escapar contenido mostrado y evitar HTML arbitrario.
- No formar consultas SQL concatenando entradas.
- Proteger acciones contra solicitudes no autorizadas.
- Usar mensajes de error que no revelen esquema, claves ni datos de otros usuarios.
- Limitar frecuencia de acciones sensibles cuando exista riesgo de abuso.

## Privacidad y registros

- Recopilar solo datos necesarios.
- No registrar tokens, contraseñas, documentos completos ni datos personales innecesarios.
- Restringir logs por ambiente.
- Definir conservación de archivos y auditoría.
- Documentar exportación o eliminación de datos cuando sea requerida.

## Pruebas obligatorias

Por cada política importante debe existir al menos:

- Un caso permitido.
- Un caso denegado por falta de rol.
- Un caso denegado por no pertenecer al trabajo.
- Un caso con usuario inactivo o sin sesión.
- Un caso que intente modificar campos protegidos.

## Respuesta a incidentes

1. Revocar o rotar credenciales comprometidas.
2. Restringir temporalmente la función afectada.
3. Conservar evidencia y determinar alcance.
4. Corregir la causa y añadir una prueba de regresión.
5. Restaurar con verificación y documentar el incidente.

## Checklist previo a producción

- [ ] RLS activa en todas las tablas expuestas.
- [ ] Políticas revisadas con usuarios de cada rol.
- [ ] Buckets privados y políticas verificadas.
- [ ] Ningún secreto en Git o bundle del navegador.
- [ ] Recuperación de acceso configurada de forma segura.
- [ ] Dependencias sin vulnerabilidades críticas conocidas.
- [ ] Logs libres de información sensible.
- [ ] Procedimiento de rotación y respaldo documentado.
