# Roleplay Audio Studio — exportador local de escritorio

Herramienta **opcional y separada** de Intérpretes RD para convertir cortes de una grabación larga a un ZIP compatible con el importador de roleplays. El video/audio original, los tiempos del proyecto y los clips **se procesan exclusivamente en el equipo del administrador**. No abre puertos, no usa cuentas externas y no envía datos a servidores.

## Uso

1. En Audio Studio del administrador, abre el video/audio original, prepara las intervenciones y selecciona **Descargar plan local de cortes (JSON)**.
2. Descarga el ejecutable compilado correspondiente a Windows, macOS o Linux desde un **artefacto verificado de GitHub Actions**, una vez que un mantenedor haya ejecutado y revisado el empaquetado manual.
3. Abre **RoleplayStudioLocal**. Selecciona **Grabación original** y **Proyecto JSON**. Pulsa **Validar proyecto** para revisar, sin conversiones, el número de intervenciones y su duración total.
4. Elige una ruta nueva para **ZIP de salida** y presiona **Generar ZIP local**. La aplicación muestra el progreso, desactiva los campos durante el proceso y permite cancelar, eliminando temporales.
5. En Intérpretes RD, ve al formulario **Crear roleplay**, importa el ZIP y asígnalo al participante autorizado.

El usuario final **no necesita instalar Node.js ni escribir comandos** cuando utiliza el ejecutable empaquetado. El desarrollador sí necesita herramientas de compilación para construirlo.

## Límites y privacidad

- Entrada: MP3, M4A, WAV, AAC, OGG, FLAC, MP4, MOV, WebM y MKV hasta **8 GiB**; duración declarada del proyecto hasta **12 horas**.
- Proyecto: JSON de Audio Studio hasta 180 KB, con un máximo de **25 intervenciones** publicables.
- Cada corte: 0,1 s–5 min. Total por ZIP **15 minutos** de audio; ZIP final hasta **16 MiB**.
- Se verifica tamaño, formato y **huella SHA-256 de tres muestras** de la fuente, más una segunda comprobación al finalizar. **No es una huella de todo el archivo** y no detecta cualquier cambio fuera de las muestras.
- El ZIP contiene MP3 mono de 24 kHz / 64 kb/s, manifest.json y hashes SHA-256 completos de cada corte; se utiliza compresión STORE compatible con el importador.
- Se rechazan intervalos solapados, datos inválidos, intervenciones del intérprete original, cortes incompletos, fuentes sin audio y archivos ZIP existentes.
- En macOS y Linux, el ZIP se crea con permisos `0600` (lectura/escritura solo para su propietario), independientemente de los permisos habituales de archivos nuevos. En Windows, se utilizan las listas de control de acceso heredadas de la carpeta de destino: elige una carpeta privada del usuario.
- No realiza transcripción automática, traducción ni identificación biométrica. Revisa el consentimiento y excluye datos sensibles antes de publicar.

## Distribución (solo mantenedores)

Workflow manual: [roleplay-studio-desktop.yml](../../.github/workflows/roleplay-studio-desktop.yml).

Los pull requests ejecutan pruebas del exportador y **no publican ejecutables automáticamente**. Al lanzar workflow_dispatch después de revisar la rama, se producen:

| Plataforma | Archivo | Observación |
| --- | --- | --- |
| Windows | RoleplayStudioLocal-windows.zip | Aplicación sin firma Authenticode |
| macOS | RoleplayStudioLocal-macos.zip | App sin firma ni notarización |
| Linux | RoleplayStudioLocal-linux.tar.gz | Puede requerir bibliotecas gráficas/Tk |

Los artefactos de GitHub Actions pueden requerir autenticación y caducan según la retención. **El software todavía no está firmado ni notarizado**; pueden aparecer advertencias del sistema operativo. Verifica personalmente la procedencia del binario antes de distribuirlo.

Antes de redistribuir FFmpeg integrado, revisa y cumple las licencias, avisos de copyright y obligaciones de los códecs de la versión incluida. El empaquetado por PyInstaller no las elimina.

## Desarrollo opcional

Desde la raíz del repositorio, con Python 3.12+:

~~~sh
python -m pip install "imageio-ffmpeg==0.8.1"
python -m unittest discover -s tools/roleplay-studio-desktop -p 'test_*.py' -v
python tools/roleplay-studio-desktop/desktop_exporter.py
~~~

imageio-ffmpeg facilita un FFmpeg local empaquetable. En su defecto, la aplicación busca ffmpeg en PATH. Las pruebas fabrican un WAV sintético y un ZIP compatible, sin audio real ni acceso a red.

El exportador Node.js existente (scripts/export-studio-long-local.mjs) **se conserva como ruta de recuperación**. Ambos usan el mismo proyecto JSON, huella parcial, manifiesto y restricciones.
