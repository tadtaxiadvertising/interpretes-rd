# Correos de autenticación — Intérpretes RD

Plantillas de referencia para Supabase Auth. El SMTP corporativo se configura en el proyecto alojado; este archivo no modifica la configuración de producción ni dispara envíos. No se requieren cambios en Prisma, RLS, sesiones, registro ni Easypanel para usar estas plantillas.

## Antes de aplicar

1. En Supabase Dashboard → Authentication → Emails, comprobar que SMTP personalizado está habilitado, con nombre del remitente **Intérpretes RD** y una dirección que el proveedor autoriza. Usar TLS según el proveedor; guardar las credenciales únicamente en el panel seguro.
2. Respaldar los asuntos y el HTML actuales en almacenamiento privado. Verificar los enlaces de autenticación existentes: si usan `TokenHash`, una ruta propia, `RedirectTo`, o código OTP, conservar exactamente ese mecanismo; sustituir únicamente el texto y estilo. No cambiar la configuración de confirmación, dominios permitidos o expiración como parte de esta tarea.
3. Revisar Site URL y Redirect URLs contra el dominio real, sin comodines amplios en producción. Desactivar reescritura/seguimiento de enlaces de autenticación en el proveedor de correo. Si hay escáneres que consumen enlaces, evaluar un flujo de confirmación explícito con pruebas; no cambiar el mecanismo solo desde el HTML.
4. Copiar asunto y HTML de cada sección en el editor correspondiente. Para Magic link elegir solo la variante que coincide con el flujo ya implementado. Las plantillas de enlace de abajo asumen el mecanismo estándar `ConfirmationURL`, no sustituyen rutas propias. Las plantillas OTP no son intercambiables con enlaces.
5. Confirmar SPF, DKIM y DMARC según el proveedor y revisar los límites de envío. No enviar desde una dirección del postulante ni simular el remitente con encabezados no autorizados.

## Validación y reversión

- Usar una cuenta de prueba controlada y un buzón autorizado, no postulantes reales. Probar registro (si la confirmación está habilitada), reenvío, inicio de sesión según el mecanismo vigente y recuperación de contraseña; probar invitación y cambio de correo si se usan. Verificar que el enlace termina en el destino esperado y que la operación se completa. En recuperación, comprobar inicio de sesión con la nueva contraseña.
- Inspeccionar remitente visible y cabeceras Authentication-Results, SPF/DKIM/DMARC cuando corresponda, carpeta de spam y presentación móvil. No copiar enlaces, códigos, direcciones privadas o credenciales a issues ni logs.
- Revisar Auth Logs y el proveedor para rechazos, límites y rebotes. La ausencia de errores no prueba entrega.
- Si un flujo falla, restaurar su asunto y HTML previos y verificarlo de nuevo. Si SMTP falla, revisar las credenciales y proveedor sin deshabilitar controles de autenticación.
- Las notificaciones de negocio (postulación, entrevistas, etc.) son otro flujo; requieren integración de envío en servidor y autorización independiente. SMTP de Auth no las habilita automáticamente.

Referencias: [SMTP personalizado](https://supabase.com/docs/guides/auth/auth-smtp), [Plantillas](https://supabase.com/docs/guides/auth/auth-email-templates), [Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).

## Plantillas de referencia

### Confirm sign up

Asunto: Confirma tu cuenta | Intérpretes RD

```html
<!doctype html>
<html lang="es">
<body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#172033;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #dbe2ea;border-radius:12px;">
<tr><td style="padding:24px 24px 16px;border-top:4px solid #c62828;color:#163b70;font-weight:bold;font-size:20px;">Intérpretes RD</td></tr>
<tr><td style="padding:8px 24px 24px;line-height:1.6;font-size:16px;">
<h1 style="font-size:24px;line-height:1.3;color:#163b70;margin:0 0 16px;">Confirma tu cuenta</h1>
<p>Gracias por registrarte en Intérpretes RD. Confirma tu correo para continuar con el proceso de postulación.</p>
<p style="margin:24px 0;"><a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#163b70;color:#ffffff;padding:12px 20px;text-decoration:none;border-radius:6px;font-weight:bold;">Confirmar mi cuenta</a></p>
<p>Si no solicitaste esta operación, ignora este mensaje. Si tienes dudas, contacta a Intérpretes RD por sus canales oficiales.</p>
</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #dbe2ea;font-size:13px;color:#475569;">Intérpretes RD · República Dominicana</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
```

### Reset password

Asunto: Restablece tu contraseña | Intérpretes RD

```html
<!doctype html>
<html lang="es">
<body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#172033;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #dbe2ea;border-radius:12px;">
<tr><td style="padding:24px 24px 16px;border-top:4px solid #c62828;color:#163b70;font-weight:bold;font-size:20px;">Intérpretes RD</td></tr>
<tr><td style="padding:8px 24px 24px;line-height:1.6;font-size:16px;">
<h1 style="font-size:24px;line-height:1.3;color:#163b70;margin:0 0 16px;">Restablece tu contraseña</h1>
<p>Recibimos una solicitud para restablecer la contraseña de tu cuenta.</p>
<p style="margin:24px 0;"><a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#163b70;color:#ffffff;padding:12px 20px;text-decoration:none;border-radius:6px;font-weight:bold;">Restablecer contraseña</a></p>
<p>Si no solicitaste esta operación, ignora este mensaje. Si tienes dudas, contacta a Intérpretes RD por sus canales oficiales.</p>
</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #dbe2ea;font-size:13px;color:#475569;">Intérpretes RD · República Dominicana</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
```

### Invite user

Asunto: Tu invitación | Intérpretes RD

```html
<!doctype html>
<html lang="es">
<body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#172033;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #dbe2ea;border-radius:12px;">
<tr><td style="padding:24px 24px 16px;border-top:4px solid #c62828;color:#163b70;font-weight:bold;font-size:20px;">Intérpretes RD</td></tr>
<tr><td style="padding:8px 24px 24px;line-height:1.6;font-size:16px;">
<h1 style="font-size:24px;line-height:1.3;color:#163b70;margin:0 0 16px;">Te damos la bienvenida</h1>
<p>Has recibido una invitación para acceder a nuestra plataforma. Si esperabas esta invitación, acéptala para continuar.</p>
<p style="margin:24px 0;"><a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#163b70;color:#ffffff;padding:12px 20px;text-decoration:none;border-radius:6px;font-weight:bold;">Aceptar invitación</a></p>
<p>Si no solicitaste esta operación, ignora este mensaje. Si tienes dudas, contacta a Intérpretes RD por sus canales oficiales.</p>
</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #dbe2ea;font-size:13px;color:#475569;">Intérpretes RD · República Dominicana</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
```

### Magic link (solo flujo por enlace)

Asunto: Accede a tu cuenta | Intérpretes RD

```html
<!doctype html>
<html lang="es">
<body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#172033;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #dbe2ea;border-radius:12px;">
<tr><td style="padding:24px 24px 16px;border-top:4px solid #c62828;color:#163b70;font-weight:bold;font-size:20px;">Intérpretes RD</td></tr>
<tr><td style="padding:8px 24px 24px;line-height:1.6;font-size:16px;">
<h1 style="font-size:24px;line-height:1.3;color:#163b70;margin:0 0 16px;">Accede a tu cuenta</h1>
<p>Solicitaste un enlace para iniciar sesión. Utilízalo únicamente si tú realizaste esta solicitud.</p>
<p style="margin:24px 0;"><a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#163b70;color:#ffffff;padding:12px 20px;text-decoration:none;border-radius:6px;font-weight:bold;">Iniciar sesión</a></p>
<p>Si no solicitaste esta operación, ignora este mensaje. Si tienes dudas, contacta a Intérpretes RD por sus canales oficiales.</p>
</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #dbe2ea;font-size:13px;color:#475569;">Intérpretes RD · República Dominicana</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
```

### Magic link (alternativa para flujo OTP)

Asunto: Tu código de acceso | Intérpretes RD

```html
<!doctype html>
<html lang="es">
<body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#172033;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #dbe2ea;border-radius:12px;">
<tr><td style="padding:24px 24px 16px;border-top:4px solid #c62828;color:#163b70;font-weight:bold;font-size:20px;">Intérpretes RD</td></tr>
<tr><td style="padding:8px 24px 24px;line-height:1.6;font-size:16px;">
<h1 style="font-size:24px;line-height:1.3;color:#163b70;margin:0 0 16px;">Tu código de acceso</h1>
<p>Introduce este código en la pantalla de acceso de Intérpretes RD. No lo compartas con nadie.</p>
<p style="font-size:28px;font-weight:bold;letter-spacing:4px;color:#163b70;">{{ .Token }}</p>
<p>Si no solicitaste esta operación, ignora este mensaje. Si tienes dudas, contacta a Intérpretes RD por sus canales oficiales.</p>
</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #dbe2ea;font-size:13px;color:#475569;">Intérpretes RD · República Dominicana</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
```

### Change email address

Asunto: Confirma el cambio de correo | Intérpretes RD

```html
<!doctype html>
<html lang="es">
<body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#172033;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #dbe2ea;border-radius:12px;">
<tr><td style="padding:24px 24px 16px;border-top:4px solid #c62828;color:#163b70;font-weight:bold;font-size:20px;">Intérpretes RD</td></tr>
<tr><td style="padding:8px 24px 24px;line-height:1.6;font-size:16px;">
<h1 style="font-size:24px;line-height:1.3;color:#163b70;margin:0 0 16px;">Confirma el cambio de correo</h1>
<p>Recibimos una solicitud de cambio de dirección de correo para tu cuenta. Continúa únicamente si reconoces esta solicitud.</p>
<p style="margin:24px 0;"><a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#163b70;color:#ffffff;padding:12px 20px;text-decoration:none;border-radius:6px;font-weight:bold;">Confirmar cambio</a></p>
<p>Si no solicitaste esta operación, ignora este mensaje. Si tienes dudas, contacta a Intérpretes RD por sus canales oficiales.</p>
</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #dbe2ea;font-size:13px;color:#475569;">Intérpretes RD · República Dominicana</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
```

### Reauthentication

Asunto: Tu código de seguridad | Intérpretes RD

```html
<!doctype html>
<html lang="es">
<body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#172033;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #dbe2ea;border-radius:12px;">
<tr><td style="padding:24px 24px 16px;border-top:4px solid #c62828;color:#163b70;font-weight:bold;font-size:20px;">Intérpretes RD</td></tr>
<tr><td style="padding:8px 24px 24px;line-height:1.6;font-size:16px;">
<h1 style="font-size:24px;line-height:1.3;color:#163b70;margin:0 0 16px;">Verifica tu identidad</h1>
<p>Introduce este código en la pantalla donde lo solicitaste. No lo compartas con nadie.</p>
<p style="font-size:28px;font-weight:bold;letter-spacing:4px;color:#163b70;">{{ .Token }}</p>
<p>Si no solicitaste esta operación, ignora este mensaje. Si tienes dudas, contacta a Intérpretes RD por sus canales oficiales.</p>
</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #dbe2ea;font-size:13px;color:#475569;">Intérpretes RD · República Dominicana</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
```

