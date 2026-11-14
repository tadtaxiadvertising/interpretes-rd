# Auditoría del ZIP Roleplay Audio Studio — 13 Nov 2026

Fuente: ZIP entregado por el propietario, 85 entradas. Contiene aplicación React/Vite, Express, motor de audio y editor; no contiene una grabación de prueba. Este informe distingue código observado de funcionalidades verificadas.

## Arquitectura de integración

Intérpretes RD ya utiliza Next.js, Auth/RBAC, Supabase, exportación FFmpeg, importador SHA-256, biblioteca, asignaciones y sesiones de candidato/intérprete. El editor administrativo existente es /admin/roleplays/studio. Mantener una sola identidad, un único flujo de publicación y un único sistema QA; NO desplegar el servidor Express del ZIP.

## Incompatibilidades confirmadas

- El manifiesto externo roleplayAudioStudioVersion 1.0.0 utiliza turn/startTime/endTime/mp3File/speakerName/text/notes; el importador canónico utiliza order/title/file/sha256/script_prompt.
- El ZIP externo se genera mediante JSZip, puede contener compresión y pistas adicionales. El ZIP nativo solo admite el contrato STORE canónico. Descomprimir el ZIP externo y seleccionar manifest.json con MP3, sin afirmar soporte ZIP directo.
- El ZIP original puede contener clips, pistas por hablante y audio masterizado. Solo los clips individuales forman escenarios; el master no sustituye un clip faltante.
- El ZIP externo no lleva SHA-256 por archivo. El adaptador calcula SHA-256 sobre los bytes MP3, pero eso verifica integridad de subida, NO autenticidad del origen.

## Riesgos bloqueantes antes de portar servicios

1. Express server.ts expone las rutas de Happy Scribe y Gemini sin verificar administrador o identidad. La carga binaria acepta 200 MiB. No ejecutar este servidor en producción ni copiar sus endpoints directamente.
2. Las excepciones y algunas respuestas de proveedores se reflejan a navegador. Al integrar, ocultar detalles, sanear registros, aplicar límites de tiempo/tamaño, cuotas por usuario, auditoría y retención.
3. Las URL externas audio_url/signed_url/download_link se consumen con fetch en el servidor sin validación explícita del destino. Requiere validación estricta de hosts, redirecciones, tipo/tamaño y protección SSRF.
4. La asistencia Gemini mejora textos de segmentos, no demuestra que transcribió el audio. Sus resultados pueden inventar detalles, por lo que no deben convertirse automáticamente en respuestas QA ni transcripciones fidedignas.
5. La documentación vigente de Happy Scribe depreca POST /transcriptions y muestra organization_id, mientras el ZIP usa workspace_id en algunas peticiones. Integrar un cliente nuevo por la API soportada y verificar contra entorno de pruebas.
6. El código guarda audio/proyectos en IndexedDB e identidad de intérprete de ejemplo en localStorage. No copiar identidades de ejemplo ni datos clínicos a un almacenamiento compartido sin consentimiento y controles.
7. El texto, las notas y los nombres de hablantes del manifiesto pueden contener información médica identificable. Nunca exponerlos como título, guion del participante ni respuesta QA automáticamente.

## Compatibilidad implementada en esta rama

- Un adaptador valida el manifiesto externo y genera títulos neutrales de Intervención N con script_prompt vacío.
- Valida orden, tiempos, clips únicos, archivos auxiliares declarados y límites operativos. Rechaza archivos no declarados y MP3 de intervenciones ausentes.
- Reutiliza el importador canónico SHA-256 y el endpoint administrativo existente para publicar solo tras confirmar destinatarios. No crea sesiones ni modifica datos productivos.
- Mantiene intacta la importación de manifest.json y el ZIP STORE nativo.

## Fases siguientes

A. Portar incrementalmente simulador consecutivo, controles de repetición y perfiles de voz en componentes Next.js de práctica y editor; no tocar sesiones QA históricas.
B. Integración Happy Scribe/Gemini opcional solo administrador, bandera de función, API actualizada, consentimiento documentado, job asíncrono en worker y presupuesto de consumo. Evaluar borrado, anonimización y contratos de datos.
C. Versionar borradores privados de administración y registrar publicación/fuente; separar metadatos privados de guiones visibles a participantes.
D. Validar por CI tipos, lint, tests, build, E2E y pruebas contra paquetes reales; revisar RBAC de tres roles, despliegues Easypanel y smoke tests autenticados. Sin un paquete real exportado con MP3 no se afirma integración completa.

## Referencias verificadas

- Happy Scribe API v1: https://dev.happyscribe.com/sections/general/
- Happy Scribe Product API / deprecación: https://dev.happyscribe.com/sections/product/
- Gemini audio transcription: https://ai.google.dev/gemini-api/docs/transcribe
