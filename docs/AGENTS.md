# Instrucciones para agentes de desarrollo

Estas reglas complementan el `AGENTS.md` de la raíz. Si existe conflicto, se deben obedecer primero las instrucciones de mayor alcance o prioridad aplicables al repositorio.

## Antes de cambiar código

1. Leer `PROJECT_PLAN.md` y el documento temático relevante.
2. Inspeccionar el estado de Git y preservar cambios del usuario.
3. Leer el `AGENTS.md` de la raíz.
4. Para APIs de Next.js, consultar la documentación instalada en `node_modules/next/dist/docs/`.
5. Confirmar el alcance del MVP y no introducir módulos futuros incidentalmente.

## Reglas del proyecto

- TypeScript estricto y sin `any` injustificado.
- Componentes de servidor por defecto.
- Secretos únicamente en variables de entorno.
- Nunca exponer `service_role` al cliente.
- Cambios de esquema mediante migraciones nuevas.
- RLS en todas las tablas expuestas.
- Buckets privados para documentos y evidencias.
- Permisos verificados en servidor/base de datos, no solo en la UI.
- Estados críticos con historial auditable.
- Experiencia accesible y compatible con móvil.

## Alcance protegido

No implementar dentro del MVP salvo solicitud explícita y cambio documentado:

- Editor de marcadores PDF.
- Exportación de PDF anotado.
- QuickBooks.
- GPS en tiempo real.
- Contabilidad completa.
- Aplicaciones móviles nativas.

## Ediciones

- Hacer cambios mínimos y enfocados.
- No reescribir archivos no relacionados.
- No borrar ni revertir cambios existentes del usuario.
- Mantener nombres en inglés para código y esquema.
- Actualizar documentación en el mismo cambio cuando se modifique arquitectura, esquema, seguridad o alcance.
- Evitar nuevas dependencias sin necesidad demostrada.

## Verificación

Antes de entregar, ejecutar en proporción al cambio:

```powershell
npm run lint
npm run build
git diff --check
git status --short
```

Para cambios de seguridad, probar al menos un caso permitido y uno denegado. Para cambios visuales, revisar escritorio, móvil, teclado, foco y estados de error.

## Entrega

Informar:

- Qué cambió.
- Qué se verificó.
- Qué no se pudo verificar.
- Migraciones o configuración requerida.
- Riesgos o siguientes pasos reales.
