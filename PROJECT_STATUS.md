# PROJECT_STATUS.md

## Fase 1 — Auditoría inicial del proyecto

**Fecha:** 2026-10-25  
**Repositorio:** `tadtaxiadvertising/interpretes-rd`  
**Rama de trabajo:** `chore/phase-1-project-audit`  
**Estado:** Auditoría estática inicial; pendiente de ejecución de CI y pruebas locales.

### Alcance y evidencia

Se revisaron `package.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs` y `README.md` en la rama predeterminada. La revisión fue estática mediante los archivos disponibles en GitHub; no se ejecutaron comandos de instalación, lint, TypeScript, pruebas, build ni despliegue.

### Hallazgos y acciones

| Prioridad | Hallazgo | Estado | Acción |
|---|---|---|---|
| Media | El README describía Next.js 16 para la aplicación principal, pero `package.json` declara Next.js 15.2.6 y `eslint-config-next` 15.2.6. | Corregido en esta rama | Se actualizó la fila de `interpreters-os` en el README a Next.js 15.2.6. La versión del servicio API se dejó intacta porque no se verificó su manifiesto independiente. |
| Media | El script de lint delegaba en `next lint .` pese a que el proyecto declara ESLint 9 y usa `eslint.config.mjs`. | Cambio aplicado; validación pendiente | Se cambió a `eslint .` para invocar el ejecutor ESLint directamente. Debe ejecutarse para confirmar compatibilidad y detectar diagnósticos reales. |
| Media | `tsconfig.json` excluye `scripts`, `tests`, `e2e` y archivos de pruebas del chequeo TypeScript general. | Pendiente de decisión | Revisar esos ámbitos por separado antes de ampliar el alcance; los entornos de test/scripts pueden necesitar configuración propia. |
| Baja | No existía `PROJECT_STATUS.md` en la raíz de la rama predeterminada durante la revisión. | Corregido en esta rama | Se añadió este informe inicial con alcance, hallazgos y validaciones pendientes. |

### Validaciones pendientes

- [ ] Instalar dependencias usando el lockfile del repositorio.
- [ ] Ejecutar `npm run lint` y registrar los errores reales.
- [ ] Ejecutar el chequeo TypeScript del proyecto.
- [ ] Ejecutar las pruebas unitarias y E2E disponibles.
- [ ] Ejecutar el build de producción con las variables de entorno necesarias.
- [ ] Revisar workflows de GitHub Actions y el estado de CI.
- [ ] Corregir errores confirmados y repetir las validaciones.

### Criterio de cierre de Fase 1

La fase solo se considerará validada cuando las comprobaciones aplicables se hayan ejecutado y sus resultados queden documentados. Los cambios de esta rama no implican que el proyecto haya pasado lint, pruebas o build; esos resultados aún no se han obtenido.
