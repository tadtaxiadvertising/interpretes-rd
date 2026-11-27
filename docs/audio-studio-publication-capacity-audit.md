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
