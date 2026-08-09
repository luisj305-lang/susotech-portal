# 09 — Checklist del proyecto

Este archivo refleja trabajo verificado. No marcar una tarea solo porque existe código parcial.

## Fundamentos

- [x] Crear proyecto Next.js.
- [x] Configurar TypeScript.
- [x] Configurar Tailwind CSS.
- [x] Instalar Supabase JS y SSR.
- [x] Crear rutas iniciales de login y dashboard.
- [x] Crear cliente inicial de Supabase.
- [x] Crear migraciones iniciales de roles y perfiles.
- [ ] Crear `.env.example` sin secretos.
- [ ] Actualizar README raíz.
- [ ] Definir estrategia de ramas y entornos.

## Autenticación

- [ ] Formulario de acceso validado.
- [ ] Inicio de sesión funcional.
- [ ] Cierre de sesión funcional.
- [ ] Renovación de sesión.
- [ ] Protección de rutas privadas.
- [ ] Redirecciones correctas.
- [ ] Recuperación de contraseña.
- [ ] Manejo de usuario inactivo.

## Roles y seguridad

- [ ] Confirmar roles definitivos.
- [ ] Definir matriz de permisos.
- [ ] Habilitar RLS en tablas expuestas.
- [ ] Crear políticas por operación.
- [ ] Probar acceso permitido.
- [ ] Probar acceso denegado.
- [ ] Confirmar ausencia de `service_role` en cliente.
- [ ] Revisar logs y errores sensibles.

## Trabajos

- [ ] Migración de `jobs`.
- [ ] Migración de `job_assignments`.
- [ ] Migración de historial de estados.
- [ ] Crear trabajo.
- [ ] Listar y paginar.
- [ ] Buscar y filtrar.
- [ ] Ver detalle.
- [ ] Editar campos permitidos.
- [ ] Asignar técnico.
- [ ] Implementar estados y transiciones.
- [ ] Archivar sin perder auditoría.

## Documentos

- [ ] Definir buckets privados.
- [ ] Crear políticas de Storage.
- [ ] Validar tamaño y tipo.
- [ ] Subir PDF.
- [ ] Visualizar PDF.
- [ ] Subir fotografías.
- [ ] Subir evidencias.
- [ ] Registrar metadatos.
- [ ] Crear URLs firmadas.
- [ ] Probar acceso no autorizado.

## Códigos y tarifas

- [ ] Migración de catálogo de códigos.
- [ ] Administración del catálogo.
- [ ] Migraciones de tarifas.
- [ ] Definir vigencia de tarifas.
- [ ] Registrar códigos por trabajo.
- [ ] Validar cantidades.
- [ ] Restringir información financiera.
- [ ] Congelar valores aprobados.

## Revisión y producción

- [ ] Enviar a revisión.
- [ ] Crear cola del supervisor.
- [ ] Solicitar correcciones con comentario.
- [ ] Aprobar con auditoría.
- [ ] Reabrir solo con permiso.
- [ ] Crear vista de producción.
- [ ] Completar y archivar.

## Calidad

- [ ] Configurar pruebas unitarias.
- [ ] Configurar pruebas E2E.
- [ ] Probar flujo crítico completo.
- [ ] Probar políticas RLS.
- [ ] Revisar accesibilidad.
- [ ] Revisar móvil.
- [ ] Lint correcto.
- [ ] Build correcto.
- [ ] Revisión de seguridad previa a producción.

## Despliegue

- [ ] Configurar proyecto Vercel.
- [ ] Configurar variables por entorno.
- [ ] Preparar base de datos productiva.
- [ ] Verificar migraciones y respaldo.
- [ ] Desplegar vista previa.
- [ ] Ejecutar prueba piloto.
- [ ] Documentar reversión.
- [ ] Configurar monitoreo.
- [ ] Lanzar MVP.

## Posterior al MVP

- [ ] Notificaciones.
- [ ] Reportes avanzados.
- [ ] Editor de marcadores PDF.
- [ ] Exportación de PDF marcado.
- [ ] QuickBooks.
- [ ] GPS.
- [ ] Dashboard financiero.
