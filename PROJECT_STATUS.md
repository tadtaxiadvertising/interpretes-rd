# PROJECT_STATUS.md

## Fase 1 — Auditoría inicial del proyecto

**Fecha:** 2026-10-25  
**Repositorio:** `tadtaxiadvertising/interpretes-rd`  
**Rama de seguimiento:** `docs/update-project-status-ci-results`  
**Estado:** Corrección de pruebas integrada y validada por CI; pendiente revisar la señal de Vercel y ampliar la auditoría de scripts/E2E.

### Alcance y evidencia

Se revisaron estáticamente `package.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs` y `README.md` mediante GitHub. La validación ejecutable se obtuvo de GitHub Actions; no se afirma haber ejecutado comandos localmente en este entorno.

### Hallazgos y acciones

| Prioridad | Hallazgo | Estado | Acción / evidencia |
|---|---|---|---|
| Media | El README describía Next.js 16 para la aplicación principal, pero `package.json` declara Next.js 15.2.6 y `eslint-config-next` 15.2.6. | Corregido | Se actualizó la fila de `interpreters-os` en el README a Next.js 15.2.6. La versión del servicio API se dejó intacta porque no se verificó su manifiesto independiente. |
| Media | El script de lint usaba `next lint .` aunque el proyecto declara ESLint 9 y usa `eslint.config.mjs`. | Corregido y validado | Se cambió a `eslint .`. ESLint pasó en CI #551 y #552. |
| Alta | CI #549 falló en 4 pruebas del endpoint de creación de Roleplay: devolvían HTTP 500 cuando `revalidatePath` se ejecutaba fuera del contexto de Next.js. | Corregido e integrado | Se añadió un mock de `next/cache` en `src/app/api/admin/roleplays/__tests__/route.test.ts`; no se modificó el handler de producción. CI #551 y la ejecución sobre `main` #552 pasaron las pruebas y el build. |
| Media | `tsconfig.json` excluye `scripts`, `tests`, `e2e` y archivos de pruebas del chequeo TypeScript general. | Pendiente | Revisar esos ámbitos por separado antes de ampliar el alcance; scripts y E2E pueden requerir configuración propia. |
| Media | El estado externo de Vercel reportó fallo para el commit de merge, aunque GitHub Actions y sus tareas de despliegue finalizaron con éxito. | Pendiente de diagnóstico | La señal de Vercel asociada al commit `6887b5bef4ce9d8f957d4f04c7c2855c6b32ec5b` figura como `failure`. Revisar el detalle del despliegue en Vercel; no asumir que el sitio está desplegado correctamente por el éxito del build de CI. |
| Baja | No existía `PROJECT_STATUS.md` en la raíz durante la auditoría inicial. | Corregido | Se añadió este registro y se actualiza para reflejar resultados verificados. |

### Validaciones

- [x] Revisar la versión declarada de Next.js y corregir la discrepancia del README.
- [x] Cambiar el script de lint a `eslint .`.
- [x] Consultar CI #549 e identificar los cuatro fallos de Roleplay.
- [x] Aislar `revalidatePath` en la suite de pruebas sin alterar el código de producción.
- [x] CI #551 (PR #54): Prisma Validate, Prisma Generate, TypeScript, ESLint, pruebas y build finalizaron con éxito.
- [x] CI #552 sobre `main`: Prisma Validate, Prisma Generate, TypeScript, ESLint, pruebas y build finalizaron con éxito; los pasos de webhook de despliegue de los servicios `interpreters` y `interpreters-api` también finalizaron con éxito.
- [ ] Diagnosticar el estado `failure` de Vercel y comprobar el despliegue/URL activa.
- [ ] Revisar por separado la cobertura TypeScript de scripts, pruebas y E2E.
- [ ] Ejecutar/revisar E2E disponibles y documentar alcance real de cobertura.

### Criterio de cierre de Fase 1

La corrección inicial queda integrada y validada por GitHub Actions. No se considera terminada toda la auditoría: siguen pendientes el diagnóstico del estado externo de Vercel y la revisión de scripts/E2E excluidos del chequeo TypeScript general. El éxito del build no equivale a confirmar que el despliegue público funciona.
