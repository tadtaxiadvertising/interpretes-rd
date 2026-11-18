# Idempotencia de llamadas — despliegue por etapas (SIN aplicar)

Incidencia: [#634](https://github.com/tadtaxiadvertising/interpretes-rd/issues/634).
Objetivo: que **el mismo intento** de registrar una llamada Quick Log, reenviado
por error de red o desde otro proceso que conserve su clave, no produzca una
segunda sesión, segundo asiento ni nuevos minutos.

## AVISO — propuestas SQL, no migraciones ejecutables

Estos archivos se han retirado de `prisma/migrations/`, porque
`prisma migrate deploy` aplica automáticamente las migraciones pendientes
que encuentra allí, independientemente de los pasos explícitos de este
repositorio. Estar en `docs/operations/staged-sql/` significa que son
**propuestas para revisión**, no cambios autorizados para ejecutar. No
moverlos de nuevo a `prisma/migrations/` hasta haber aprobado la estrategia
de despliegue y la compatibilidad con el historial de Prisma.

**Atención:** si un entorno ejecutó las versiones anteriores antes de
moverlas, retirar los archivos del repositorio NO revierte el DDL ya
aplicado. Revisar solo con SQL de lectura `to_regclass` y el historial
`_prisma_migrations` antes de cualquier reconciliación; no borrar
tablas ni resolver migraciones automáticamente.

## Etapa 0: estructura aislada (este cambio)

- SQLs propuestos (ambos requeridos, en ese orden):
  `docs/operations/staged-sql/call-submission-idempotency.sql`
  y `docs/operations/staged-sql/call-submission-session-ownership.sql`.
  El primero crea la tabla; el segundo garantiza la correspondencia de
  intérprete y sesión. **No aplicar solo el primer SQL en producción.**
- Prueba en PostgreSQL descartable:
  `scripts/verify-call-submission-idempotency-migration.ts`.
- La tabla propuesta `public.call_submission_keys` asocia un UUID de solicitud
  a **exactamente una** `call_sessions.id` por intérprete. Una restricción única
  adicional impide asignar dos claves diferentes a la misma sesión.
- Las dos FKs **individuales** no bastan: sin una FK compuesta sería posible
  asociar el UUID del intérprete A con una llamada existente del intérprete B.
  El SQL adicional agrega la FK compuesta
  `(call_session_id, interpreter_id) → call_sessions(id, interpreter_id)`,
  apoyada por un índice único sobre esos dos campos. Esto también impide
  reasignar posteriormente el propietario de una sesión ya vinculada.
- `source` es un identificador controlado por el servidor. `payload_sha256`
  solo contiene el hash de un formato canónico versionado; **nunca** tokens de
  sesión, notas personales, nombres ni transcripciones.
- La tabla propuesta tiene RLS activado sin políticas de cliente directo,
  relaciones con `ON DELETE RESTRICT`, y **no** realiza backfill.
- **Esta etapa no modifica `prisma/schema.prisma` ni ninguna ruta runtime.**
  Es deliberado: un cliente Prisma generado con una columna nueva que aún no
  existe puede volver a provocar `P2022` en Easypanel. El SQL no está conectado
  a los jobs de migración o despliegue de producción.
- CI ejecuta el SQL y sus aserciones dentro de una transacción que hace
  `ROLLBACK` y rechaza URLs ajenas al PostgreSQL aislado.
  No se consulta ninguna base real.

## Etapa 0.5: contrato de solicitud revisable (SIN activar)

Los archivos `src/lib/call-submission-idempotency.ts` y
`src/lib/call-submission-idempotency.test.ts` preparan únicamente el
contrato **puro del servidor** para ambas variantes de Quick Log.
Ninguna ruta los importa todavía y no se introduce un cliente Prisma nuevo.

- `request_key` es un **UUIDv4** generado con aleatoriedad criptográfica
  para cada intento de llamada. Se normaliza a minúsculas, se conserva para
  reintentos de **ese** intento y no se deriva del reloj, del intérprete,
  de la duración ni de la tarifa.
- `payload_sha256` v1 es el SHA-256 UTF-8 de la tupla JSON, en este orden:
  `["interpretes-rd-call-submission",1,interpreterId,source,durationSeconds]`.
  El ID procede del usuario **autenticado**, `source` de la ruta del servidor
  (`quick_log_action` o `quick_log_api`) y `durationSeconds` es el
  entero final que se almacena, no el texto sin normalizar del formulario.
- Se rechazan valores fraccionarios, negativos, excesivos, IDs inválidos y
  fuentes no permitidas. Una solicitud de 1.5 minutos y otra de 90 segundos
  en la **misma ruta** generan idéntica huella (si el UUID es el mismo).
- La tarifa vigente y el instante de registro se excluyen del hash: pueden
  cambiar mientras se retransmite la misma solicitud, y el replay debe
  recuperar el **registro original**, no crear uno nuevo ni recalcular su
  importe. Tampoco se incorporan nombres, contraseñas, correos, notas,
  tokens, audio o transcripciones.
- Un UUID repetido con intérprete, fuente o duración distintos genera
  `CONFLICT`; un replay exacto se vincula al `callSessionId` original.
  El caso `NEW` de la función pura es solo orientativo: **no** autoriza
  una secuencia consulta→insert sin reserva única transaccional.
- El formulario administrativo **no** utiliza este contrato, ya que exige
  incluir su hora de inicio y otros campos en un formato canónico propio.

Este código no aporta idempotencia por sí solo. La integración efectiva exige
la tabla instalada y verificada, todas las escrituras contables en la misma
transacción, manejo de choques de clave mediante rollback y lectura posterior,
pruebas de concurrencia real y aprobación financiera.

## Etapa 1: autorización y aplicación del esquema (PENDIENTE)

Requiere revisión de integridad financiera, administrador de base de datos y
proceso formal de mantenimiento. Antes de iniciar, confirmar backup restaurable,
destino exacto de `DIRECT_URL` y TLS validado. No imprimir URLs de conexión,
credenciales, IDs de intérprete ni claves.

El operador debe inspeccionar **en solo lectura**:

```sql
SELECT current_database(), current_schema();
SELECT to_regclass('public.call_submission_keys') IS NOT NULL AS already_present;
SELECT to_regclass('public.call_sessions') IS NOT NULL AS calls_present;
SELECT to_regclass('public.interpreters') IS NOT NULL AS interpreters_present;
```

La tabla debe estar ausente antes de aplicar esta migración por primera vez.
Si aparece parcial, con otra definición o un historial incompatible, **detenerse**.
No ejecutar SQL con `IF NOT EXISTS` que enmascare una tabla alterada.

**No existe un comando de aplicación autorizado para estos borradores.**
El ejecutor `scripts/run-migration.ts` rechaza por diseño los archivos
ubicados en `docs/operations/staged-sql/`: sería incorrecto recomendar
`npm run migrate -- docs/operations/staged-sql/... --apply --transaction`.
No utilizar `prisma migrate deploy` para estos borradores ni mover los
SQL de vuelta a sus carpetas de migraciones sin una revisión previa.

Antes de decidir una aplicación, el DBA puede inspeccionar el esquema
existente sin modificarlo usando `DIRECT_URL` con TLS verificado:

```bash
npx tsx scripts/inspect-call-idempotency-schema.ts --check-only
```

El diagnóstico emite exclusivamente `absent`, `complete`, `partial` o
`history-drift` y una indicación de si hay entradas históricas de Prisma,
sin presentar identificadores de llamadas ni credenciales. Opera dentro de
`BEGIN READ ONLY` y ejecuta `ROLLBACK` antes de concluir. `--require-complete`
retorna fallo si falta el esquema, pero **no** lo instala ni lo repara.

`history-drift` incluye migraciones históricas marcadas como aplicadas
aunque el esquema esperado no exista, y **migraciones fallidas sin resolver**
(incluso si su DDL se revirtió). Este estado requiere atención DBA antes
de cualquier intento de aplicación; no ejecutar `prisma migrate resolve`
automáticamente. Un estado `complete` también exige que `created_at`
tenga su valor predeterminado temporal en PostgreSQL.

La verificación aislada del CI ejecuta el diagnóstico con una base descartable
sin el esquema instalado y espera `absent`. Esa prueba demuestra que el lector
funciona, **no acredita el estado de la base usada por Easypanel**.

Si la base ya contiene parte o todo el esquema, detenerse y planificar su
conciliación. Si la base está ausente, el equipo DBA debe diseñar y aprobar
una ruta ejecutable de mantenimiento, con respaldo restaurable, bloqueo
controlado, compatibilidad de `_prisma_migrations` y atestación de despliegue.
No aplicar un SQL de `docs/` por medios manuales improvisados. La verificación posterior debe
confirmar las dos FKs originales, la FK compuesta de pertenencia a intérprete,
la PK, la unicidad de sesión, los CHECKs, RLS y la ausencia de registros
históricos. Las migraciones no eliminan ni crean pagos.

**Impacto operativo del índice sobre `call_sessions`:** construir un índice
único de `(id, interpreter_id)` sobre todas las sesiones consume espacio y
tiempo; en una transacción DDL normal puede **bloquear inserciones o escrituras
concurrentes** mientras se crea. El DBA debe revisar el tamaño real y elegir
una ventana de mantenimiento con interrupción controlada o una preparación
`CREATE UNIQUE INDEX CONCURRENTLY` fuera de transacción, seguida de la
migración de FK adaptada y revisada. No ejecutar a ciegas ambos SQL contra
una base de producción de alta carga. Si el índice existe con definición
distinta o una primera aplicación fue parcial, detenerse y revisar drift:
no usar `IF NOT EXISTS` como reparador silencioso.

## Etapa 2: integración aplicativa (PENDIENTE — otro PR)

1. Tras verificar en producción el esquema y la versión desplegada, incorporar
   el modelo o consultas backend controladas, **sin** introducir una nueva
   dependencia de columnas en `CallSession`.
2. Generar un UUID impredecible por *intento de registro* en la interfaz y
   conservar **esa misma clave** durante un reintento de la misma operación.
   Una nueva llamada legítima recibe una clave nueva, aunque duración y tarifa
   coincidan. El servidor autentica el intérprete y nunca confía en un ID
   enviado por el cliente.
3. Calcular `payload_sha256` en el servidor desde una representación canónica
   y versionada (tipo de operación, intérprete autenticado, duración y demás
   parámetros que afectan el asiento). Una clave repetida con hash distinto
   debe responder **conflicto**, no reutilizar la llamada anterior.
4. Insertar `CallSession`, `ProductionLog`, `CallProductionEntry` y la
   asociación de clave **en la misma transacción Serializable**. Una
   violación de clave única debe deshacer el intento completo y, en una
   lectura posterior, devolver la respuesta anterior solo si coincide el
   digest. Un error `P2034` debe tener reintentos internos limitados o
   una respuesta de conflicto segura; nunca duplicar el asiento.
5. Probar carreras reales con dos conexiones PostgreSQL, replay con la misma
   clave, colisión de hash, fallo entre escrituras, autorización cruzada,
   nóminas cerradas y borrado restringido; también cortes de red simulados.
6. No activar una ruta idempotente cuando la tabla no esté verificada:
   devolver un error seguro sin escribir, en lugar de degradar silenciosamente
   a un registro sin protección.

## Límites

Un UUID por operación impide la duplicación **del mismo intento que reutiliza
su clave**. No es posible concluir que dos claves diferentes representan
la misma llamada por su duración u hora; podrían ser dos llamadas legítimas.
La auditoría agregada de [#706](https://github.com/tadtaxiadvertising/interpretes-rd/pull/706)
no autoriza eliminar ni fusionar sesiones.

El plazo de retención, las operaciones de borrado legítimo, el uso por otras
fuentes de llamadas y el tratamiento de una nómina ya liquidada requieren
aprobación de negocio. El estado de Easypanel debe atestarse por SHA antes de
activar la integración. `main` sigue pendiente de protección obligatoria
([#465](https://github.com/tadtaxiadvertising/interpretes-rd/issues/465)).
