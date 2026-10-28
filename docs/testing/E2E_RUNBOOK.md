# Ejecución segura de pruebas E2E

## 1. Preparar entorno aislado

1. Crear una base de datos exclusiva para pruebas; no reutilizar la base de desarrollo compartida ni producción.
2. Configurar variables en un archivo local ignorado por Git. Usar `E2E_DATABASE_URL` para la base E2E y no colocar secretos en esta guía.
3. Instalar dependencias con `npm ci`.
4. Aplicar migraciones únicamente a la base E2E con el mecanismo aprobado del proyecto.
5. Crear cuentas sintéticas mediante el mecanismo de seed de pruebas existente, una vez confirmados los enums/roles reales del esquema.
6. Arrancar la aplicación localmente en el puerto configurado y verificar manualmente que la URL apunta a localhost.

## 2. Variables de habilitación

Variables documentadas por la configuración actual de Playwright:

- `E2E_ALLOW_RUN=true`: habilita explícitamente la suite E2E.
- `BASE_URL=http://localhost:3001`: destino local por defecto.
- `E2E_ALLOW_REMOTE_TARGET=true`: solo para un staging aprobado, nunca para producción.
- `E2E_ALLOW_DB_CLEANUP=true`: habilita limpieza destructiva y requiere `E2E_DATABASE_URL` dedicado.
- `E2E_DATABASE_URL`: conexión exclusiva a la base E2E.
- `E2E_DATABASE_SSL=true`: habilita la configuración SSL prevista en el teardown cuando corresponda.

No activar limpieza destructiva hasta comprobar visualmente el host y nombre de la base. No configurar `DATABASE_URL` de producción en el proceso de prueba.

## 3. Comandos

```bash
npm ci
npx prisma validate
npx prisma generate
npm test
npm run lint
npx tsc --noEmit
E2E_ALLOW_RUN=true npm run test:e2e
```

El comando E2E solo debe ejecutarse después de configurar la base aislada y las credenciales de prueba. Si el proyecto requiere variables adicionales de autenticación o Supabase, obtenerlas del entorno local seguro; no copiarlas en este archivo.

## 4. Secuencia recomendada

1. Unitarias y lint.
2. Pruebas de autorización y propiedad de recursos.
3. Pruebas de persistencia de postulación y reanudación.
4. Pruebas de acuerdo vigente, aceptación, hash y cambio de versión.
5. Roleplay: elegibilidad, concurrencia, estados terminales y permisos.
6. Carga/descarga de documentos y controles de privacidad.
7. Flujos administrativos de edición/publicación con auditoría.
8. Regresión E2E completa por cada rol implementado.

## 5. Evidencia de ejecución

Por cada ejecución registrar: fecha, commit, versión de Node, comandos, resultado, número de pruebas, fallos y enlaces a logs sanitizados. No adjuntar cookies, tokens, contenido de acuerdos privados, datos personales reales ni capturas con información sensible.

## 6. Regla de no falsos positivos

Un comando no ejecutado no se marca como aprobado. Una prueba que no pudo ejecutarse por falta de variables se marca **BLOCKED** con la razón exacta. Un build exitoso no sustituye los checks de autorización, persistencia o pruebas E2E.
