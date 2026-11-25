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

### Usar el perfil preferido en el piloto controlado

Después de instalar y comprobar las tres propuestas del almacén, configurar `EMAIL_PROVIDER_SOURCE=vault` en el frontend y conservar `EMAIL_PROVIDER_VAULT_ENABLED=true` y la clave privada existente. Con el despacho pausado, guardar el perfil, enviar la prueba, confirmar recepción y elegir preferencia. El origen vault no utiliza las credenciales de entorno como alternativa y no permite despacho general. Aplicar luego el procedimiento de piloto existente con un único destinatario autorizado y programador desactivado. Las pruebas del perfil, los códigos de verificación y los eventos de reclutamiento consumen el mismo presupuesto local por tipo de proveedor. La reserva del evento y su claim se confirman juntos; si no hay cuota o cambia la preferencia se revierte el claim y permanece pendiente. No hay reenvío automático de estados inciertos. La reserva de códigos puede consumir presupuesto aunque no se genere un código nuevo; se conserva de manera conservadora. No se garantiza el saldo real ni se contabilizan otros sistemas. Para cambiar de perfil, pausar primero todos los controles en todas las réplicas, verificar que no haya ejecución en curso, elegir el nuevo perfil y volver a preparar el piloto. Los intentos previamente comprometidos podrían finalizar; revisar el historial. El origen de entorno sigue siendo el predeterminado. No habilitar despacho general con el almacén hasta la siguiente fase.

### Ajustar los presupuestos desde el administrador

Instalar la propuesta adicional `docs/operations/proposed-email-provider-budget-audit.sql` después de las tablas del almacén, cuota y selección. Revisar el acceso del rol runtime: la auditoría necesita INSERT y SELECT de provider para RETURNING, sin UPDATE ni DELETE; los roles API no tienen acceso. El administrador puede ajustar los límites diarios y mensuales de Brevo o Resend con el despacho explícitamente pausado. Los máximos técnicos coinciden con las restricciones de la tabla (Brevo 300/9300, Resend 100/3000), no son una garantía de cuota gratuita real. Se debe elegir un presupuesto inferior al saldo real y mantener desactivado el sobreconsumo de pago. La actualización del límite y su auditoría se realizan en una sola sentencia y nunca restablecen los contadores ni modifican planes, claves o proveedor activo. Reducir el límite por debajo del consumo bloquea nuevas reservas hasta el siguiente periodo o una modificación posterior autorizada. Los envíos ya comprometidos no se cancelan. Las reservas y ediciones compiten por la misma fila; no se habilitan despachos generales.

### Reemplazar credenciales y desactivar perfiles

Instalar la propuesta adicional `docs/operations/proposed-email-provider-lifecycle.sql` después de las propuestas del almacén, cuota, selección y auditoría de presupuesto. Las acciones son administrativas y requieren todos los controles de despacho explícitamente desactivados en todas las réplicas y ninguna ejecución en curso. Desactivar un perfil conserva su registro histórico, evidencia y consumo; si estaba seleccionado, se elimina esa preferencia en la misma transacción. Reemplazar crea un perfil de identidad nueva y del mismo proveedor, conserva el anterior como histórico y exige una nueva prueba y confirmación de recepción. No hereda una preferencia ni reinicia el presupuesto compartido. Los perfiles históricos no se pueden seleccionar ni probar; no se revocan las claves en el proveedor externo y el secreto antiguo permanece cifrado en el registro histórico. Revocar externamente las claves obsoletas según el procedimiento del proveedor. Las reservas ya comprometidas podrían finalizar; revisar el historial antes de continuar. No se permiten cambios de tipo de proveedor mediante reemplazo; agregar un nuevo perfil en ese caso. No se habilita el despacho general.


### Puesta en servicio consolidada del centro de proveedores (instalación nueva)

Para una base que tenga las dos tablas de reclutamiento privadas existentes pero ninguna tabla de proveedores, utilizar exclusivamente `docs/operations/install-email-provider-center.sql`, que reúne las cinco propuestas anteriores en una transacción. No ejecutar además las propuestas por separado. El instalador rechaza instalaciones parciales o repetidas; no elimina objetos ni restablece contadores. Conserva la seguridad RLS y comprueba las tablas y secuencia de auditoría antes de confirmar. Los límites iniciales son 50 intentos diarios y 1000 mensuales por proveedor, sin perfil seleccionado.

1. Verificar que el commit con el instalador y el ciclo de vida de perfiles está validado en CI. Comprobar copia de seguridad disponible, proyecto y rol propietario; mantener todos los controles de despacho desactivados y sin ejecuciones pendientes. No modificar la configuración de autenticación de Supabase.
2. Revisar el estado previo mediante las consultas de metadatos de `docs/operations/check-email-provider-center.sql`. Si aparece alguna tabla de proveedores, no usar el instalador de cero.
3. Ejecutar el instalador en una sesión SQL administrativa del proyecto correcto, como propietario de las tablas privadas existentes. El script no concede permisos a roles de la API. Si el runtime no utiliza el propietario, revisar permisos/políticas específicos del rol de servidor antes de habilitar el almacén; no conceder acceso a anon, authenticated o service_role.
4. Ejecutar de nuevo las consultas de comprobación. Deben estar las cuatro tablas, todas con RLS, acceso API denegado, dos presupuestos iniciales y una selección vacía. El SQL de metadatos no certifica las credenciales del runtime.
5. En Easypanel, preparar **solo el servicio frontend interpreters**, no interpreters-api. Generar localmente una clave aleatoria independiente de 32 bytes, guardar su valor hexadecimal de 64 caracteres directamente en `EMAIL_PROVIDER_ENCRYPTION_KEY` y conservar copia segura. No compartirla en el chat ni sustituirla si ya existen perfiles. Configurar `EMAIL_PROVIDER_VAULT_ENABLED=true` con el origen anterior conservado inicialmente; mantener `OPERATIONAL_EMAIL_ENABLED=true` y los cinco controles de despacho en false. Desplegar únicamente el frontend con el commit validado y comprobar su estado.
6. En Configuración → Correos corporativos → Perfiles de proveedores guardados, pulsar Consultar perfiles. Si aparece Almacén disponible, crear un perfil autorizado, realizar una única prueba, comprobar su recepción y confirmar manualmente. Seleccionar la preferencia y seguir la sección de piloto anterior; para usarla en el piloto se requiere el opt-in de `EMAIL_PROVIDER_SOURCE=vault`. No activar el despacho general.

El instalador no envía mensajes, no contrata planes y no cambia el proveedor operativo. Un presupuesto local no garantiza el saldo del plan gratuito. No ejecutar un despliegue concurrente de otros servicios.

### Diagnóstico del almacén desde el frontend

En Configuración → Correos corporativos, pulsar Comprobar preparación del almacén. El diagnóstico de solo lectura funciona aun con el almacén desactivado y distingue instalación incompleta, permisos/RLS y disponibilidad de base de datos, formato de clave de cifrado, origen operativo y controles de pausa. Para el despliegue propietario actual verifica permisos efectivos de tabla y secuencia, ausencia de acceso API y RLS. Si el runtime utiliza un rol no propietario sometido a RLS, el diagnóstico exige revisión conservadora en vez de asumir que sus políticas permiten escribir. No conceder acceso a roles API ni desactivar RLS para resolver el diagnóstico. El formato de la clave no confirma descifrado ni la entrega externa. No se leen secretos guardados ni se envían mensajes.

### Ampliación a cinco proveedores

Después de validar el PR, aplicar explícitamente `docs/operations/proposed-email-provider-expansion.sql` a la instalación existente. Conserva las cuotas y perfiles de Brevo/Resend y agrega Mailjet, SMTP2GO y MailerSend con presupuestos locales conservadores de 50/día y 1000, 500 y 250/mes respectivamente. El formulario muestra los proveedores con presupuesto instalado; enlaces para crear cuenta, credenciales y autorizar remitente. Mailjet usa API Key como usuario SMTP y Secret Key como contraseña; los otros dos usan usuario y contraseña SMTP. Se cifran ambos juntos y el transporte usa únicamente hosts predefinidos, puerto 587 y TLS obligatorio. No se solicita host al administrador. Los perfiles API anteriores siguen siendo compatibles. Las pruebas, códigos y piloto comparten presupuestos; no se permite despacho general, reintentos ambiguos ni cambios de proveedor automáticos. Validar conectividad SMTP saliente del VPS y remitentes autorizados mediante prueba controlada; no se garantiza disponibilidad del plan gratuito. En modo env se conserva el comportamiento anterior.

### Pausa persistente del almacén

Después de validar este cambio, aplicar `docs/operations/proposed-email-vault-pause.sql` explícitamente. La instalación comienza pausada. El administrador puede consultar el estado, pausar nuevas reservas operativas del almacén y confirmar reanudación solo en modo piloto, sin scheduler, con perfil confirmado y presupuesto disponible. La pausa y la reserva se coordinan mediante el bloqueo de la fila de selección; una reserva ya comprometida puede terminar. No se cancelan envíos en curso ni se reintentan entregas inciertas. No controla el transporte de variables de entorno, las pruebas administrativas ni Supabase Auth. Mantener los controles de despacho del entorno desactivados durante las pruebas y cambios de perfiles; la pausa no sustituye ese procedimiento. El despliegue que espera la columna de pausa falla cerrado para envíos del almacén si la migración falta. No se habilita despacho general.

### Cambiar entre perfiles verificados desde el administrador

En modo almacén, después de instalar la pausa persistente, pausar despacho, esperar que terminen las reservas anteriores y revisar entregas inciertas. Consultar perfiles, elegir otro perfil con recepción confirmada y presupuesto disponible, o quitar preferencia. La preferencia se cambia bajo el mismo bloqueo de fila que la reanudación; la pausa permanece activa. Confirmar reanudación solo en modo piloto cuando sea apropiado. No hace falta cambiar las cinco variables de despacho para elegir otro perfil ya verificado en modo piloto. Crear pruebas, confirmar recepción, reemplazar/desactivar perfiles y editar presupuestos aún requieren los controles de mantenimiento de entorno. En modo de variables, se mantiene el requisito anterior. No cambia el proveedor externo automáticamente.

### Importar configuración API existente sin copiar la clave

Con el almacén habilitado, clave válida, origen de variables de entorno (o sin definir), cinco controles desactivados y pausa persistente activa, consultar perfiles en Configuración. Elegir Importar configuración existente y confirmar copia cifrada. Solo importa Brevo/Resend desde la configuración real del servidor, no permite enviar claves al navegador. No sobrescribe un perfil activo del mismo proveedor y remitente, no modifica variables, no selecciona el perfil y no hereda pruebas. Verificar recepción antes de seleccionar. No importar claves SMTP genéricas ni cambiar el origen operativo automáticamente.
