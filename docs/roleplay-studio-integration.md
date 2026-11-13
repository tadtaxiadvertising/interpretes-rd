# Roleplay Audio Studio — integración incremental

## Estado del alcance
Esta rama incorpora una **primera fase funcional**, no la migración completa del código de Google AI Studio. El código fuente original de AI Studio aún no se ha importado ni auditado. El editor incluido es una implementación nativa limitada, con carga de MP3, escucha, anotación manual de cortes y exportación.

## Flujos por rol
- **Administrador**: `/admin/roleplays/studio` → seleccionar MP3 → definir intervenciones sin solapamientos → exportar ZIP → `/admin/roleplays/new` → importar ZIP directamente (o su `manifest.json` + MP3 extraídos), validar, escoger candidato o intérprete y crear la sesión. La ruta hereda el layout que exige rol administrativo; la API de exportación exige igualmente `validateAction('admin')`.
- **Intérprete**: `/dashboard/roleplays` muestra exclusivamente sesiones vinculadas al perfil autenticado; `/roleplays/[id]` conserva la autorización existente, grabación, autoevaluación y QA.
- **Candidato**: `/candidate` presenta exclusivamente la sesión asignada y respeta la máquina de estados del reclutamiento. No recibe el editor ni la API de exportación.
- **Biblioteca**: `/admin/roleplays/library` reutiliza sesiones ya publicadas y respeta el archivado histórico; esta fase no modifica sesiones históricas.

## Contrato de exportación
`POST /api/admin/roleplays/studio/export` recibe un MP3 y una lista JSON de intervenciones ordenadas. Valida tamaño del original (15 MiB), número de intervenciones (1–25), fronteras temporales, no solapamiento, duración por segmento (300 s), máximo de 900 s de audio agregado, texto de títulos/instrucciones y límites de respuesta. FFmpeg genera MP3 mono a 24 kHz/64 kbps. El ZIP contiene nombres seguros `segment-01.mp3`, etc., y `manifest.json` con `order`, `title`, `file`, `size_bytes`, `sha256`, `duration_limit_sec` y `script_prompt`, compatibles con el validador `prepareRoleplayManifestImport` existente.

No se graba el archivo fuente en Supabase ni se crea una sesión automáticamente. Publicación y asignación continúan dentro del endpoint administrativo actual, que vuelve a validar autorizaciones y hashes.

## Revisión de subtítulos y protección de nombres
- El editor admite archivos SRT/WebVTT para preparar las marcas de tiempo sin enviar la transcripción al servidor.
- El contenido de cada intervención se muestra únicamente como referencia local del administrador; no se incorpora automáticamente a las instrucciones entregadas al participante.
- **Los nombres del campo hablante no se publican automáticamente.** Solo un vocabulario de roles no identificables (Doctor, Médico, Paciente, Enfermería, Intérprete y Operador, en español o inglés) puede convertirse en título; cualquier otro texto se sustituye por `Intervención N`. El administrador debe revisar y excluir las intervenciones del intérprete original.
- Esta medida no sustituye el proceso editorial de anonimización del audio fuente, que sigue siendo obligatorio antes de publicar.

## Importación ZIP directa (PR #271)
La creación administrativa acepta el ZIP STORE de Audio Studio sin extracción manual. El navegador valida la estructura ZIP (cabeceras locales y directorio central), los nombres permitidos, la ausencia de compresión, CRC32, conteo y tamaños. Luego **reutiliza el validador canónico** de `manifest.json` y SHA-256 para cada MP3. No se crea ninguna sesión hasta que el administrador elige destinatarios y confirma el formulario. Se conserva el mecanismo previo de importación de múltiples archivos.

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

## Editor de revisión visual y perfiles EN/ES (siguiente fase)
- Nueva línea de tiempo del Audio Studio con barras de onda PCM, marcadores visuales de todos los fragmentos y control accesible para buscar segundos exactos.
- El navegador calcula la forma de onda **localmente**, sin cargar audio adicional al servidor. Para evitar problemas de memoria solo decodifica grabaciones de hasta **4 minutos / 8 MiB**. En grabaciones más largas aparece una vista temporal simplificada que sigue permitiendo buscar, escuchar, marcar y exportar.
- Cada intervención puede etiquetarse manualmente como Doctor, Paciente, Enfermería, Operador, Intérprete original o Hablante sin identificar. Los idiomas son EN, ES o por revisar; **no se infiere automáticamente el idioma a partir del texto**, evitando falsas atribuciones.
- El archivo SRT/VTT puede excluir automáticamente las intervenciones con un perfil genérico exacto `Interpreter`/`Intérprete`. Los nombres no reconocidos permanecen por revisar; la revisión humana es obligatoria. Los fragmentos marcados como intérprete se bloquean al exportar.
- El administrador puede crear un título genérico con perfil e idioma, sin copiar nombres personales ni contenido clínico de la transcripción. Los campos de perfil/idioma son **metadatos editoriales** en esta fase: se expresan en el título al aplicarlos explícitamente y no modifican el esquema existente.
- El importador actual `manifest.json`/ZIP, RBAC, biblioteca, asignaciones y auditoría QA continúan siendo los puntos únicos de publicación y consumo.
- No se ha integrado todavía el motor de Google AI Studio: falta su código fuente exportado para un port preciso, y quedan pendientes diarización automática, transcripción autónoma, simulador consecutivo avanzado, proyectos editables persistentes y trabajo asíncrono en el worker.


## Proyectos editables portables (fase siguiente)
- Desde Audio Studio el administrador puede guardar un archivo `roleplay-studio-proyecto.json` con la selección de intervenciones, perfiles EN/ES, límites y las instrucciones que redactó.
- No se guarda el MP3, su nombre, los subtítulos de referencia, URLs de audio, identidad del usuario ni claves del sistema. El proyecto contiene únicamente el tamaño y **SHA-256** del MP3 para volver a asociarlo correctamente, junto con los metadatos editoriales.
- Para reabrir: seleccionar primero el MP3 original, esperar la lectura de duración, y cargar después el JSON. Se verifican formato, versión, campos, límites, tamaño y hash. Si el MP3 no coincide, no se modifica el borrador actual.
- Cambiar de MP3 o editar durante una importación asíncrona invalida el resultado anterior. No se modifica ningún roleplay ya asignado ni su grabación.
- **Advertencia:** aunque no guarda transcripciones ni audio, el JSON puede contener texto sensible que el administrador haya escrito en títulos o instrucciones. Debe almacenarse en un lugar seguro y no compartirse con participantes.
- Es una persistencia explícita y portable en archivo local, no una persistencia en Supabase. Proyectos colaborativos/versionados, historial de modificaciones y retención gestionada siguen pendientes.


## Selector de transcripciones largas para roleplays
- `parseTimedTranscriptForReview` puede leer hasta 500 turnos de un archivo SRT/WebVTT de hasta 1 MB (máximo 2 h de audio). Puede admitir solapamientos en la **referencia editorial**, pero nunca se aceptan cortes solapados en el paquete final.
- Cuando la transcripción contiene más de 25 turnos, solapamientos o más de 15 minutos de audio acumulado, no se publica ni se reemplaza el borrador automáticamente. Aparece una lista desplazable con marcas de tiempo, referencia de hablante genérica, texto local de subtítulos y botón para escuchar desde ese momento.
- El administrador elige como máximo 25 intervenciones y pulsa explícitamente **Aplicar selección al editor**. Se valida la selección, se comprueban límites de audio y se rellenan únicamente los escenarios elegidos.
- La lista de referencia no sale del navegador: tampoco se copia al JSON de proyecto ni a los participantes. Se continúa usando el mismo contrato de ZIP, SHA-256, biblioteca, asignaciones y QA.
- El límite de 500 turnos y 1 MB es intencional para contener memoria y tiempo de edición. Archivos mayores deben dividirse antes de importar; el desarrollo futuro contempla paginación/virtualización y procesamiento asíncrono en worker.


## Asistente de pausas con FFmpeg (sin transcripción ni coste por proveedor)
- El administrador puede pulsar **Detectar pausas del MP3** dentro de Audio Studio. El endpoint `POST /api/admin/roleplays/studio/silences` usa la misma autorización administrativa, cuota y FFmpeg del exportador, sin base de datos ni servicio externo.
- FFmpeg analiza temporalmente un MP3 de hasta 15 MiB (umbral de silencio -32 dB; duración mínima 0,65 s). Las únicas respuestas son segundos y duraciones de pausas, más avisos; **no se devuelven textos clínicos ni registros brutos del proceso**.
- Se establece límite de 45 s por procesamiento, una ejecución simultánea por proceso y tamaño máximo de salida de FFmpeg. Los audios con formato incorrecto o demasiados eventos se rechazan. El ejecutable se incluye explícitamente en el empaquetado standalone de esta nueva ruta.
- Las pausas producen posibles ventanas con voz (hasta 25 cortes, 5 minutos por intervención y 15 minutos totales). Se omiten turnos demasiado cortos o extensos; no se dividen frases automáticamente.
- El administrador escucha las pausas y debe pulsar **Reemplazar con cortes sugeridos** antes de modificar el borrador. Los campos de hablante e idioma permanecen **desconocidos** y los títulos son neutrales. Se exige revisión del intérprete original y la exportación canónica ZIP sigue siendo el único camino de publicación.
- La herramienta **no es diarización, no identifica idiomas y no transcribe**. Su ventaja es reducir marcas manuales sin presupuestos adicionales ni envíos del MP3 a terceros. El servidor procesa la solicitud en memoria y no persiste el audio.

