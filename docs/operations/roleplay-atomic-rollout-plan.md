# Despliegue controlado de Audio Studio — STAGED, no autorizado para producción

## Estado y requisitos previos

El código y el SQL preparado no equivalen a instalación ni a despliegue. Mantener todas las banderas de subida directa y nueva asignación desactivadas. La prueba local del proveedor aceptó dos escrituras concurrentes; la protección de escritura de nuestra aplicación pasó su piloto local, pero la infraestructura hospedada todavía no está certificada.

Antes de considerar una instalación: validar CI, respaldo restaurable, destino y versión del servicio, ausencia de firmantes antiguos, control exclusivo de los prefijos privados, permisos efectivos y capacidad real de toda la organización. El informe `npx tsx scripts/inspect-roleplay-storage-budget.ts --check-only` es diagnóstico de solo lectura. Si el esquema es parcial, detenerse: no ejecutar CREATE IF NOT EXISTS ni reparar el historial automáticamente.

## Orden único de instalación

Los seis archivos originales permanecen fuera de prisma/migrations. El manifiesto fijo `scripts/roleplay-staged-install-plan.ts` registra orden y SHA-256 de cada fuente, elimina únicamente las envolturas BEGIN/COMMIT conocidas para la prueba conjunta y rechaza cambios inesperados en ellas. No es un parser general de SQL ni un ejecutor de producción.

| Orden | SQL en docs/operations/staged-sql | Dependencia |
| --- | --- | --- |
| 1 | roleplay-bilingual-openings.sql | Sesiones, escenarios y respuestas existentes |
| 2 | roleplay-upload-reservations.sql | Esquema público |
| 3 | roleplay-final-write-claims.sql | Reservas |
| 4 | roleplay-final-upload-evidence.sql | Reservas |
| 5 | roleplay-direct-upload-budget.sql | Reservas |
| 6 | roleplay-unused-upload-capacity.sql | Reservas, barrera, evidencia y presupuesto |

CI ensaya la instalación completa en una única transacción de una base temporal aleatoria del PostgreSQL aislado. Valida el catálogo conjunto, presupuesto cero, recuperación desactivada, compatibilidad de sesión histórica y guard de apertura. Revierte el ensayo aun cuando sea exitoso. Luego introduce una colisión en el quinto archivo y comprueba que toda la transacción se revierta, incluidos los cuatro primeros archivos. Las pruebas individuales continúan ejecutándose después. No se crea un instalador que acepte una conexión de producción.

## Separación de fases

1. **Esquema**: previa autorización específica, respaldo restaurable y ventana de mantenimiento, instalar únicamente SQL revisado y con flags desactivados. Comprobar esquema y permisos efectivos.
2. **Storage**: comprobar metadatos de ambos buckets privados, crear únicamente el bucket de apertura faltante mediante API autorizada, no cambiar el bucket histórico. Probar capacidad y aislamiento con fixtures sintéticos. Estas operaciones no son parte de la transacción PostgreSQL.
3. **Runtime**: verificar versión efectivamente desplegada en todas las réplicas, configuración HTTPS y acceso seguro. No habilitar firmas si existen procesos antiguos. Vinculación de metadatos de asignación, límites de solicitudes y pruebas de publicación completa siguen siendo requisitos.
4. **Piloto**: solo tras resolver los bloqueos, autorizar una capacidad pequeña dentro del margen real de cuota y comprobar una asignación individual sintética, reproducción, apertura, respuestas y revisión. La devolución de capacidad permanece desactivada hasta su aprobación específica.
5. **Ampliación**: revisar resultados y presupuesto antes de aumentar el alcance.

## Reversión

Antes del COMMIT de la instalación, cualquier fallo debe producir ROLLBACK total. Después del COMMIT, no eliminar tablas, columnas, registros, archivos, cargos o barreras de escritura como reacción automática. Primero detener nuevas reservas y asignaciones; conservar los servicios de lectura y apertura de sesiones que ya requieren el protocolo. Detener nuevas escrituras si su seguridad está en duda y reconciliar operaciones pendientes. Revisar el plan de recuperación con respaldo restaurable y estado real de sesiones; una restauración puede perder actividad posterior al respaldo. Nunca desactivar indiscriminadamente una protección necesaria para sesiones ya publicadas. No reciclar claves ni devolver cargos por falta de respuesta.

Este documento y las pruebas de CI no autorizan ejecución en el proyecto hospedado. La reversión probada es únicamente la de DDL sin confirmar en la base desechable, no la restauración de producción ni la reversión de Storage.
