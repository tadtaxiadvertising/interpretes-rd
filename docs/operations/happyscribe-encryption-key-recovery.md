# Intérpretes RD — Recuperación segura de HappyScribe / Audio Studio (HTTP 503)

## Síntoma
En administración, `GET /api/admin/happyscribe/transcriptions?page=0` devuelve 503 y el panel muestra `Falta AUDIO_STUDIO_ENCRYPTION_KEY (64 caracteres hexadecimales) en el servidor.`

## Dónde ocurre
- El endpoint está en `src/app/api/admin/happyscribe/transcriptions/route.ts` (Next.js).
- `src/lib/roleplay/happyscribe-settings.ts` lee `AUDIO_STUDIO_ENCRYPTION_KEY` únicamente del entorno de ejecución del servicio Next.js; requiere exactamente **64 caracteres hexadecimales** (32 bytes) y usa AES-256-GCM.
- El token del panel se almacena cifrado en la fila `public.system_configs` cuya clave es `audio_studio_happyscribe_token_v1`. Si esta fila existe, prevalece sobre `HAPPY_SCRIBE_API_TOKEN` (no hay fallback ante fallos de descifrado).
- El endpoint también exige token utilizable y un ID de organización numérico (panel o `HAPPY_SCRIBE_ORGANIZATION_ID`). Por tanto, 503 no demuestra por sí solo que la clave de cifrado sea la única configuración ausente.

## Recuperación sin exponer secretos
1. Identificar en Easypanel el **servicio Next.js** que ejecuta este dominio. No asumir que el servicio dedicado `api` contiene estas rutas.
2. Comprobar, sin imprimir valores, si el proceso Next.js recibe `AUDIO_STUDIO_ENCRYPTION_KEY` con longitud 64 y formato hexadecimal. Ejemplo para un entorno de Node autorizado:
   ```bash
   node -e 'const v=process.env.AUDIO_STUDIO_ENCRYPTION_KEY||""; console.log(/^[a-f0-9]{64}$/i.test(v)?"key-format-ok":"key-missing-or-invalid")'
   ```
   Si hay varios servicios/instancias Next.js, revisar todos: cada uno debe usar la **misma clave**.
3. **Antes de generar una clave**, averiguar si ya existe un token cifrado guardado desde el panel. Se puede comprobar solo la existencia del registro (nunca seleccionar/imprimir `value`). Si existe, recuperar la clave original desde el gestor de secretos/copias de configuración del despliegue. Una nueva clave **no descifra** el token anterior.
4. Solo en una instalación inicial **sin** token cifrado anterior, generar una clave aleatoria de 32 bytes en un equipo o gestor de secretos de confianza: `openssl rand -hex 32`. Guardarla en el gestor de secretos del entorno, y usarla como `AUDIO_STUDIO_ENCRYPTION_KEY` en el servicio Next.js. No ponerla en GitHub, logs, tickets, frontend/`NEXT_PUBLIC_*`, capturas ni mensajes.
5. Guardar variables y reiniciar únicamente el servicio Next.js mediante el procedimiento habitual de Easypanel. Evitar migraciones, reinicios globales o cambios en el worker/API dedicada. Confirmar que la instancia efectivamente recibió el secreto, sin revelar su contenido.
6. Entrar como administrador en **Roleplays → Configuración Audio Studio** y comprobar: `encryptionReady`, `credentialUsable`, `integrationEnabled`, fuente del token e ID de organización numérico. Solo después usar el chequeo privado de conexión y volver a solicitar la biblioteca de transcripciones.
7. Si la clave anterior está definitivamente perdida y existe un ciphertext, **detenerse**: coordinar rotación de credencial HappyScribe y sustitución controlada del registro cifrado, con respaldo, autorización y auditoría. No borrar la fila, no insertar texto plano, no sobrescribirla a ciegas y no forzar fallback silencioso a un token de entorno.

## Interpretación de fallos
| Situación | Acción segura |
| --- | --- |
| `encryptionReady=false` | Restaurar clave original del servicio Next.js (o crear una solo si es la primera configuración). |
| `encryptionReady=true`, `credentialUsable=false` y token de panel presente | Posible clave equivocada, ciphertext alterado o token vacío. No rotar automáticamente; verificar la clave original. |
| `credentialUsable=true` pero sigue 503 | Comprobar habilitación de integración e ID numérico de organización. Revisar logs categorizados sin exponer el token. |
| Error 502 upstream | Revisar token vigente, organización/permisos y conectividad con HappyScribe, sin imprimir respuestas privadas. |
| Error 429 | Respetar la limitación de consultas; no crear reintentos rápidos. |

## Comprobación de finalización
- El servicio Next.js reporta formato válido de la clave y el estado de panel confirma descifrado utilizable.
- La consulta administrativa funciona o ofrece un error de proveedor específico, no fallo de cifrado.
- Se valida que intérpretes/no administradores no tengan acceso a las rutas privadas.
- Se registra SHA desplegado y resultado **sin secretos**. CI verde no prueba el estado del proceso en Easypanel.
- Mantener `HAPPY_SCRIBE_MEDIA_PROXY_ENABLED` desactivado salvo prueba independiente y autorizada para evitar consumo innecesario del VPS.

Relación: incidencia #572 para rotación de token HappyScribe previamente expuesto. Nunca volver a usar ni compartir una credencial expuesta.
