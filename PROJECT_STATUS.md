# PROJECT_STATUS.md

## Auditoría de arquitectura y flujos críticos

**Fecha de actualización:** 2026-10-25  
**Repositorio:** `tadtaxiadvertising/interpretes-rd`  
**Alcance:** CI, scripts de mantenimiento, Roleplay, pruebas E2E y cobertura TypeScript.  
**Nota:** El estado de Vercel queda fuera del alcance de esta auditoría, según la prioridad acordada.

### Cambios integrados

| Área | Hallazgo / cambio | Evidencia |
|---|---|---|
| Tooling | El script de lint se corrigió a `eslint .`, compatible con ESLint 9 y `eslint.config.mjs`. | CI #551 y #552 pasaron lint. |
| Pruebas de Roleplay | Se aisló `revalidatePath` con un mock de `next/cache` para ejecutar pruebas del endpoint fuera del runtime de Next.js. | CI #551 y #552 pasaron pruebas y build. |
| Inicio de Roleplay | Se protegió la transición de inicio con compare-and-set por ID y estado previo. Una solicitud concurrente no puede regresar una sesión terminal a `STARTED`; se agregó prueba de regresión. | PR #56 integrado; GitHub Actions run #40217611657: Prisma Validate, Generate, TypeScript, ESLint, tests y Build en éxito. |
| Propiedad de postulación | Se corrigió una vía por la que una postulación anónima sin prueba de propiedad podía crear/actualizar el registro vinculado de `interpreter` con datos enviados por el cliente. La sincronización ahora solo ocurre cuando la propiedad está verificada. | PR #59 integrado; run #40218312129: Validate & Test en éxito. Se añadió regresión en `src/app/actions/__tests__/recruitment.test.ts`. |
| Restricción del dashboard | El layout servidor del dashboard no aplicaba la decisión de acceso derivada de onboarding/Roleplay, aunque existía un router de destino. | PR #60 abierto; pendiente de CI. La corrección aplica la redirección en el layout compartido y añade pruebas para los destinos. |

### Hallazgos activos

| Prioridad | Hallazgo verificado | Estado / siguiente acción |
|---|---|---|
| Alta | `package.json` declaraba `migrate:onboarding` apuntando a `scripts/migrate-onboarding.ts`, pero ese archivo no existe en `main`. | Corregido en PR #58: se eliminó el comando roto y se añadió `audit:onboarding` para ejecutar el script de auditoría existente; no se ejecutó SQL ni se tocó la base de datos. |
| Media | `tsconfig.json` excluye `scripts`, `tests`, `e2e` y archivos de prueba del chequeo TypeScript general. | Pendiente: diseñar chequeos separados que no incorporen indiscriminadamente scripts históricos o entornos con configuración distinta. |
| Media | `playwright.config.ts` define `baseURL` (por defecto `http://localhost:3001`) pero no configura `webServer`. El workflow de CI ejecuta `npm test`, no `npm run test:e2e`. | E2E no está integrado en el pipeline observado. Antes de activarlo hay que proporcionar servidor, variables y base de datos de prueba aislada. |
| Media | El test E2E `e2e/recruitment-duplicate-submit.spec.ts` envía dos postulaciones secuenciales con el mismo correo; no simula dos peticiones simultáneas. El teardown elimina candidatos cuyo email coincide con el prefijo `e2e-dupesubmit-`. | Pendiente: añadir cobertura de concurrencia y garantizar que la limpieza solo opere sobre datos de prueba de un entorno aislado. |
| Media | `scripts/audit-onboarding.ts` calcula el estado de onboarding y consulta perfiles e intérpretes, pero los scripts quedan fuera de `tsc --noEmit`. | Pendiente: verificar tipos y compatibilidad de aliases/configuración para scripts antes de confiar en CI como validación de ese código. |

### Evidencia de CI

- [x] PR #54 y run #552 sobre `main`: Prisma Validate, Prisma Generate, TypeScript, ESLint, pruebas unitarias y build en éxito.
- [x] PR #56: protección de carrera en inicio de Roleplay integrada; run #40217611657 con todas las etapas de validación en éxito.
- [ ] Añadir pruebas de concurrencia reales para postulación duplicada.
- [ ] Definir entorno E2E reproducible y ejecutarlo en CI sin usar datos de producción.
- [ ] Establecer chequeo TypeScript para scripts y pruebas con configuración explícita.

### Criterio de cierre

La auditoría sigue abierta hasta que los chequeos E2E y de scripts sean reproducibles, y los caminos críticos de postulación, onboarding y Roleplay tengan pruebas de regresión adecuadas. El éxito del build por sí solo no acredita la integridad de los flujos de negocio.
