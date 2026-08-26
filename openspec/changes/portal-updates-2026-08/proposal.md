# Portal Updates 2026-08

## Why

El cliente pidió 12 actualizaciones del portal Susotech: precios y facturación, editor de PDF, trabajos, dashboard, fotos y un landing de captación de empleados.

## What Changes

- **Lista de precios** en el menú lateral (solo admin), con categorías In House / Contractor / Wallace.
- **Dashboard**: "facturado esta semana" (precios del admin) y columna de ganancia por técnico.
- **Editor PDF**: zoom de 5 en 5, flecha en las notas para señalar, desplegable de edición al 2º clic, carga correcta a la primera.
- **Trabajos**: carpeta "Facturados", quitar "Título", "Número PRISM".
- **Fotos**: subida múltiple y persistencia del porcentaje de repartición.
- Eliminar códigos con tarifa $0.000.
- Landing de captación de posibles empleados (`/empleos`).

## Impact

- Afecta dashboard, trabajos, catálogo, editor PDF y agrega `/empleos` + `/api/empleos`.
- Migraciones Supabase: tarifas cero, total facturado semanal, gasolina diaria, persistencia del porcentaje, título opcional, flecha en notas, tabla `job_applications`.

## Estado

Implementado y desplegado (commits `be55f6d`, `9a5d71d`, `3b1d08b`).
