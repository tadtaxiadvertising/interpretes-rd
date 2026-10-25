# PROJECT_STATUS.md

## Auditoría de arquitectura y flujos críticos

**Fecha de actualización:** 2026-10-25  
**Repositorio:** `tadtaxiadvertising/interpretes-rd`  
**Alcance:** CI, scripts de mantenimiento, Roleplay, pruebas E2E y cobertura TypeScript.  

### Cambios integrados

| Área | Hallazgo / cambio | Evidencia |
|---|---|---|
| Tooling | El script de lint se corrigió a `eslint .`, compatible con ESLint 9 y `eslint.config.mjs`. | CI #551 y #552 pasaron lint. |
| Pruebas de Roleplay | Se aisló `revalidatePath` con un mock de `next/cache` para ejecutar pruebas del endpoint fuera del runtime de Next.js. | CI #551 y #552 pasaron pruebas y build. |
| Inicio de Roleplay | Se protegió la transición de inicio con compare-and-set por ID y estado previo. Una solicitud concurrente no puede regresar una sesión terminal a `STARTED`; se agregó prueba de regresión. | PR #56 integrado; GitHub Actions run #40217611657: Prisma Validate, Generate, TypeScript, ESLint, tests y Build en éxito. |
| Propiedad de postulación | Se corrigió una vía por la que una postulación anónima sin prueba de propiedad podía crear/actualizar el registro vinculado de `interpreter` con datos enviados por el cliente. La sincronización ahora solo ocurre cuando la propiedad está verificada. | PR #59 integrado; run #40218312129: Validate & Test en éxito. Se añadió regresión en `src/app/actions/__tests__/recruitment.test.ts`. |
| Restricción del dashboard | El layout servidor del dashboard no aplicaba la decisión de acceso derivada de onboarding/Roleplay, aunque existía un router de destino. | PR #60 integrado; run #40218577020 pasó validación, pruebas y build. La redirección se aplica en el layout compartido. |
| Inicio de Roleplay de candidatos | La server action y el endpoint directo podían iniciar Roleplay sin verificar onboarding o el estado de la postulación. | PR #63 integrado; run #40219055980 pasó validación, pruebas y build. Se añadieron guardas de identidad, onboarding y estado de aplicación con pruebas de regresión. |
| Privacidad del reporte de onboarding | El script de auditoría exponía datos personales y bancarios en logs/reporte, además de tener un contador serializado incorrectamente. | PR #62 integrado; run #40218877726 pasó Prisma Validate, Generate, TypeScript, typecheck específico del script, ESLint, pruebas y build. El reporte se limita a IDs internos y flags. |
| Cookies de Roleplay antiguas | Una cookie de sesión podía seguir intentando iniciar/reanudar Roleplay tras el cierre o avance de la postulación asociada. | PR #65 integrado; run #40219373477 pasó validación, pruebas y build. El endpoint vuelve a comprobar el estado de la postulación antes de permitir el inicio. |
| Seguridad Next.js/React/Image Optimization | El árbol inicial contenía Next.js 15.2.6 y React/React DOM 19.0.0 afectados por avisos de seguridad; el primer parche 15.2.9 no cubría avisos publicados después. | PR #70 y #74 integrados. Next.js/`eslint-config-next` 15.5.28, React/React DOM 19.0.3, SWC 15.5.28 y Sharp 0.35.5. Run #40222055963 pasó `npm ci`, Prisma, TypeScript, ESLint, pruebas y build; el audit dejó de reportar una vulnerabilidad crítica de Next. |
| PostCSS y source maps | El PostCSS anidado de Next y `source-map-js` tenían versiones vulnerables. | PR #76 integrado; run #40222588986 pasó `npm ci`, TypeScript, ESLint, pruebas y build. El override fija PostCSS 8.5.28 y `source-map-js` 1.2.2. El informe npm bajó a 11 hallazgos: 0 críticos, 7 altos, 3 moderados y 1 bajo. |
| Seguridad de pruebas E2E | El teardown podía usar las URLs generales y borrar candidatos por prefijo; la prueba de duplicados no simulaba concurrencia real. | PR #67 integrado; exige `E2E_ALLOW_DB_CLEANUP=true` y `E2E_DATABASE_URL`, bloquea la ejecución E2E por defecto y añade un escenario con dos navegadores. Aún requiere una base aislada para ejecutarse. |
| Reintento de Roleplay | El guard de elegibilidad bloqueaba el estado `ROLEPLAY_REVIEW` aunque el funnel permite reintentar. | PR #68 integrado; el candidato vuelve a `ROLEPLAY_PENDING` con un evento de auditoría antes de iniciar el nuevo intento. Run #40220906115 pasó validación, pruebas y build. |

### Hallazgos activos

| Prioridad | Hallazgo verificado | Estado / siguiente acción |
|---|---|---|
| Alta | `package.json` declaraba `migrate:onboarding` apuntando a `scripts/migrate-onboarding.ts`, pero ese archivo no existe en `main`. | Corregido en PR #58: se eliminó el comando roto y se añadió `audit:onboarding` para ejecutar el script de auditoría existente; no se ejecutó SQL ni se tocó la base de datos. |
| Media | `tsconfig.json` excluye `scripts`, `tests`, `e2e` y archivos de prueba del chequeo TypeScript general. | Pendiente: diseñar chequeos separados que no incorporen indiscriminadamente scripts históricos o entornos con configuración distinta. |
| TypeScript de scripts operativos | Los scripts de auditoría/sincronización tenían comparaciones contra estados obsoletos de Roleplay, una selección Prisma inválida, detalles de identidad innecesarios en el reporte y una función de fecha inexistente. | PR #80 integrado; run #40224873397 pasó TypeScript general, typecheck de auditoría, typecheck de `scripts/**/*.ts`, ESLint, pruebas y build. También se alineó `mysql2` del lockfile con la dependencia exacta de Prisma. |
| Media | Los E2E de postulación no alcanzan el encabezado de éxito tras enviar el formulario. Run #40241835919 confirma que Prisma, TypeScript, ESLint, pruebas unitarias y build pasan, pero ambos escenarios Playwright fallan esperando el encabezado de éxito. El intento previo de añadir `sslmode=disable` a la URL no bastó porque `src/lib/prisma.ts` fuerza un objeto SSL explícito en `pg.Pool`, que prevalece sobre el parámetro de URL. | PR #85 integró el arreglo de variable de test y `sslmode=disable` en `DATABASE_URL`; PR #86 integró la desactivación de TLS solo para hosts loopback, mantiene TLS en bases remotas y alinea `DIRECT_URL`. PR #87 ajustó la expectativa concurrente y el mensaje de reanudación, pero el run #40242408970 volvió a fallar: ambos E2E siguen sin alcanzar el resultado esperado. Los logs del run #40243391913 confirman que, tras hacer clic, el formulario permanece en el paso 1 sin mensajes de error ni éxito. La página se sirve desde `.next/standalone/server.js`, pero Next.js no copia `public` ni `.next/static` al directorio standalone por defecto; por tanto, los bundles cliente pueden faltar y no hidratar el formulario. PR #89 copia esos assets antes de iniciar Playwright; PR #88 añade diagnóstico adicional para confirmar el resultado. Pendiente CI verde. |
| Alta | El teardown E2E utilizaba DIRECT_URL/DATABASE_URL como fallback y borraba candidatos por prefijo de email sin consentimiento explícito ni garantía de base aislada. | PR #67 integrado; run #40220420100 pasó TypeScript, typecheck de auditoría, ESLint, pruebas unitarias y build. Playwright exige E2E_ALLOW_RUN=true; objetivos remotos exigen además E2E_ALLOW_REMOTE_TARGET=true; el borrado requiere E2E_ALLOW_DB_CLEANUP=true y E2E_DATABASE_URL, sin fallback a URLs generales. Añade escenario E2E con dos navegadores que envían la misma dirección en paralelo. La prueba aún requiere ejecución contra una base E2E aislada. |


### Evidencia de CI

- [x] PR #54 y run #552 sobre `main`: Prisma Validate, Prisma Generate, TypeScript, ESLint, pruebas unitarias y build en éxito.
- [x] PR #56: protección de carrera en inicio de Roleplay integrada; run #40217611657 con todas las etapas de validación en éxito.
- [x] PR #62: reporte de onboarding sin PII sensible y chequeo TypeScript dedicado; run #40218877726 en éxito.
- [x] PR #63: guardas de onboarding/estado de postulación en server action y API de inicio de Roleplay; run #40219055980 en éxito.
- [x] PR #65: bloquea cookies antiguas cuando la postulación ya no es elegible; run #40219373477 en éxito.
- [x] PR #67: endurece el teardown E2E y añade un escenario de postulación concurrente; run #40220420100 pasó validación, pruebas y build.
- [x] PR #68: permite reintentar Roleplay desde ROLEPLAY_REVIEW y devuelve la postulación a ROLEPLAY_PENDING antes de iniciar; run #40220906115 pasó validación, pruebas y build.
- [x] PR #70: parche inicial de Next.js/React Server Components; run #40221301724 pasó validación, pruebas y build.
- [x] PR #74: actualiza Next.js a 15.5.28 y Sharp a 0.35.5; run #40222055963 pasó validación, pruebas y build.
- [x] PR #76: corrige PostCSS y source-map-js; run #40222588986 pasó validación, pruebas y build. Audit: 11 vulnerabilidades sin críticas.
- [x] Añadir escenario E2E de dos navegadores que envían la misma postulación en paralelo (ejecución pendiente de entorno E2E aislado).
- [ ] Confirmar CI verde para las pruebas E2E de postulación concurrente/reanudación. Run #40241835919 falló por TLS, pero las correcciones integradas en PR #86 y #87 no resolvieron E2E: run #40242408970 sigue fallando en ambas pruebas. PR #89 prepara los assets estáticos en el servidor standalone; PR #88 añade diagnóstico de estado visible/HTTP para verificar la causa.
- [ ] Reducir los 11 avisos npm residuales tras PR #76: `@prisma/config`/`deepmerge-ts`/`mysql2`, `@vitest/ui`/`vitest`, `vite`, `zod`, `undici`, `fast-uri` y `esbuild`. Priorizar actualizaciones compatibles; evitar cambios mayores sin pruebas.
- [x] Añadir un chequeo TypeScript dedicado a todos los scripts `scripts/**/*.ts`; PR #80 integrado y CI #40224873397 en éxito. Se verificó en `main` que `prisma@7.10.1` declara `mysql2@3.24.4` y que `package-lock.json` bloquea exactamente `mysql2@3.24.4`.
- [x] Configurar Playwright para iniciar Next standalone y ejecutar E2E contra PostgreSQL efímero; PR #82 integrado. [ ] Cerrar la incidencia actual cuando el workflow de seguimiento pase completo.

### Criterio de cierre

La auditoría sigue abierta hasta que los chequeos E2E y de scripts sean reproducibles, y los caminos críticos de postulación, onboarding y Roleplay tengan pruebas de regresión adecuadas. El éxito del build por sí solo no acredita la integridad de los flujos de negocio.
