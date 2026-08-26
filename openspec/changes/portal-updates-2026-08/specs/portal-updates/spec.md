# Portal Updates Specification

## Purpose

Consolidar las 12 actualizaciones pedidas por el cliente sobre precios, facturación, editor PDF, trabajos, dashboard, fotos y captación de empleados.

## ADDED Requirements

### Requirement: Lista de precios visible solo para admin

Un administrador MUST ver y editar la lista de precios desde el menú lateral. Un supervisor MUST NOT verla.

#### Scenario: Admin accede

- GIVEN un usuario `admin`
- WHEN abre el menú lateral
- THEN MUST ver la entrada "Lista de precios" y poder editar códigos y tarifas

#### Scenario: Supervisor sin acceso

- GIVEN un usuario `supervisor`
- WHEN abre el menú lateral
- THEN MUST NOT ver "Lista de precios" ni acceder a `/catalogo`

### Requirement: Sin tarifas en cero

Las tarifas de catálogo MUST NOT admitir precio $0.000. Las tarifas cero existentes MUST quedar inactivas.

### Requirement: Facturado semanal y ganancia por técnico

El dashboard del admin MUST mostrar el total facturado de la semana (precios del admin) y la ganancia semanal de cada técnico según su categoría.

### Requirement: Gasolina día a día

Al consultar un técnico, MUST poder ver el gasto de gasolina desglosado por día de la semana.

### Requirement: Sin columna crew

El dashboard MUST NOT mostrar la columna ni el filtro de "crew".

### Requirement: Repartición sin precios visibles

Al repartir el porcentaje financiero, el sistema MUST NOT mostrar montos ni precios estimados de los participantes.

### Requirement: Persistencia del porcentaje

El porcentaje de repartición MUST persistir aunque el técnico salga a cargar evidencia y vuelva.

### Requirement: Subida múltiple de fotos

El técnico y la oficina MUST poder seleccionar y subir varias fotos de evidencia a la vez.

### Requirement: Carpeta de facturados

Los trabajos facturados MUST quedar en una carpeta "Facturados" y MUST NOT aparecer en la lista principal de trabajos.

### Requirement: Quitar título y usar número PRISM

El portal MUST dejar de capturar y mostrar el "Título" del trabajo. El identificador visible MUST ser el "Número PRISM".

### Requirement: Editor PDF mejorado

El editor MUST abrir el PDF a la primera (sin pantalla de error), MUST cambiar el zoom de 5 en 5, MUST abrir el desplegable de edición al segundo clic y MUST permitir una flecha para señalar en las notas de texto.

### Requirement: Landing de captación de empleados

Una página pública nueva MUST permitir a candidatos enviar su información de contacto y experiencia, y MUST guardarla para revisión.
