# Roleplay Audio Studio — integración incremental

## Estado del alcance
Esta rama incorpora una **primera fase funcional**, no la migración completa del código de Google AI Studio. El código fuente original de AI Studio aún no se ha importado ni auditado. El editor incluido es una implementación nativa limitada, con carga de MP3, escucha, anotación manual de cortes y exportación.

## Flujos por rol
- **Administrador**: `/admin/roleplays/studio` → seleccionar MP3 → definir intervenciones sin solapamientos → exportar ZIP → extraer `manifest.json` y MP3 → `/admin/roleplays/new` → importar, validar, escoger candidato o intérprete y crear la sesión. La ruta hereda el layout que exige rol administrativo; la API de exportación exige igualmente `validateAction('admin')`.
- **Intérprete**: `/dashboard/roleplays` muestra exclusivamente sesiones vinculadas al perfil autenticado; `/roleplays/[id]` conserva la autorización existente, grabación, autoevaluación y QA.
- **Candidato**: `/candidate` presenta exclusivamente la sesión asignada y respeta la máquina de estados del reclutamiento. No recibe el editor ni la API de exportación.
- **Biblioteca**: `/admin/roleplays/library` reutiliza sesiones ya publicadas y respeta el archivado histórico; esta fase no modifica sesiones históricas.

## Contrato de exportación
`POST /api/admin/roleplays/studio/export` recibe un MP3 y una lista JSON de intervenciones ordenadas. Valida tamaño del original (15 MiB), número de intervenciones (1–25), fronteras temporales, no solapamiento, duración por segmento (300 s), máximo de 900 s de audio agregado, texto de títulos/instrucciones y límites de respuesta. FFmpeg genera MP3 mono a 24 kHz/64 kbps. El ZIP contiene nombres seguros `segment-01.mp3`, etc., y `manifest.json` con `order`, `title`, `file`, `size_bytes`, `sha256`, `duration_limit_sec` y `script_prompt`, compatibles con el validador `prepareRoleplayManifestImport` existente.

No se graba el archivo fuente en Supabase ni se crea una sesión automáticamente. Publicación y asignación continúan dentro del endpoint administrativo actual, que vuelve a validar autorizaciones y hashes.

## Revisión e importación de subtítulos (PR #270)
- El estudio puede importar, **en el navegador del administrador**, un archivo SRT/WebVTT de hasta 1 MB.
- Detecta intervalos temporales y etiquetas sencillas de hablante, sin afirmar que identifica automáticamente idiomas ni voces.
- Los subtítulos originales permanecen solo como referencia visual local. El paquete exportado solo contiene `title`, marcas de inicio/fin (convertidas en MP3), límite e instrucciones redactadas por el administrador; la transcripción no se copia automáticamente a `script_prompt`.
- El administrador debe **excluir las intervenciones del intérprete original**, revisar todos los límites y retirar información identificable antes de crear un roleplay.
- Importar subtítulos sustituye la selección local previa de segmentos, pero nunca crea sesiones ni publica audios.
- Los botones de marca temporal y previsualización permiten escuchar únicamente una intervención.

## Límites y pendientes antes de considerar producción
1. **Pruebas**: comprobar build TypeScript, lint, tests, ZIP real generado y reimportación con el importador existente; hacer pruebas de RBAC (403 en la API para candidato, intérprete y anónimo). No declarar completado sin CI verde y ensayo de navegador.
2. **Protección de recursos**: evaluar límites por usuario (rate limiting, concurrencia), límite de tiempo de FFmpeg y memoria en Railway/Easypanel; una carga maliciosa o concurrencia excesiva podría agotar recursos del proceso Next.js. El procesamiento debe migrar al worker ya disponible antes de escalar.
3. **Privacidad**: no utilizar audios con datos de salud identificables sin autorización y política de tratamiento, retención y eliminación definidas. La herramienta no anonimiza automáticamente.
4. **Fase 2**: importar/auditar el proyecto original Google AI Studio; mapear diarización, transcripción, visualización de ondas, revisión EN/ES y simulación consecutiva a los contratos existentes sin crear otra base de usuarios.
5. **Fase 3**: proyectos editables persistentes y versionados, jobs asíncronos, previsualización y QA, pruebas E2E para tres roles, despliegue por bandera y rollback.
6. **Operación**: se mantiene Easypanel/worker y Supabase del proyecto; no se añade Vercel ni otro servicio.

## Verificaciones locales sugeridas
```bash
npm ci
npx prisma generate
npm run typecheck:audit
npm run lint
npm test -- --run
npm run build
```
