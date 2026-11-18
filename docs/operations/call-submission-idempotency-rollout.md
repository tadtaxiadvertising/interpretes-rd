# Idempotencia de llamadas — despliegue por etapas (SIN aplicar)

Incidencia: [#634](https://github.com/tadtaxiadvertising/interpretes-rd/issues/634).
Objetivo: que **el mismo intento** de registrar una llamada Quick Log, reenviado
por error de red o desde otro proceso que conserve su clave, no produzca una
segunda sesión, segundo asiento ni nuevos minutos.

## Etapa 0: estructura aislada (este cambio)

- SQL propuesto:
  `prisma/migrations/20261118200000_call_submission_idempotency/migration.sql`.
- Prueba en PostgreSQL descartable:
  `scripts/verify-call-submission-idempotency-migration.ts`.
- La tabla propuesta `public.call_submission_keys` asocia un UUID de solicitud
  a **exactamente una** `call_sessions.id` por intérprete. Una restricción única
  adicional impide asignar dos claves diferentes a la misma sesión.
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

Solo después de autorización, el SQL se podrá aplicar con
`scripts/run-migration.ts --apply --transaction` y conexión directa protegida,
en un flujo operacional separado. La verificación posterior debe confirmar
las dos referencias, la PK compuesta, la unicidad de sesión, los CHECKs, RLS
y la ausencia de registros históricos. La migración no elimina ni crea pagos.

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
