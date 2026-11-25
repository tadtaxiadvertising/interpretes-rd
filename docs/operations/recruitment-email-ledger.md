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


### Alternativa: Brevo API (HTTPS)

En el servicio Next.js, puedes seleccionar Brevo en vez de SMTP mediante `OPERATIONAL_EMAIL_PROVIDER=brevo`, `BREVO_API_KEY`, `OPERATIONAL_EMAIL_FROM` y `OPERATIONAL_EMAIL_ENABLED=true`. `OPERATIONAL_EMAIL_REPLY_TO` es opcional. La clave se guarda únicamente en variables privadas del runtime, nunca en el repositorio ni en el chat. Genera una clave API con los permisos mínimos necesarios para correo transaccional; una clave SMTP no funciona como clave API. El remitente debe estar autorizado en Brevo. Mantén las cinco banderas de vinculación, despacho, lotes, modo general y programador en false durante la primera prueba. La aceptación HTTP 201 con messageId no certifica entrega; no se hace fallback ni reintento automático ante errores. Supabase Auth conserva su configuración SMTP independiente.


### Proveedores alternativos y límites gratuitos

El asistente de Configuración → Correos corporativos genera una plantilla sin secretos para Brevo, Resend o SMTP (incluido MailerSend). No cambia la configuración de producción por sí mismo. Para Resend, registra un dominio autorizado y configura `OPERATIONAL_EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `OPERATIONAL_EMAIL_FROM` y `OPERATIONAL_EMAIL_ENABLED=true`. El remitente puede ser diferente de Brevo; actualízalo con la dirección autorizada del nuevo proveedor. Conserva las claves de los otros proveedores solo en el runtime privado y utiliza el procedimiento de prueba manual con todas las banderas de despacho, lotes, vinculación, general y programador desactivadas. No cambies el SMTP de Supabase Auth con este procedimiento.

Consulta los límites actuales y el consumo total en las consolas de los proveedores, incluyendo envíos ajenos a esta aplicación. No se implementa aún un contador persistente ni un límite local de facturación. No habilites planes de pago ni sobreconsumo. La selección explícita afecta únicamente a nuevos intentos autorizados; no vuelvas a enviar eventos aceptados, en procesamiento o sin confirmar. En particular, Brevo puede mantener mensajes aceptados en cola al alcanzar el límite diario. Nunca uses un cambio de proveedor para eludir suspensiones, bloqueos, supresiones o condiciones de servicio. Los eventos siguen sujetos a la ventana de elegibilidad y a las comprobaciones de identidad del piloto.

### Perfiles privados de proveedores (fase inicial)

El almacén admite Brevo y Resend con claves cifradas AES-256-GCM, nonce aleatorio y contexto autenticado por ID y proveedor. Revisar e instalar por separado `docs/operations/proposed-email-provider-vault.sql`, verificar RLS y acceso exclusivo del rol de servidor. Configurar una nueva clave independiente de 32 bytes aleatorios (64 caracteres hexadecimales) en `EMAIL_PROVIDER_ENCRYPTION_KEY`, conservarla de forma segura y habilitar `EMAIL_PROVIDER_VAULT_ENABLED=true` únicamente después de comprobar la instalación. No reutilizar AUTH_SECRET ni AUDIO_STUDIO_ENCRYPTION_KEY. Perder o reemplazar la clave impide descifrar los perfiles existentes; no hay rotación automática. La única pantalla que recibe claves es el formulario dedicado del almacén, a través de HTTPS y una acción administrativa protegida; nunca se devuelven al cliente. No copiar claves a registros ni a GitHub.

Esta fase permite guardar y listar los perfiles y enviar una prueba explícita únicamente al remitente guardado; exige los cinco controles de despacho desactivados y mantiene un enfriamiento local al proceso. No cambia el proveedor activo, no modifica el ledger, no implementa presupuesto persistente ni autoriza envíos a intérpretes. El selector operativo y la reserva atómica de cuota quedan para la siguiente fase. SMTP personalizado permanece en variables de entorno, no se permiten hosts arbitrarios en este almacén.

### Presupuesto local persistente de perfiles guardados

Instala, después de la propuesta del almacén, `docs/operations/proposed-email-provider-quota.sql` en una sesión revisada. Verifica RLS, ausencia de permisos de los roles API y acceso SELECT/UPDATE del rol de servidor. Por defecto cada tipo de proveedor tiene un presupuesto conservador de 50 intentos diarios y 1000 mensuales (UTC); todos los perfiles del mismo tipo comparten el presupuesto. Una reserva atómica precede a cada prueba de perfil guardado, incluso en réplicas simultáneas. Si la cuota está agotada o no está disponible, no se realiza la solicitud de envío. No se reembolsan intentos fallidos o inciertos. El contador no incluye otros sistemas, SMTP de Supabase ni el proveedor operativo de entorno; no garantiza el saldo gratuito del proveedor. Mantener el plan sin sobreconsumo y comprobar sus límites reales. La activación operativa de perfiles y el presupuesto de despachos a postulantes permanecen pendientes.

### Preferencia verificada de proveedor

Instalar la propuesta `docs/operations/proposed-email-provider-selection.sql` después de las dos anteriores, revisar los permisos del rol de servidor para SELECT/UPDATE y RLS sin acceso API. El perfil debe tener una prueba aceptada y el administrador debe confirmar que recibió el mensaje. La confirmación es una atestación manual, no telemetría de entrega. Con los cinco controles de despacho explícitamente desactivados se puede elegir o quitar una única preferencia persistente, si queda presupuesto al momento de elegir. La reserva de cuota sigue siendo necesaria antes de cada envío. No se modifica el proveedor operativo de entorno; la integración con el transporte de reclutamiento y el tratamiento de cuotas antes del claim siguen pendientes. No se reintentan eventos aceptados o inciertos.
