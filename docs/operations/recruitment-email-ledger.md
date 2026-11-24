# Registro de entrega de correos operativos

Estado: implementación con piloto controlado y programador opcional. La presencia de las tablas o el éxito de CI no certifican que el despliegue esté actualizado ni que el correo llegue al buzón.

El SQL propuesto permanece en docs/operations/proposed-recruitment-email-ledger.sql, fuera de las rutas de migración automática. No volver a aplicar a una instalación existente: comprobar primero el esquema y los permisos del rol de runtime. Cualquier instalación nueva o cambio de DDL requiere revisión y aprobación operativa. Verificar que el esquema privado no está expuesto por la Data API, y que roles públicos no pueden leer ni escribir registros.

## Garantías y límites

- Cada evento persistido tiene como máximo una fila, por clave primaria y ON CONFLICT.
- Solo un proceso puede reclamar una fila pendiente mediante UPDATE condicionado.
- SMTP aceptado no equivale a entrega en el buzón.
- Una fila en sending tras una caída requiere conciliación manual; nunca devolverla automáticamente a pending. Un fallo ambiguo no prueba que el mensaje no salió.
- No se conservan direcciones, cuerpo, secretos ni errores del proveedor en el registro.
- El borrado del evento elimina el registro asociado. No constituye un historial inmutable independiente.

## Antes de conectar el envío

1. Verificar remitente autorizado y entrega de prueba, SPF/DKIM/DMARC.
2. Validar DDL, RLS, permisos mínimos, carreras concurrentes y reversión en entorno aislado; aprobar explícitamente la migración.
3. Resolver destinatario exclusivamente desde la identidad de cuenta verificada vinculada a la postulación; no desde metadata, actorId, datos de formulario sin verificar ni una dirección enviada por el cliente.
4. Comprobar estado actual de la postulación y vigencia del evento inmediatamente antes de enviar. No enviar eventos históricos por defecto. Cancelar eventos caducados, usuarios eliminados o estados incompatibles.
5. Incorporar un mecanismo de despacho explícito, con activación independiente del correo de prueba, límites de volumen y una vista administrativa sin información sensible. No iniciar envíos desde las transacciones de postulación.
6. Probar recepción en un buzón controlado y documentar cómo conciliar estados ambiguos antes de habilitar notificaciones reales.

El piloto administrativo y el procesador por lotes utilizan el registro de entrega. El programador requiere una activación independiente; la prueba SMTP al propio remitente no crea eventos de reclutamiento.

## Validación aislada en CI

El workflow `email-ledger-postgres.yml` ejecuta la propuesta en un contenedor PostgreSQL desechable con una tabla de eventos mínima y roles de prueba. Comprueba RLS, revocación de acceso a roles públicos, restricciones, FK, borrado en cascada y carreras entre dos conexiones para insertar/reclamar el mismo evento. Los grants y la política de runtime del script son exclusivos de la prueba; no autorizan acceso en producción. No utiliza credenciales ni URLs de la base real. Además, el entorno aislado ejecuta las consultas reales de diagnóstico y descubrimiento de eventos, y comprueba la vigencia de los códigos de verificación. Falta comprobar los permisos efectivos del runtime desplegado y la recepción real.


## Procedimiento de puesta en servicio

### 1. Autenticación y correo operativo son independientes

- En Supabase, confirmar el SMTP personalizado, remitente autorizado, nombre de marca y las plantillas de [autenticación](../AUTH_CORPORATE_EMAIL_TEMPLATES.md). Comprobar un registro o recuperación de contraseña con un buzón propio. No utilizar una cuenta real de un postulante sin autorización.
- En Easypanel, confirmar que el servicio Next.js de Intérpretes RD corresponde al dominio principal y al commit aprobado. Consultar `/api/health` y `/api/version`; un build ID desconocido no acredita el despliegue.
- Configurar el proveedor SMTP operativo en las variables privadas del servicio Next.js: `OPERATIONAL_EMAIL_ENABLED=true`, `OPERATIONAL_SMTP_HOST`, `OPERATIONAL_SMTP_PORT` (465 o 587), `OPERATIONAL_SMTP_USER`, `OPERATIONAL_SMTP_PASSWORD`, `OPERATIONAL_EMAIL_FROM` y opcionalmente `OPERATIONAL_EMAIL_REPLY_TO`. Usar el mismo remitente corporativo autorizado si el proveedor lo permite. No copiar contraseñas al repositorio, a mensajes o a registros.
- En Administrador → Configuración → Correos corporativos, comprobar la base de datos y ejecutar una prueba SMTP explícita. Confirmar recepción y remitente en el buzón, no solo aceptación del servidor.

### 2. Piloto de una cuenta controlada

Mantener `OPERATIONAL_EMAIL_GENERAL_ENABLED=false` y `OPERATIONAL_EMAIL_SCHEDULER_ENABLED=false`. Definir `OPERATIONAL_EMAIL_PILOT_RECIPIENT` con un único buzón de prueba bajo control del operador y una fecha de inicio UTC real en `OPERATIONAL_EMAIL_DISPATCH_NOT_BEFORE` (formato YYYY-MM-DDTHH:mm:ssZ). Activar explícitamente `OPERATIONAL_EMAIL_BINDING_ENABLED`, `OPERATIONAL_EMAIL_DISPATCH_ENABLED` y `OPERATIONAL_EMAIL_BATCH_ENABLED` únicamente para este piloto.

1. Crear una postulación de prueba mediante el flujo normal **después de la fecha de inicio**. No cambiar expedientes reales ni insertar eventos artificiales directamente en producción.
2. Entrar al portal de la cuenta de prueba, solicitar el código y confirmarlo desde el buzón. Una cuenta confirmada administrativamente no sustituye esta comprobación.
3. En el administrador, pulsar «Comprobar preparación del piloto». Si existe un evento reciente elegible, pulsar «Ejecutar piloto controlado».
4. Comprobar la recepción, nombre del remitente, contenido y cabeceras del mensaje. Revisar el historial. Una ejecución vacía no es una prueba de entrega.
5. Si aparece sending o unconfirmed, detener el piloto y revisar el proveedor y el buzón. No restablecer la fila a pending ni reenviar automáticamente.

### 3. Cierre del piloto y criterios de liberación

Registrar fuera del código, sin secretos ni datos personales, el commit realmente desplegado, fecha de prueba, aceptación SMTP, recepción observada, identidad de marca correcta y resultado del historial. No activar el despacho general si falta alguna evidencia o si hay envíos ambiguos sin resolver. La activación general y del programador es una operación separada, no una consecuencia automática de fusionar un PR.

Si hay que detener envíos, desactivar el programador, el procesamiento por lotes y el despacho. Mantener los registros existentes para conciliación; no borrar el esquema ni hacer backfill automático. Los correos de autenticación de Supabase conservan su configuración independiente.
