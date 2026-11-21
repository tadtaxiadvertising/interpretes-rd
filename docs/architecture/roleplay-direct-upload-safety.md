# Intérpretes RD — subida directa de audios de Roleplay (diseño deshabilitado)

**Estado:** únicamente contrato de validación; función no habilitada. La API actual continúa recibiendo multipart autenticado. No se emiten URLs firmadas ni se modifican buckets.

## Objetivo y límite del cambio

Hasta 25 × 15 MiB pueden representar 375 MiB en la memoria del servicio Next.js, más copias adicionales. El límite de streaming del endpoint heredado protege ante solicitudes excesivas, pero no evita el pico de memoria para un lote legítimo.

El nuevo helper `src/lib/roleplay/direct-upload-contract.ts` solo valida una declaración por posición (1–25, orden 0–24, tipo MIME autorizado, 1–15 MiB por archivo y SHA-256 hexadecimal exacto). Genera rutas temporales como `staging/roleplay/<uuid-servidor>/<posición>.<extensión>`. Rechaza nombres originales, rutas, URLs u otros campos propuestos por el cliente. La UUID debe crearla exclusivamente el servidor. El helper **no permite subir archivos**, no verifica propiedad, no utiliza API keys y no está conectado a la ruta existente.

## Verificación incremental disponible (no conectada a Storage)

`src/lib/roleplay/direct-upload-stream-verifier.ts` puede comprobar un único stream de bytes contra los valores `sizeBytes` y `sha256` esperados, sin guardar el archivo entero en memoria. Si la secuencia excede el tamaño declarado, termina incompleta, cambia su digest, se cancela o falla la fuente, devuelve **solo códigos de error fijos** sin revelar URL firmada, ruta ni mensajes del proveedor. Las pruebas incluyen un archivo sintético de 15 MiB alimentado por fragmentos de 64 KiB.

El componente no identifica al administrador, no recupera objetos de Storage y no verifica por sí mismo que el SHA esperado corresponda a una reserva legítima. Debe ejecutarse **después** de comprobar propiedad, expiración, estado y ruta inmutable de un lote. Tampoco evita el consumo de ancho de banda: recuperar 25 archivos de 15 MiB para verificarlos en Next.js supondría transferir hasta 375 MiB por el VPS, aunque la memoria sea constante. Se necesita un proceso de verificación cercano al almacenamiento o un worker con límites de tráfico y recursos antes de activar la función.

## Requisitos antes de activar la función

1. **Privacidad y proyecto correcto (#287/#368):** verificar en modo lectura el campo `storage.buckets.public` y políticas de `storage.objects` del proyecto Supabase realmente utilizado. La conexión actual expone otros proyectos, no el que figura en la configuración histórica. No leer grabaciones clínicas. No cambiar las ACL de un bucket cuyos enlaces públicos ya consumen sesiones y biblioteca.
2. **Reserva autenticada por lote:** verificar que cookie y Bearer, si existe, pertenecen al mismo administrador; generar UUID, asignar propietario, estado, tamaño, digest y vencimiento para cada slot en la base de datos; añadir idempotencia y unicidad para impedir dobles compromisos. Un ID de lote que llegue del navegador nunca puede autorizar una subida.
3. **Capacidades de carga de alcance mínimo:** emitir URL firmada exclusivamente para una ruta reservada con política de no sobrescritura, idealmente en bucket privado comprobado. La documentación actual de Supabase describe una vida de 2 horas para esas URLs y permite usarlas sin autenticación adicional durante esa vigencia. No exponer secretos del servidor en navegador ni logs.
4. **Transferencia directa:** enviar el archivo desde el navegador a Storage, con concurrencia baja, progreso y cancelación. Verificar límites de tamaño, tipos y cuota también en Storage; no basta la validación de cliente.
5. **Confirmación de integridad:** comprobar en servidor propiedad, estado, existencia, tamaño, tipo y SHA-256 real antes de publicar. `storage.info()` por sí solo **no demuestra** el checksum del contenido; se necesita una estrategia de verificación confiable y acotada que no descargue 375 MiB al VPS.
6. **Publicación transaccional e idempotente:** crear asignaciones y referencias inmutables solo después de verificar todos los slots; ninguna sesión incompleta. Ante timeout de transacción ambiguo, no borrar los audios posiblemente publicados. Reconciliar referencias primero y limpiar objetos temporales huérfanos únicamente después de una ventana de gracia.
7. **Reproducción privada:** auditar roles admin/intérprete/candidato/QA y biblioteca antes de pasar a URLs de lectura firmadas de corta vida; preservar sesiones existentes, caducidad, revocación y rollback. Una URL firmada no sustituye comprobar autorización.
8. **Activación por bandera deshabilitada de forma predeterminada:** pruebas con audio sintético (1, 21 y 25 clips), dos administradores, enlaces caducados, checksum alterado, cortes de red, subida parcial, cancelación, incompatibilidad de clientes, y consumo real de memoria. Activar solo tras comprobar SHA desplegado y reglas de protección de `main` (#465).

## Condiciones que impiden activar

No habilitar el endpoint de firmas antes de confirmar privacidad del bucket, reserva por administrador, verificación de checksum y un plan de reversión. Este PR no cambia Storage, políticas, contraseñas, Easypanel, migraciones o medios reales.
