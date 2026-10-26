# PROJECT_STATUS.md

## Auditoría de arquitectura y flujos críticos

**Fecha de actualización:** 2026-10-26  
**Repositorio:** `tadtaxiadvertising/interpretes-rd`  
**Alcance:** CI, scripts de mantenimiento, postulación, onboarding, Roleplay, pruebas E2E y cobertura TypeScript.  

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
| Alta | El reintento desde `ROLEPLAY_REVIEW` devolvía la postulación a `ROLEPLAY_PENDING`, pero podía reutilizar una sesión anterior `SUBMITTED`/`FAILED` en vez de crear un nuevo intento. | Corregido en PR #93: cada reintento crea una nueva sesión y copia solo las definiciones de escenario; se bloquea mientras el evaluador mantiene la sesión en `UNDER_REVIEW`. CI del PR y de `main` en éxito. |
| Alta | El endpoint de carga de audio verificaba la propiedad de la sesión, pero no comprobaba que `scenarioId` perteneciera a ese `sessionId` antes de crear la ruta de almacenamiento y subir el archivo. | Corregido en PR #94: verifica la relación sesión/escenario antes de validar y subir audio; CI del PR en éxito. |
| Alta | `confirmBaseAudioUpload` solo verificaba rol administrativo y aceptaba una ruta de almacenamiento sin ligarla a la sesión objetivo. | Corregido en PR #97: verifica que la sesión exista y que la ruta sea una ruta base canónica de esa misma sesión antes de firmar o actualizar; CI en éxito. |
| Media | `/api/roleplay/convert-audio` permitía `audio/mpeg`, pero guardaba el archivo con extensión `.webm`; la extensión no reflejaba el formato real. | Corregido en PR #98: el MIME normalizado determina `.webm`, `.mp4`, `.ogg` o `.mp3`; pruebas de regresión para MPEG, OGG y MP4 añadidas. CI del PR y de `main` en éxito (run #40249380458). |
| Media | El contrato de onboarding estaba embebido en `OnboardingWizard.tsx` y la aceptación dependía de una constante, sin historial por versión. | Integrado en PR #103: modelos y migración `20261025_versioned_legal_agreements`, snapshot inicial del contrato, hash SHA-256, panel admin `/admin/legal-agreements` y comprobación de la versión exacta aceptada. CI de la rama #40252015965 y de `main` #40252264278 terminaron en éxito. La migración debe aplicarse antes de habilitar el flujo en otros entornos; no se ejecutó contra ninguna base de datos durante esta auditoría. |
| Alta | `confirmRoleplayResponse` podía sobrescribir una respuesta ya confirmada si el usuario reintentaba con otro audio; además, una repetición idéntica después de avanzar el índice podía rechazarse antes de comprobar la respuesta existente. | Corregido en PR #99: el reintento con el mismo audio es idempotente y no permite sustituirlo por otro. PR #100 alineó los fixtures; run #40249777848 y run de `main` #40250064586 terminaron en éxito. |
| Alta | El endpoint de audio podía sobrescribir el objeto de un escenario si dos cargas pasaban simultáneamente la guarda previa a la confirmación; la conversión MP3 también usaba una ruta de salida compartida por escenario. | Corrección en curso en `fix/roleplay-unique-upload-paths`: cada intento obtiene una ruta UUID con `upsert:false`; la conversión se encola solo después de confirmar la respuesta y actualiza únicamente la fila cuyo `sourceAudioPath` coincide. Añadidas regresiones para rutas únicas y conversión ligada al intento. Pendiente de CI y merge. |\n| Alta | La acción administrativa de edición bancaria marcaba `onboardingComplete=true` y `documentosCompleto=true` al guardar datos bancarios, aunque esa operación no demuestra que el usuario haya aceptado el acuerdo ni completado los documentos. | Corregido en PR #91: la edición administrativa solo sincroniza campos bancarios y no modifica `onboardingComplete` ni `documentosCompleto`. Se añadieron regresiones; run #40245776335 de `main` terminó en éxito; PR #92 sincronizó esta evidencia y documentó el contrato pendiente. |
| Alta | `package.json` declaraba `migrate:onboarding` apuntando a `scripts/migrate-onboarding.ts`, pero ese archivo no existe en `main`. | Corregido en PR #58: se eliminó el comando roto y se añadió `audit:onboarding` para ejecutar el script de auditoría existente; no se ejecutó SQL ni se tocó la base de datos. |
| Media | `tsconfig.json` excluye `scripts`, `tests`, `e2e` y archivos de prueba del chequeo TypeScript general. | Pendiente: diseñar chequeos separados que no incorporen indiscriminadamente scripts históricos o entornos con configuración distinta. |
| TypeScript de scripts operativos | Los scripts de auditoría/sincronización tenían comparaciones contra estados obsoletos de Roleplay, una selección Prisma inválida, detalles de identidad innecesarios en el reporte y una función de fecha inexistente. | PR #80 integrado; run #40224873397 pasó TypeScript general, typecheck de auditoría, typecheck de `scripts/**/*.ts`, ESLint, pruebas y build. También se alineó `mysql2` del lockfile con la dependencia exacta de Prisma. |
| Media | Las pruebas E2E de postulación no validaban correctamente la repetición del envío y el servidor standalone no servía los bundles de cliente. | PR #89 integrado: el workflow copia `.next/static` y `public` al output standalone. PR #90 integrado: la repetición se prueba desde un navegador separado sin cookie de propiedad. Run #40245321299 pasó todas las etapas, incluidas TypeScript, ESLint, tests, build y Playwright contra PostgreSQL aislado. |
| Alta | El teardown E2E utilizaba DIRECT_URL/DATABASE_URL como fallback y borraba candidatos por prefijo de email sin consentimiento explícito ni garantía de base aislada. | PR #67 integrado; run #40220420100 pasó TypeScript, typecheck de auditoría, ESLint, pruebas unitarias y build. Playwright exige E2E_ALLOW_RUN=true; objetivos remotos exigen además E2E_ALLOW_REMOTE_TARGET=true; el borrado requiere E2E_ALLOW_DB_CLEANUP=true y E2E_DATABASE_URL, sin fallback a URLs generales. Añade escenario E2E con dos navegadores que envían la misma dirección en paralelo. El run #40245321299 validó los E2E contra PostgreSQL aislado. |


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
- [x] Confirmar CI verde para las pruebas E2E de postulación concurrente/repetición segura. PR #90 integrado; run #40245321299 pasó el workflow completo, incluidas las pruebas Playwright aisladas.
- [x] Reintentos de confirmación de Roleplay: PR #99 + fixtures corregidos en PR #100; run #40249777848 del PR y run #40250064586 de `main` pasaron.\n- [x] Audio de Roleplay inmutable por intento: PR #105 integrado; rutas UUID y `upsert:false`; run #40253152000 y run de `main` #40253461449 en éxito.\n- [ ] Reducir los 11 avisos npm residuales tras PR #76: `@prisma/config`/`deepmerge-ts`/`mysql2`, `@vitest/ui`/`vitest`, `vite`, `zod`, `undici`, `fast-uri` y `esbuild`. Priorizar actualizaciones compatibles; evitar cambios mayores sin pruebas.
- [x] Añadir un chequeo TypeScript dedicado a todos los scripts `scripts/**/*.ts`; PR #80 integrado y CI #40224873397 en éxito. Se verificó en `main` que `prisma@7.10.1` declara `mysql2@3.24.4` y que `package-lock.json` bloquea exactamente `mysql2@3.24.4`.
- [x] Configurar Playwright para iniciar Next standalone y ejecutar E2E contra PostgreSQL efímero; PR #82 integrado. PR #89 corrigió la copia de assets standalone y PR #90 corrigió el escenario de repetición; run #40245321299 pasó completo.

### Criterio de cierre

La auditoría sigue abierta hasta que los chequeos E2E y de scripts sean reproducibles, y los caminos críticos de postulación, onboarding y Roleplay tengan pruebas de regresión adecuadas. El éxito del build por sí solo no acredita la integridad de los flujos de negocio.
 y aceptaba una ruta de almacenamiento sin ligarla a la sesión objetivo. | Corregido en PR #97: verifica que la sesión exista y que la ruta sea una ruta base canónica de esa misma sesión antes de firmar o actualizar; CI en éxito. |

| Alta | La acción administrativa de edición bancaria marcaba `onboardingComplete=true` y `documentosCompleto=true` al guardar datos bancarios, aunque esa operación no demuestra que el usuario haya aceptado el acuerdo ni completado los documentos. | Corregido en PR #91: la edición administrativa solo sincroniza campos bancarios y no modifica `onboardingComplete` ni `documentosCompleto`. Se añadieron regresiones; run #40245776335 de `main` terminó en éxito; PR #92 sincronizó esta evidencia y documentó el contrato pendiente. |
| Alta | `package.json` declaraba `migrate:onboarding` apuntando a `scripts/migrate-onboarding.ts`, pero ese archivo no existe en `main`. | Corregido en PR #58: se eliminó el comando roto y se añadió `audit:onboarding` para ejecutar el script de auditoría existente; no se ejecutó SQL ni se tocó la base de datos. |
| Media | `tsconfig.json` excluye `scripts`, `tests`, `e2e` y archivos de prueba del chequeo TypeScript general. | Pendiente: diseñar chequeos separados que no incorporen indiscriminadamente scripts históricos o entornos con configuración distinta. |
| TypeScript de scripts operativos | Los scripts de auditoría/sincronización tenían comparaciones contra estados obsoletos de Roleplay, una selección Prisma inválida, detalles de identidad innecesarios en el reporte y una función de fecha inexistente. | PR #80 integrado; run #40224873397 pasó TypeScript general, typecheck de auditoría, typecheck de `scripts/**/*.ts`, ESLint, pruebas y build. También se alineó `mysql2` del lockfile con la dependencia exacta de Prisma. |
| Media | Las pruebas E2E de postulación no validaban correctamente la repetición del envío y el servidor standalone no servía los bundles de cliente. | PR #89 integrado: el workflow copia `.next/static` y `public` al output standalone. PR #90 integrado: la repetición se prueba desde un navegador separado sin cookie de propiedad. Run #40245321299 pasó todas las etapas, incluidas TypeScript, ESLint, tests, build y Playwright contra PostgreSQL aislado. |
| Alta | El teardown E2E utilizaba DIRECT_URL/DATABASE_URL como fallback y borraba candidatos por prefijo de email sin consentimiento explícito ni garantía de base aislada. | PR #67 integrado; run #40220420100 pasó TypeScript, typecheck de auditoría, ESLint, pruebas unitarias y build. Playwright exige E2E_ALLOW_RUN=true; objetivos remotos exigen además E2E_ALLOW_REMOTE_TARGET=true; el borrado requiere E2E_ALLOW_DB_CLEANUP=true y E2E_DATABASE_URL, sin fallback a URLs generales. Añade escenario E2E con dos navegadores que envían la misma dirección en paralelo. El run #40245321299 validó los E2E contra PostgreSQL aislado. |


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
- [x] Confirmar CI verde para las pruebas E2E de postulación concurrente/repetición segura. PR #90 integrado; run #40245321299 pasó el workflow completo, incluidas las pruebas Playwright aisladas.
- [ ] Reducir los 11 avisos npm residuales tras PR #76: `@prisma/config`/`deepmerge-ts`/`mysql2`, `@vitest/ui`/`vitest`, `vite`, `zod`, `undici`, `fast-uri` y `esbuild`. Priorizar actualizaciones compatibles; evitar cambios mayores sin pruebas.
- [x] Añadir un chequeo TypeScript dedicado a todos los scripts `scripts/**/*.ts`; PR #80 integrado y CI #40224873397 en éxito. Se verificó en `main` que `prisma@7.10.1` declara `mysql2@3.24.4` y que `package-lock.json` bloquea exactamente `mysql2@3.24.4`.
- [x] Configurar Playwright para iniciar Next standalone y ejecutar E2E contra PostgreSQL efímero; PR #82 integrado. PR #89 corrigió la copia de assets standalone y PR #90 corrigió el escenario de repetición; run #40245321299 pasó completo.

### Criterio de cierre

La auditoría sigue abierta hasta que los chequeos E2E y de scripts sean reproducibles, y los caminos críticos de postulación, onboarding y Roleplay tengan pruebas de regresión adecuadas. El éxito del build por sí solo no acredita la integridad de los flujos de negocio.
