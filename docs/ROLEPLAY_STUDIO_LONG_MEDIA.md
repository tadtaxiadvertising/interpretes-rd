# Roleplay Audio Studio — fuentes extensas (modo local)

## Objetivo

Preparar roleplays a partir de grabaciones largas de audio/video sin subir la
fuente original a Intérpretes RD ni decodificarla completa en el navegador.

Este flujo complementa, **no sustituye**, la exportación habitual de MP3
pequeños. El audio de pacientes/proveedores puede contener información sensible;
revisar consentimiento y anonimizar el contenido antes de publicar.

## Dos modalidades

| Modalidad | Archivo de entrada | Exportación |
| --- | --- | --- |
| MP3 normal | MP3 de hasta 15 MiB y 2 h | ZIP desde la API existente (servidor) |
| Preparación local | Audio/video compatible de hasta 8 GiB y 12 h | Proyecto JSON local; ZIP generado en el equipo con FFmpeg |

La reproducción de MP4, MOV, WebM, MKV, M4A, WAV, FLAC y demás formatos
**depende de los códecs del navegador**. Abrir un archivo por extensión no
garantiza que el navegador pueda reproducirlo. La función de cortes no
realiza transcripción ni separa automáticamente voces o idiomas.

En modo local no se invocan los endpoints de subida ZIP o detección de pausas.
La línea de tiempo conserva los marcadores y el zoom sin decodificar todo el
archivo. Para audios largos la onda completa no se genera: se usa una regla
temporal ligera.

## Preparación del proyecto

1. Abrir **Administración → Roleplays → Audio Studio** y seleccionar el
   video o audio **desde el propio equipo**.
2. Revisar sus subtítulos SRT/VTT (hasta 5 MB y 10.000 turnos de referencia
   en el modo local). La selección para el roleplay permanece en **25
   intervenciones máximo** y **15 minutos de audio acumulado**.
3. Marcar inicio y final, asignar roles e idiomas, excluir al intérprete
   original y revisar cualquier solapamiento.
4. Pulsar **Guardar proyecto JSON** (para seguir editando) o
   **Descargar plan local de cortes (JSON)** (tras validar los límites).
5. Conservar el archivo original y el JSON en un entorno privado.
   Los subtítulos no se incluyen en el JSON exportado.

El archivo de proyecto incluye título, tiempos, instrucciones para el
participante, duración y una **huella SHA-256 parcial** de tres muestras
de 128 KiB. La huella detecta muchos cambios accidentales, pero **no
equivale a un SHA-256 de todo el archivo** ni reemplaza un hash completo
en un entorno donde la integridad criptográfica es obligatoria.

## Generar el ZIP en el equipo (Windows / macOS / Linux)

En una máquina con Node.js compatible y una copia del repositorio:

```bash
npm ci --legacy-peer-deps
node scripts/export-studio-long-local.mjs \
  --source "/ruta/local/llamada.mp4" \
  --project "/ruta/local/roleplay-studio-proyecto-largo.json" \
  --output "/ruta/local/roleplay-studio.zip"
```

El script usa el FFmpeg incluido en `ffmpeg-static`. Para evitar subir videos
de varios GiB, el proceso lee **solo las tres muestras del archivo** para
verificar la huella del proyecto; después FFmpeg abre el archivo directamente
desde disco y extrae **solo los segmentos seleccionados**, convirtiendo la
primera pista de audio a MP3 mono de 24 kHz a 64 kbps.

Se rechazan cortes solapados, más de 25, fragmentos de más de 5 min,
acumulados superiores a 15 min, intervenciones marcadas como intérprete
original y rutas inválidas. El ZIP se genera con nombres fijos y con el mismo
`manifest.json` que la API de Audio Studio. No sobrescribe otro ZIP existente.

Los archivos MP3 temporales se almacenan en una carpeta privada bajo el
directorio temporal del equipo y se eliminan al terminar o producirse un
error. La grabación nunca sale del equipo mediante este script. Como en toda
herramienta local, los permisos sobre el archivo fuente y el ZIP final
dependen del sistema operativo y del usuario.

Una vez generado, utilizar **Crear roleplay → Importar ZIP** y asignar el
ejercicio; el administrador debe verificar los clips antes de publicar.

## Limitaciones reconocidas

- La interfaz web puede editar videos extensos, pero **no ofrece transcodificar
  un video de varios GiB directamente en el navegador**. La extracción MP3
  requiere ejecutar el script local en un equipo con Node.js. En móvil es
  posible preparar los cortes, pero la generación ZIP todavía no es nativa.
- La fuente debe poderse reproducir y buscar en el navegador para ajustar
  los límites. No existe degradación silenciosa: formatos no decodificables
  muestran error.
- El modo local evita almacenamiento de fuente en Supabase o Easypanel; sus
  costos de CPU y almacenamiento quedan en el dispositivo del administrador.
- Las grabaciones con pistas de audio múltiples utilizan la primera pista.
  Es necesario comprobar a oído que esta corresponde al material correcto.
- Los protocolos de interpretación son instrucciones visibles para el
  participante. No introducir transcripciones que revelen las respuestas.
- No se ha habilitado un pipeline remoto de carga reanudable, trabajos ni
  extracción asíncrona de videos grandes. Eso necesitará autenticación, cuotas,
  cifrado, almacenamiento privado temporal, caducidad y limpieza, y es una
  función aparte del flujo sin costo de servidor.
