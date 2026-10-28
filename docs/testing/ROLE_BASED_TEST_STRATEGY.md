# Estrategia de pruebas por rol — Interpretes RD

**Objetivo:** verificar permisos, aislamiento de datos y flujo completo desde visitante/candidato hasta operación administrativa sin usar datos reales ni tocar producción.

## Reglas de seguridad del entorno

- Ejecutar primero pruebas unitarias y estáticas; no requieren servicios externos.
- Las pruebas E2E deben usar una base de datos dedicada, vacía o reiniciable y cuentas sintéticas.
- Nunca apuntar Playwright, seed o teardown a producción ni reutilizar `DATABASE_URL` como fallback para limpieza.
- Habilitar E2E explícitamente con `E2E_ALLOW_RUN=true`; para un destino remoto de staging, exigir autorización expresa y `E2E_ALLOW_REMOTE_TARGET=true`.
- La limpieza destructiva solo se permite con `E2E_ALLOW_DB_CLEANUP=true` y `E2E_DATABASE_URL` exclusivo de pruebas.
- No guardar contraseñas, tokens, datos bancarios, documentos de identidad ni datos médicos reales en fixtures, logs o capturas.
- Cada prueba de autorización debe comprobar tanto el acceso permitido como el rechazo (403/redirect/resultado equivalente) al acceder directamente a rutas y server actions.

## Roles que deben verificarse

| Rol / estado | Alcance esperado | Límites críticos |
|---|---|---|
| Visitante no autenticado | Landing, registro/inicio de sesión y páginas públicas | No leer dashboard, expedientes, acuerdos privados ni APIs protegidas |
| Candidato/postulante | Perfil propio, postulación persistente, onboarding y documentos/consentimientos propios, Roleplay cuando sea elegible | No ver ni modificar postulaciones ajenas; no saltar pasos bloqueantes ni iniciar Roleplay fuera de estado permitido |
| Intérprete habilitado | Su perfil, disponibilidad, actividad y recursos asignados según estado | No acceder a expedientes de candidatos ajenos ni a funciones administrativas |
| Intérprete con onboarding incompleto | Retomar el paso pendiente y ver su progreso | Sin acceso a áreas operativas restringidas hasta completar los requisitos |
| Revisor de Roleplay / QA | Cola y evaluaciones autorizadas, según permisos implementados | No cambiar roles, acceder a datos innecesarios ni autoaprobar su propio caso si el producto lo prohíbe |
| Reclutador / RR. HH. | Revisar candidatos y progresos que le correspondan | No modificar configuración global ni consultar información financiera innecesaria |
| Administrador | Configuración, usuarios, contenido y acuerdos versionados según permiso | Acciones críticas auditadas; no alterar evidencia de aceptación histórica |
| Cuenta deshabilitada / sesión vencida | Mensaje de estado y recuperación segura | Ningún acceso protegido; sesión revocada no debe revivir mediante cookies antiguas |

> Antes de implementar automatización, confirma en el código los nombres reales de roles y permisos. No inventar roles nuevos en la base de datos para que coincidan con esta matriz: adapta la matriz a los roles implementados.

## Matriz de casos de aceptación

| ID | Rol | Escenario | Resultado esperado | Prioridad |
|---|---|---|---|---|
| AUTH-01 | Visitante | Abre una ruta protegida directamente | Redirección o rechazo; no se renderiza información privada | P0 |
| AUTH-02 | Candidato | Intenta leer/editar el ID de otro candidato | Rechazo sin filtrar si el registro existe | P0 |
| AUTH-03 | Intérprete | Invoca endpoint de administrador manualmente | 403/denegación equivalente | P0 |
| AUTH-04 | Sesión revocada | Reutiliza cookie antigua para iniciar Roleplay | Rechazo y no se crea transición de estado | P0 |
| APP-01 | Candidato | Inicia postulación y guarda datos parciales | Datos propios persisten al cerrar sesión y volver | P0 |
| APP-02 | Candidato | Reenvía formulario o repite una petición | Operación idempotente; no crea duplicados | P1 |
| APP-03 | Candidato | Intenta avanzar sin completar requisito obligatorio | Se mantiene en el paso pendiente con mensaje accionable | P0 |
| ONB-01 | Candidato | Retoma onboarding incompleto | Reanuda desde el paso correcto; no vuelve a pedir datos ya guardados | P0 |
| ONB-02 | Candidato | Acuerdo vigente no disponible | Error claro y recuperable; no acepta un acuerdo inexistente | P0 |
| LEG-01 | Candidato | Visualiza acuerdo publicado | Contenido y versión se muestran completos y legibles | P0 |
| LEG-02 | Candidato | Acepta acuerdo | Se registra versión, hash del contenido, identidad y fecha/hora | P0 |
| LEG-03 | Candidato | El acuerdo cambia después de la aceptación | Aceptación anterior permanece inmutable; nueva versión requiere nueva aceptación | P0 |
| LEG-04 | Admin | Crea borrador y lo publica | Borrador no visible como vigente; publicación crea versión trazable | P0 |
| LEG-05 | Usuario | Repite aceptación de la misma versión | No duplica evidencia si existe restricción de unicidad aplicable | P1 |
| RP-01 | Candidato elegible | Inicia Roleplay | Transición válida y sesión asociada a su identidad/postulación | P0 |
| RP-02 | Candidato no elegible | Intenta iniciar Roleplay por UI y API | Ambas vías bloqueadas | P0 |
| RP-03 | Dos solicitudes concurrentes | Inicia Roleplay simultáneamente | Una sola transición válida; estados terminales no se reabren accidentalmente | P0 |
| RP-04 | QA | Evalúa audio/resultado | Evaluación se persiste y queda vinculada al intento correcto | P0 |
| DOC-01 | Candidato | Carga documento permitido | Validación de tipo/tamaño, almacenamiento privado y estado visible | P0 |
| DOC-02 | Otro usuario | Intenta descargar documento ajeno | Denegado; URL no expone archivo público | P0 |
| ADM-01 | Admin | Modifica contenido de onboarding | Cambios versionados o auditados; candidato ve la versión aplicable | P1 |
| ADM-02 | No admin | Intenta modificar contenido/configuración | Denegado por servidor, no solo oculto en UI | P0 |
| PRIV-01 | Cualquier rol | Error de aplicación ocurre | Logs sin contraseñas, tokens, datos bancarios ni contenido sensible | P0 |
| OPS-01 | Admin autorizado | Deshabilita usuario | Acceso protegido cesa sin demora y la sesión no se reutiliza | P0 |

## Cobertura de prueba requerida

1. **Unitarias:** validadores, transiciones de estado, autorización, hash de acuerdos, lógica de elegibilidad.
2. **Integración:** server actions y endpoints con Prisma mockeado o base aislada; comprobar persistencia y errores.
3. **E2E:** flujos de navegador por rol con fixtures sintéticos.
4. **Seguridad:** IDOR/BOLA, escalada horizontal/vertical, acceso directo a APIs, cookies obsoletas, CSRF cuando aplique, carga/descarga de archivos.
5. **Regresión:** ejecutar las pruebas existentes de onboarding, Roleplay, acuerdos y propiedad de postulación después de cualquier cambio relacionado.
6. **Accesibilidad/usabilidad:** navegación por teclado, etiquetas, mensajes de error, estados de carga/vacío, móvil y evitar pedir datos ya guardados.

## Criterio de salida

- Todos los casos P0 pasan en entorno aislado.
- No existen secretos ni datos personales reales en fixtures o artefactos.
- `npm test`, `npm run lint`, `npx tsc --noEmit` y `npm run test:e2e` se ejecutan con resultados registrados; no afirmar éxito si no se ejecutaron.
- Los fallos conocidos se documentan con ID, pasos de reproducción y evidencia sin datos sensibles.
- Ningún cambio de contrato se publica ni se marca vigente sin aprobación jurídica y revisión de hash/versionado.
