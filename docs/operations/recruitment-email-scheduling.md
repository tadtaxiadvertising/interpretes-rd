# Programación de correos operativos

La ruta POST /api/cron/recruitment-email acepta exclusivamente Authorization: Bearer con la credencial privada OPERATIONAL_EMAIL_SCHEDULER_SECRET (32 bytes aleatorios representados por 64 caracteres hexadecimales). No acepta destinatarios ni eventos desde el cliente. No utiliza cookies administrativas ni una clave de Supabase. Nunca registrar la cabecera, ponerla en una URL o reutilizar una credencial existente.

Antes de activar:
1. Aplicar las propuestas privadas de registro y vinculación mediante el procedimiento revisado de migraciones; comprobar permisos del rol real, RLS y no exposición en Data API.
2. Confirmar la recepción de una prueba SMTP en el buzón corporativo. Validar SPF, DKIM y DMARC.
3. Habilitar las opciones independientes de vinculación, despacho y lotes; fijar una fecha UTC de inicio válida para no recuperar eventos históricos. Comprobar el panel de Configuración.
4. Generar la credencial en un gestor seguro de secretos; configurarla en el servidor y en un programador confiable. Habilitar OPERATIONAL_EMAIL_SCHEDULER_ENABLED solo después de las comprobaciones.
5. Configurar el programador existente para una invocación HTTPS POST cada cinco minutos, sin solapamiento, con un timeout compatible con tres envíos secuenciales y sin reintentos inmediatos. No instalar un nuevo contenedor. El programador no se crea con este cambio.
6. Verificar una ejecución controlada y revisar el historial. HTTP 200 significa lote completado; 401 credencial no válida; 429 lote ocupado o en enfriamiento; 503 configuración desactivada, indisponibilidad o revisión necesaria. Ante review_required o unavailable, detener la programación e investigar antes de reanudar. No reencolar automáticamente una aceptación incierta.

El panel solo diagnostica variables de entorno, no confirma la migración, la existencia del programador ni la entrega. El límite de ejecución es local al proceso; las reclamaciones atómicas de eventos son persistentes. No activar múltiples programadores concurrentes. La ruta /api/health permanece independiente.

Para detener el despacho, desactivar primero OPERATIONAL_EMAIL_SCHEDULER_ENABLED y OPERATIONAL_EMAIL_DISPATCH_ENABLED y detener la tarea externa; revisar cualquier envío en curso. No borrar el historial ni restablecer registros inciertos a pendiente.

## Registro de instalación del 24 de noviembre de 2026

Migración Supabase `20261124075938` (`private_recruitment_email_ledger_and_binding`) aplicada. Ambas tablas se comprobaron vacías, con RLS, tres claves foráneas validadas y sin permisos de acceso para anon, authenticated ni service_role. No se concedieron permisos adicionales. La conexión administrativa `postgres` supera el diagnóstico de metadatos y disponibilidad de políticas; esto no certifica el usuario de conexión de Next.js. En Configuración → Correos corporativos, ejecutar «Comprobar base de datos» desde el servidor desplegado. Si indica revisión de permisos, identificar el rol real de DATABASE_URL en Easypanel sin compartir la URL ni su contraseña. No conceder acceso a roles API. No habilitar despacho hasta verificar las políticas efectivas, el SMTP y la recepción en el buzón. La comprobación previa del lote detiene el procesamiento si falta la estructura o los permisos declarados; no constituye una prueba efectiva de escritura ni de entrega.

## Piloto controlado antes de activar el programador

El administrador informó haber completado el diagnóstico desde Configuración, la recepción del correo de prueba, la comprobación del remitente y la recuperación de contraseña con marca Intérpretes RD. No se ha verificado independientemente la versión desplegada. La consulta del registro privado todavía mostraba cero vinculaciones y cero entregas; pg_cron y pg_net no estaban instalados.

Mantener OPERATIONAL_EMAIL_SCHEDULER_ENABLED=false. Configurar OPERATIONAL_EMAIL_PILOT_RECIPIENT con un único buzón de prueba controlado, distinto de una cuenta administrativa; habilitar vinculación, despacho y lotes únicamente con el piloto configurado. Fijar la fecha UTC de inicio antes de crear una nueva postulación de prueba. Completar el acceso y pulsar Vincular mi cuenta desde el navegador que conserva la referencia firmada. El administrador puede ejecutar el piloto desde Configuración → Correos corporativos. El lote revisa como máximo un evento de esa dirección; el destinatario debe coincidir también con la identidad de Supabase. Revisar aceptación y recepción real. Si no hay eventos, no se envía nada. Si hay un resultado incierto, no repetir sin revisión. Antes de retirar el filtro de piloto, detener despacho y lotes, confirmar recepción, establecer una nueva fecha de corte y revisar la activación general. No instalar extensiones ni configurar un cron desde este cambio.

### Separación del piloto y el despacho general

Durante el piloto, mantener OPERATIONAL_EMAIL_GENERAL_ENABLED=false y OPERATIONAL_EMAIL_SCHEDULER_ENABLED=false. La eliminación accidental del destinatario piloto no permite envíos generales. Solo después de confirmar una notificación real de reclutamiento, detener el despacho, retirar el filtro, establecer un nuevo corte UTC y habilitar explícitamente OPERATIONAL_EMAIL_GENERAL_ENABLED=true. Si coexisten un destinatario piloto y la habilitación general, ambos modos quedan bloqueados.
