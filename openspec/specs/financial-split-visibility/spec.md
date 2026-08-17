# Financial Split Visibility Specification

## Purpose

Definir la visibilidad de montos del reparto financiero de entregas para cada participante y para la oficina.

## Requirements

### Requirement: Montos estimados en la UI de reparto

La UI de reparto MUST mostrar, por participante, el porcentaje y el monto estimado en pesos, calculado con la categoría de precio del actor que arma el reparto. Los montos son ESTIMADOS; el servidor sigue siendo la fuente de verdad y MUST calcular los centavos exactos al confirmar.

#### Scenario: Ajuste de porcentajes muestra montos

- GIVEN un `supervisor` editando el reparto de una entrega
- WHEN asigna un porcentaje a un participante
- THEN la UI MUST mostrar el porcentaje y el monto estimado en pesos

#### Scenario: Confirmación persiste montos exactos

- GIVEN un reparto confirmado
- WHEN el servidor procesa la confirmación
- THEN MUST persistir los centavos exactos por participante

### Requirement: Monto propio visible para cada participante

Cada participante —técnico y ayudante— MUST ver su propio monto del reparto en los trabajos en los que participa, desde la confirmación de la entrega (estado pendiente), y MAY ver la semana inmediatamente anterior.

#### Scenario: Técnico ve su monto en el detalle del trabajo

- GIVEN un técnico con una entrega confirmada
- WHEN consulta el detalle del trabajo
- THEN MUST ver su monto del reparto como pendiente

#### Scenario: Ayudante ve su monto

- GIVEN un ayudante que participa en el reparto de una entrega confirmada
- WHEN consulta su cuenta
- THEN MUST ver su propio monto del reparto

### Requirement: Dashboard financiero del técnico

El dashboard del técnico MUST mostrar el dinero desde la entrega, en estado pendiente, y MUST permitir consultar la semana inmediatamente anterior.

#### Scenario: Dinero visible desde la entrega

- GIVEN un técnico con entregas confirmadas y aprobadas
- WHEN abre su dashboard financiero
- THEN MUST ver los montos correspondientes, incluidos los pendientes de la semana en curso

#### Scenario: Consulta de la semana anterior

- GIVEN un técnico en su dashboard financiero
- WHEN solicita ver la semana inmediatamente anterior
- THEN MUST ver los montos de esa semana
