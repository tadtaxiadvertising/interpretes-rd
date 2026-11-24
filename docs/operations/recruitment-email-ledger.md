# Registro de entrega de correos operativos

Estado: preparación técnica; no activado en producción.

El SQL propuesto permanece en docs/operations/proposed-recruitment-email-ledger.sql, fuera de las rutas de migración automática. No aplicar hasta revisar y probar contra PostgreSQL aislado con las funciones reales y permisos del rol de runtime. Verificar que el esquema privado no está expuesto por la Data API, y que roles públicos no pueden leer ni escribir registros.

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

El módulo de persistencia todavía no se invoca desde ninguna acción o tarea. La prueba SMTP existente sigue independiente.
