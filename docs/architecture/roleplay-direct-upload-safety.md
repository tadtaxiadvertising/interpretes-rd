# Intérpretes RD — subida directa de audios de Roleplay (diseño deshabilitado)

**Estado:** contratos y preparación de reservas sin habilitar subida directa. La API actual continúa recibiendo multipart autenticado. No se emiten URLs firmadas ni se cambian objetos ni permisos del bucket histórico. El 22-11-2026 se aprovisionó un bucket privado adicional, todavía vacío y no conectado a la aplicación.

## Objetivo y límite del cambio

Hasta 25 × 15 MiB pueden representar 375 MiB en la memoria del servicio Next.js, más copias adicionales. El límite de streaming del endpoint heredado protege ante solicitudes excesivas, pero no evita el pico de memoria para un lote legítimo.

El nuevo helper `src/lib/roleplay/direct-upload-contract.ts` solo valida una declaración por posición (1–25, orden 0–24, tipo MIME autorizado, 1–15 MiB por archivo y SHA-256 hexadecimal exacto). Genera rutas temporales como `staging/roleplay/<uuid-servidor>/<posición>.<extensión>`. Rechaza nombres originales, rutas, URLs u otros campos propuestos por el cliente. La UUID debe crearla exclusivamente el servidor. El helper **no permite subir archivos**, no verifica propiedad, no utiliza API keys y no está conectado a la ruta existente.

## Aislamiento de almacenamiento privado (aprovisionado, no activado)

La consulta de producción del **22-11-2026** confirmó que el proyecto Supabase `kzbkygppplknynrwmtmf` contiene el bucket histórico `roleplay-audio` (`public=true`, 2 objetos bajo `base/`) y ahora también el nuevo `roleplay-audio-private` (`public=false`, **0 objetos**). La segunda lectura confirmó que el bucket histórico y sus referencias no se modificaron. Se comprobó `storage.objects.relrowsecurity=true` y que no hay políticas de acceso definidas en `pg_policies` para `storage.objects` en ese proyecto. Estos metadatos no acreditan la naturaleza clínica ni el historial de acceso de objetos existentes.

El bucket aislado permite únicamente `audio/mpeg`, `audio/wav`, `audio/webm` y `audio/mp4`, con tamaño máximo de **15 MiB por objeto**. La configuración se aprovisionó directamente en Supabase como operación aditiva; no se ha vinculado a ningún endpoint o client de navegador. Para futuras instalaciones, debe replicarse mediante un proceso controlado y comprobable que preserve el aislamiento. No se autoriza cambiar `roleplay-audio` a privado hasta completar migración de reproducción, biblioteca y sesiones históricas.

`src/lib/roleplay/private-audio-bucket-readiness.ts` incorpora una **barrera server-side de solo lectura, todavía sin llamadas de producción**. En la futura ruta de firma, el servicio privilegiado deberá consultar `storage.getBucket('roleplay-audio-private')` inmediatamente antes de emitir la capacidad. Rechazará datos inexistentes, errores del proveedor, `public` diferente de `false`, un ID distinto, tamaño máximo diferente de 15 MiB o una lista MIME incompleta, duplicada o ampliada. Nunca devolverá la excepción del proveedor al navegador. Esto no reemplaza autorización admin, control de propietario, políticas de Storage, verificación real de bytes ni publicación transaccional. No debe almacenarse en caché una validación previa si luego se emitirán firmas.

## Preparación de reserva del servidor (no persistida, todavía inactiva)

`src/lib/roleplay/direct-upload-reservation.ts` crea exclusivamente en código de servidor un **UUID v4 aleatorio** y reconstruye las rutas canónicas de 1–25 audios a partir de `order`, `mime`, `sizeBytes` y `sha256`. Exige un identificador de administrador no vacío (proveniente de autenticación confiable) y un reloj válido; establece `status: RESERVED`, `createdAtMs` y una caducidad de **30 minutos**. No acepta UUID, dueño, rutas, permisos, firma ni tiempo enviados por el navegador. Un UUID nunca será una credencial de acceso.

El componente **no autentica HTTP, no escribe en la base de datos, no bloquea idempotencias y no concede subida**. Una ruta futura deberá validar sesión administrativa y coincidencia con cualquier Bearer explícito, y almacenar la reserva atómicamente con clave idempotente vinculada a su dueño, *antes de emitir* capacidades temporales. Un reintento que encuentre una reserva pendiente debe reconciliarla, no crear otra subida automáticamente.

El preflight de publicación exige además `createdAtMs` confiable y descarta cualquier evidencia `verifiedAtMs` anterior a la creación del lote. La evidencia sigue teniendo que venir de bytes comprobados por un verificador autorizado y almacenarse en servidor; **no** es suficiente que el navegador declare un SHA válido. No existen cambios en las tablas, APIs ni archivos de producción.

## Idempotencia de reserva (esquema preparado, sin despliegue de base de datos)

`src/lib/roleplay/direct-upload-reservation-ledger.ts` prepara un **claim con persistencia futura**, vinculado a `(actor_user_id, request_key)`. El identificador de solicitud es un UUID v4/v7 para reconocer reintentos, nunca un token de autorización. El servidor crea un UUID separado para el lote y calcula una huella SHA-256 de las declaraciones ordenadas (posición, MIME, tamaño y digest). No copia rutas, nombres ni credenciales del navegador. Una futura ruta autenticada podrá llamar al servicio solo **después de validar cookie de administrador, Bearer explícito y límites de admisión**.

Una inserción exitosa devuelve `CREATED` con el identificador de lote, **no una URL firmada**. Una colisión única de `actor+requestKey` con contenido idéntico devuelve `RECONCILE` incluso si el registro está expirado, publicado o cancelado. Si la huella cambia devuelve `CONFLICT`, y si no es posible comprobar el estado devuelve un error fijo sin secretos. Nunca se reemite acceso a Storage ni se borra un audio por un reintento ambiguo. El futuro servicio de reconciliación debe consultar evidencia confiable y transacciones previas antes de decidir cualquier recuperación.

`prisma/schema.prisma` declara el modelo `RoleplayUploadReservation`, pero la tabla **no existe aún en producción**. Su SQL se conserva deliberadamente fuera de `prisma/migrations`, en `docs/operations/staged-sql/roleplay-upload-reservations.sql`, para evitar que `prisma migrate deploy` pueda aplicarlo accidentalmente. El contrato incluye unicidad del propietario/clave, JSON de 1–25 elementos, fecha de caducidad máxima de 30 minutos, evidencia inicialmente vacía, estados restringidos, RLS y revocación de permisos de Data API. No se agrega un índice sin justificación de consultas reales.

**Bloqueos de activación:** respaldo y aprobación de migración, despliegue y verificación del esquema real, soporte de reconciliación idempotente tras timeout, control de propiedad en todas las operaciones, almacenamiento privado, firmas de alcance mínimo, verificación real de los bytes y publicación transaccional. El código de creación administrativa vigente permanece desconectado de este ledger. Los tests mock no sustituyen ensayos de concurrencia en PostgreSQL descartable ni validación de producción.

## Verificación PostgreSQL descartable de reservas

`scripts/verify-roleplay-upload-reservations-migration.ts` aplica la **propuesta exacta de SQL staged** exclusivamente a una base PostgreSQL nueva, con nombre aleatorio, dentro del contenedor de CI. Se niega a ejecutarse si `CI=true` no está presente, si la URL no apunta a `localhost:5432/interpreters_e2e` con el usuario `postgres`, o si `NODE_ENV=production`. Nunca usa credenciales de Supabase ni comandos de despliegue; elimina la base descartable al terminar.

Las pruebas ejercitan con **dos conexiones reales** el índice único `(actor_user_id, request_key)` (un solo INSERT ganador) y un compare-and-swap `VERIFIED → PUBLISHED` (un solo UPDATE ganador). También comprueban aislamiento RLS sin políticas ni grants de Data API, los límites del esquema, el rechazo de contenido/estados inválidos, vencimiento y `ROLLBACK` de datos sintéticos. Un test de seguridad exige que el script siga confinado a CI. La comprobación se ejecuta en el workflow antes del build principal.

**Alcance:** demuestra restricciones y transacciones de PostgreSQL, pero **no** sustituye la autenticación HTTP, verificación de bytes ni reconciliación de cargas ambiguas. No aplica DDL ni publica sesiones en producción. `prisma db push` del propio CI puede generar el modelo en la base principal de pruebas; por eso el script utiliza una **base temporal independiente** para validar el archivo SQL que se desplegaría posteriormente.

## Verificación incremental disponible (no conectada a Storage)

`src/lib/roleplay/direct-upload-stream-verifier.ts` puede comprobar un único stream de bytes contra los valores `sizeBytes` y `sha256` esperados, sin guardar el archivo entero en memoria. Si la secuencia excede el tamaño declarado, termina incompleta, cambia su digest, se cancela o falla la fuente, devuelve **solo códigos de error fijos** sin revelar URL firmada, ruta ni mensajes del proveedor. Las pruebas incluyen un archivo sintético de 15 MiB alimentado por fragmentos de 64 KiB.

El componente no identifica al administrador, no recupera objetos de Storage y no verifica por sí mismo que el SHA esperado corresponda a una reserva legítima. Debe ejecutarse **después** de comprobar propiedad, expiración, estado y ruta inmutable de un lote. Tampoco evita el consumo de ancho de banda: recuperar 25 archivos de 15 MiB para verificarlos en Next.js supondría transferir hasta 375 MiB por el VPS, aunque la memoria sea constante. Se necesita un proceso de verificación cercano al almacenamiento o un worker con límites de tráfico y recursos antes de activar la función.

## Preflight de publicación del lote (todavía inactivo)

`src/lib/roleplay/direct-upload-publication-gate.ts` valida un **snapshot persistido de reserva** y la evidencia de verificación de todos sus objetos. Comprueba coincidencia estricta con el administrador autenticado, que la reserva sigue vigente, estado `VERIFIED`, 1–25 posiciones completas sin duplicados, rutas canónicas de staging, tamaño exacto, digest y marcas temporales de verificación. No permite publicar un lote `PUBLISHED` o `CANCELLED` de nuevo. Rechaza datos incompletos o modificados mediante códigos de error que no incluyen datos personales.

**Límite de confianza:** la firma de la función no convierte un objeto arbitrario en evidencia real. El servicio futuro deberá cargar tanto la reserva como sus verificaciones desde **almacenamiento confiable del servidor**, nunca desde el JSON del navegador. La comprobación pura no evita carreras de dos administradores: el servicio de publicación tendrá que reclamar `VERIFIED -> PUBLISHED` con actualización condicional/idempotente **dentro de una única transacción**, tras confirmar permisos y antes de dar por completada la asignación. Tampoco valida permisos de lectura del bucket ni genera URLs.

## Comprobante de publicación con sesiones (STAGED; no conectado)

El modelo `RoleplayUploadReservation` y la propuesta SQL staged incorporan `published_session_ids`, inicialmente vacío. Una restricción PostgreSQL obliga a que el estado `PUBLISHED` contenga al menos un identificador de sesión y que los estados anteriores no contengan ninguno. El ensayo aislado utiliza **dos transacciones PostgreSQL competidoras**, cada una con una sesión sintética y una transición condicional; valida que solamente sobreviven la sesión ganadora y su comprobante, y que el otro intento se revierte por completo.

`src/lib/roleplay/direct-upload-publication-receipt.ts` prepara la última operación **del lado del servidor dentro de la transacción que creó las sesiones**. Revalida identidad de administrador, declaración, evidencia de bytes ya verificada, vencimiento e IDs de sesión, y reclama `VERIFIED → PUBLISHED` mediante `updateMany` condicional. `count !== 1` es un error que el servicio futuro debe propagar para revertir la transacción completa. Nunca debe ejecutarse después de confirmarla. Este helper **no** crea sesiones, ni firma URLs, ni lee Storage, ni reemplaza la autentificación del endpoint.

**Límite esencial:** la columna almacena un comprobante, **no tiene clave foránea por cada ID del arreglo**. Una futura reconciliación de `PUBLISHED` debe consultar los IDs y comprobar la existencia de todas las sesiones bajo el mismo control de autorización antes de devolver un resultado de éxito. La base de producción sigue sin esta tabla; no habilitar el flujo directo solo porque el SQL y las pruebas aprueben.

## Huellas SHA-256 locales previas a la reserva (todavía desconectadas)

`src/lib/roleplay/direct-upload-browser-hash.ts` prepara declaraciones `{ order, mime, sizeBytes, sha256 }` sin subir ni persistir audio. Valida **los 25 archivos y sus tipos/tamaños antes de leer bytes**, calcula cada SHA-256 con Web Crypto en el navegador, y detiene el lote cuando hay cancelación o un error. Solo comunica conteos de progreso; ningún mensaje de error contiene nombres de archivo, contenido o información privada.

**Costo acotado, no streaming:** `SubtleCrypto.digest` requiere materializar en memoria el `ArrayBuffer` de un archivo de hasta 15 MiB a la vez. Nunca calcula en paralelo ni mantiene 25 buffers deliberadamente, aunque el navegador puede retener copias temporales. La operación criptográfica individual no puede cancelarse; una señal de aborto impide iniciar el siguiente archivo y rechaza el resultado del lote. Se requiere contexto seguro (HTTPS) con Web Crypto disponible.

Estas huellas declaradas por navegador **no autorizan subida ni demuestran integridad de Storage**. El servicio futuro debe recalcular la huella desde bytes confiables para cada objeto, vincular la reserva con administrador, vencimiento y ruta, y publicar solo después de verificar el lote completo. El formulario existente no consume todavía este helper; los flujos actuales de manifest/ZIP y multipart siguen sin cambios.

## Transferencia secuencial en navegador (todavía desconectada)

`src/lib/roleplay/direct-upload-browser.ts` incorpora un orquestador de transporte **no activado** para 1–25 archivos. Recibe una reserva creada por el servidor (ID, rutas canónicas, tipos, tamaños, huellas y tokens de subida temporales) y un adaptador de Storage que realiza la operación firmada. Antes de la primera transferencia comprueba el contrato de lote completo y que cada `File.size` y `File.type` coincidan con su posición reservada. No solicita firmas, no construye URLs, no publica sesiones ni descarga el contenido al VPS.

Transfiere **un solo archivo a la vez** y comunica únicamente el número de archivos completados. Un error de Storage, un aborto o un error del callback de progreso detienen el lote; los errores son códigos fijos sin revelar nombres de grabación, rutas de objeto ni tokens. El adaptador de Storage que se conecte posteriormente debe propagar `AbortSignal` para cancelar la petición en curso, cuando su SDK lo soporte. No hay reintentos ni borrados automáticos de objetos parcialmente cargados: la reconciliación debe ejecutarse en el servidor y respetar posibles transacciones confirmadas con respuesta perdida.

**La validación del navegador no prueba integridad del archivo ni autoriza publicar.** Un fichero de igual tamaño y MIME podría tener otro contenido; el servidor deberá validar SHA-256 real, pertenencia a la reserva, estado, caducidad y disponibilidad de **todos** los objetos mediante componentes confiables antes de convertir la reserva en una sesión. La implementación deliberadamente no conecta el módulo al formulario `NewRoleplayForm` ni crea un endpoint para obtener tokens. El flujo heredado sigue operativo hasta completar #287 y #290.

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
