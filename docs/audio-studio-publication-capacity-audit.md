# Audio Studio 4.0 — ampliación de publicación

## Estado y alcance
El editor admite proyectos ampliados de hasta 100 cortes; cada paquete/sesión continúa sujeto al máximo vigente de 25. La partición no destructiva permite generar planes locales compatibles. Esta auditoría parcial no autoriza aumentar la constante de producción.

## Dependencias verificadas en código
| Componente | Dependencia | Acción previa a ampliar |
| --- | --- | --- |
| src/lib/roleplay-limits.ts | ROLEPLAY_MAX_SCENARIOS = 25 | Separar explícitamente límites de sesión y transporte |
| src/app/admin/roleplays/new/NewRoleplayForm.tsx | creación, adición, importación y preflight | comprobar capacidad según flujo habilitado |
| src/app/api/admin/roleplays/route.ts | esquema de escenarios, plantilla reutilizable, límite de bytes multipart calculado con el máximo de escenarios | preservar límite de transporte independiente; no duplicar presupuesto de memoria |
| src/app/api/admin/roleplays/studio/export/route.ts | máximo compartido y 900 segundos | preservar presupuesto de FFmpeg |
| src/lib/roleplay-studio/external-zip.ts | número de entradas y clips | auditar tamaño, descompresión, memoria y manifiesto |
| scripts/export-studio-long-local.mjs | máximos independientes 25/900 | conservar compatibilidad de exportadores actuales |
| src/app/actions/roleplay.ts y src/app/api/roleplay/start/route.ts | revisados: no usan la constante compartida | verificar orden, grabación, reanudación y finalización con sesiones mayores |

La búsqueda global del conector GitHub no devolvió coincidencias; faltan inventario completo de rutas de subida directa, esquemas SQL, workers, evaluación y pruebas de navegador. No se ha auditado la capacidad real de producción.

## Puertas de aceptación
1. Inventario completo de validaciones, SQL y scripts; verificar límites por ruta.
2. Separar presupuesto de bytes multipart, ZIP y FFmpeg del número de escenarios de sesión. No elevar la memoria máxima de Next.js.
3. Confirmar que subida directa a almacenamiento, reservas idempotentes, limpieza y publicación admiten la capacidad ampliada con concurrencia acotada.
4. Probar sesiones de 26 y 50 escenarios de extremo a extremo (creación, asignación, reproducción, grabación, recuperación, evaluación, biblioteca).
5. Ampliar progresivamente únicamente después de medir recursos y confirmar recuperación; mantener el flujo de partes y paquetes anteriores.


## Separación de presupuestos (entrega 14)
Se mantienen los límites actuales mientras se independizan los contratos: 25 escenarios por sesión, 25 por multipart, 377 MiB de cuerpo multipart, 15 MiB por audio, 25 clips y 900 s por paquete Studio, 25 slots y 375 MiB por reserva directa. Estos valores son techos de admisión, no una garantía de memoria disponible.

La ruta de creación por plantilla conserva el límite de sesión. La ruta multipart usa límites de transporte; la exportación Studio, la selección de subtítulos para paquetes y el importador de manifiestos/ZIP externos usan el límite de paquete. La reserva directa y su esquema de asignación usan su propio límite de slots y su presupuesto de bytes.

### Bloqueo confirmado de publicación ampliada
El SQL staged `docs/operations/staged-sql/roleplay-upload-reservations.sql` limita los arrays items y verified_objects a 25. La reserva y la publicación requieren correspondencia completa de archivos y escenarios. El formulario de creación activa actualmente el flujo directo únicamente para asignación individual a intérprete con apertura habilitada, sin plantilla. No basta elevar la constante de sesión ni el contador de la interfaz.

Siguiente cambio coordinado: auditar constraints instaladas y presupuesto de slots en modo lectura, preparar SQL staged y verificaciones de 26/50 archivos para una sesión con presupuesto total fijo, comprobar promoción/publicación y reproducción/evaluación. No ejecutar migraciones ni ampliar capacidad en producción antes de las pruebas. Mantener multipart y ZIP en sus límites históricos. Pendientes: inventario de consumidores de la constante compartida, interfaz de creación por ruta, formatos portables y validación real del despliegue.
