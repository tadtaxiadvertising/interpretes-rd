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
| Dependencias Next.js/React | CI detectó Next.js 15.2.6 y React/React DOM 19.0.0 dentro de versiones afectadas por avisos de seguridad de React Server Components. | PR #70 integrado; run #40221301724 pasó `npm ci`, Prisma, TypeScript, ESLint, pruebas y build. Next.js/`eslint-config-next` quedaron en 15.2.9 y React/React DOM en 19.0.3. El inventario completo de vulnerabilidades npm restantes todavía requiere auditoría explícita. |

### Hallazgos activos

| Prioridad | Hallazgo verificado | Estado / siguiente acción |
|---|---|---|
| Alta | `package.json` declaraba `migrate:onboarding` apuntando a `scripts/migrate-onboarding.ts`, pero ese archivo no existe en `main`. | Corregido en PR #58: se eliminó el comando roto y se añadió `audit:onboarding` para ejecutar el script de auditoría existente; no se ejecutó SQL ni se tocó la base de datos. |
| Media | `tsconfig.json` excluye `scripts`, `tests`, `e2e` y archivos de prueba del chequeo TypeScript general. | Pendiente: diseñar chequeos separados que no incorporen indiscriminadamente scripts históricos o entornos con configuración distinta. |
| Media | `playwright.config.ts` define `baseURL` (por defecto `http://localhost:3001`) pero no configura `webServer`. El workflow de CI ejecuta `npm test`, no `npm run test:e2e`. | E2E no está integrado en el pipeline observado. Antes de activarlo hay que proporcionar servidor, variables y base de datos de prueba aislada. |
| Alta | El teardown E2E utilizaba DIRECT_URL/DATABASE_URL como fallback y borraba candidatos por prefijo de email sin consentimiento explícito ni garantía de base aislada. | PR #67 integrado; run #40220420100 pasó TypeScript, typecheck de auditoría, ESLint, pruebas unitarias y build. Playwright exige E2E_ALLOW_RUN=true; objetivos remotos exigen además E2E_ALLOW_REMOTE_TARGET=true; el borrado requiere E2E_ALLOW_DB_CLEANUP=true y E2E_DATABASE_URL, sin fallback a URLs generales. Añade escenario E2E con dos navegadores que envían la misma dirección en paralelo. La prueba aún requiere ejecución contra una base E2E aislada. |


### Evidencia de CI

- [x] PR #54 y run #552 sobre `main`: Prisma Validate, Prisma Generate, TypeScript, ESLint, pruebas unitarias y build en éxito.
- [x] PR #56: protección de carrera en inicio de Roleplay integrada; run #40217611657 con todas las etapas de validación en éxito.
- [x] PR #62: reporte de onboarding sin PII sensible y chequeo TypeScript dedicado; run #40218877726 en éxito.
- [x] PR #63: guardas de onboarding/estado de postulación en server action y API de inicio de Roleplay; run #40219055980 en éxito.
- [x] PR #65: bloquea cookies antiguas cuando la postulación ya no es elegible; run #40219373477 en éxito.
- [x] PR #67: endurece el teardown E2E y añade un escenario de postulación concurrente; run #40220420100 pasó validación, pruebas y build.
- [x] PR #68: permite reintentar Roleplay desde ROLEPLAY_REVIEW y devuelve la postulación a ROLEPLAY_PENDING antes de iniciar; run #40220906115 pasó validación, pruebas y build.
- [x] PR #70: parchea Next.js/React Server Components con versiones corregidas; run #40221301724 pasó validación, pruebas y build.
- [x] Añadir escenario E2E de dos navegadores que envían la misma postulación en paralelo (ejecución pendiente de entorno E2E aislado).
- [ ] Definir entorno E2E reproducible y ejecutarlo en CI sin usar datos de producción.
- [ ] Ejecutar `npm audit --json` sobre el árbol actualizado, clasificar las vulnerabilidades restantes y corregir las que correspondan sin aplicar actualizaciones mayores a ciegas.
- [ ] Extender el chequeo TypeScript dedicado a los scripts de mantenimiento restantes y configurar chequeos separados para tests/E2E.

### Criterio de cierre

La auditoría sigue abierta hasta que los chequeos E2E y de scripts sean reproducibles, y los caminos críticos de postulación, onboarding y Roleplay tengan pruebas de regresión adecuadas. El éxito del build por sí solo no acredita la integridad de los flujos de negocio.
