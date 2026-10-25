# PROJECT_STATUS.md

## Fase 1 — Auditoría inicial del proyecto

**Fecha:** 2026-10-25  
**Repositorio:** `tadtaxiadvertising/interpretes-rd`  
**Rama de trabajo:** `fix/roleplay-route-tests-revalidate-path`  
**Estado:** Corrección del fallo de pruebas de Roleplay aplicada; validación CI de la nueva rama pendiente.

### Alcance y evidencia

Se revisaron `package.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs` y `README.md` en la rama predeterminada. La revisión fue estática mediante los archivos disponibles en GitHub; no se ejecutaron comandos de instalación, lint, TypeScript, pruebas, build ni despliegue.

### Hallazgos y acciones

| Prioridad | Hallazgo | Estado | Acción |
|---|---|---|---|
| Media | El README describía Next.js 16 para la aplicación principal, pero `package.json` declara Next.js 15.2.6 y `eslint-config-next` 15.2.6. | Corregido en esta rama | Se actualizó la fila de `interpreters-os` en el README a Next.js 15.2.6. La versión del servicio API se dejó intacta porque no se verificó su manifiesto independiente. |
| Media | El script de lint delegaba en `next lint .` pese a que el proyecto declara ESLint 9 y usa `eslint.config.mjs`. | Cambio aplicado; validación pendiente | Se cambió a `eslint .` para invocar el ejecutor ESLint directamente. Debe ejecutarse para confirmar compatibilidad y detectar diagnósticos reales. |
| Alta | La ejecución CI #549 falló en 4 pruebas del endpoint de creación de Roleplay: recibían HTTP 500 en lugar de 200 porque `revalidatePath` se ejecuta sin el contexto de Next.js durante las pruebas. | Corrección aplicada; CI pendiente | Se añadió un mock de `next/cache` en `src/app/api/admin/roleplays/__tests__/route.test.ts`; la invalidación de caché real del handler no se modificó. Verificar la nueva ejecución CI antes de cerrar. |
| Media | `tsconfig.json` excluye `scripts`, `tests`, `e2e` y archivos de pruebas del chequeo TypeScript general. | Pendiente de decisión | Revisar esos ámbitos por separado antes de ampliar el alcance; los entornos de test/scripts pueden necesitar configuración propia. |
| Baja | No existía `PROJECT_STATUS.md` en la raíz de la rama predeterminada durante la revisión. | Corregido en esta rama | Se añadió este informe inicial con alcance, hallazgos y validaciones pendientes. |

### Validaciones pendientes

- [ ] Instalar dependencias usando el lockfile del repositorio.
- [x] Consultar los resultados de CI de la primera rama: Prisma Validate, Prisma Generate, TypeScript y ESLint pasaron; las pruebas fallaron en 4 casos de Roleplay.
- [x] Aplicar un mock de `next/cache` para aislar `revalidatePath` en las pruebas de la ruta Roleplay.
- [ ] Confirmar que las pruebas pasan en la nueva ejecución CI.
- [ ] Ejecutar el build de producción tras pasar las pruebas.
- [ ] Revisar el estado de CI y el resultado del build.
- [ ] Revisar por separado la cobertura TypeScript de scripts y E2E.

### Criterio de cierre de Fase 1

La fase solo se considerará validada cuando las comprobaciones aplicables se hayan ejecutado y sus resultados queden documentados. En la ejecución CI #549, Prisma Validate, Prisma Generate, TypeScript y ESLint pasaron; 364 de 368 pruebas pasaron y cuatro pruebas de Roleplay fallaron por `revalidatePath` sin contexto Next.js. Se añadió un mock específico en la rama correctiva. No se debe declarar la fase validada hasta que una nueva ejecución confirme las pruebas y el build.
