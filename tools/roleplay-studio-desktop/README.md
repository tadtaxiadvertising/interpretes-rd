# Roleplay Audio Studio — exportador local de escritorio

Herramienta **opcional y separada** de Intérpretes RD para convertir cortes de grabaciones cortas o largas a un ZIP compatible con el importador de roleplays. El video/audio original, los tiempos del proyecto y los clips **se procesan exclusivamente en el equipo del administrador**. No abre puertos, no usa cuentas externas y no envía datos a servidores.

## Uso

1. En Audio Studio del administrador, abre la grabación y prepara las intervenciones. Para MP3 cortos, el modo **Local (predeterminado)** genera un JSON sin subir audio; si se selecciona explícitamente **Servidor (opcional)**, el ZIP se genera en la plataforma mediante una transferencia del MP3. Para videos y fuentes extensas, solo se permite el modo local. Selecciona **Descargar plan local de cortes (JSON)**.
2. Descarga el ejecutable compilado correspondiente a Windows, macOS o Linux desde un **artefacto verificado de GitHub Actions**, una vez que un mantenedor haya ejecutado y revisado el empaquetado manual.
3. Abre **RoleplayStudioLocal** y pulsa **Elegir grabación + JSON (2 archivos)**. Puedes seleccionar los dos archivos a la vez. **Si eliges únicamente el JSON o la grabación**, la aplicación buscará en esa misma carpeta un único archivo complementario compatible (tamaño y huella SHA-256 de las muestras); si lo encuentra, rellena ambos campos sin abrir otro diálogo. Si no hay una coincidencia inequívoca, los archivos están en carpetas diferentes o la carpeta tiene demasiadas entradas, se abrirá el selector manual habitual. También puedes usar «Examinar…» para seleccionar cada archivo. La detección es opcional, local, limitada a una carpeta y nunca realiza búsquedas recursivas ni sube datos.
4. La aplicación propone automáticamente un nombre **ZIP disponible** en la misma carpeta del proyecto, sin reemplazar otros paquetes. Puedes cambiarlo si lo deseas. Pulsa **Generar ZIP local**: se vuelve a verificar que JSON y grabación coincidan antes de convertir. **Validar proyecto** es opcional y permite revisar previamente intervenciones y duración, sin transcodificar.
5. En Intérpretes RD, ve al formulario **Crear roleplay**, importa el ZIP y asígnalo al participante autorizado. Al terminar una exportación se propone un nombre libre para el siguiente paquete.

El usuario final **no necesita instalar Node.js ni escribir comandos para generar el ZIP** cuando utiliza el ejecutable empaquetado. La verificación de la descarga puede hacerla un administrador. El desarrollador sí necesita herramientas de compilación para construirlo.

## Unir intervenciones sin incluir silencios (proyectos v2)

En Audio Studio, coloca dos intervenciones consecutivas del mismo hablante e idioma y pulsa **Unir sin pausa**. Si entre ambas hay más de dos segundos, el editor crea **una intervención compuesta** en un proyecto **JSON versión 2**, con `ranges` que conservan únicamente los tramos seleccionados. «Escuchar unido» permite revisar el resultado; «Separar cortes» lo revierte a dos intervenciones.

**Generar ZIP local** con el exportador de escritorio actualizado o con el exportador Node.js actualizado: FFmpeg extrae ambos intervalos y los concatena a nivel de audio decodificado antes de codificar **un único MP3**. El ZIP generado sigue teniendo el formato y el manifest estándar que importa Intérpretes RD. No se incorpora el tramo intermedio ni se graba o sube el archivo original.

Los proyectos con `ranges` solo funcionan con los exportadores que aceptan **versión 2**; un exportador v1 debe rechazarlos. La plataforma fuerza la preparación local de proyectos compuestos, incluso si antes se había elegido el servidor. El exportador de servidor no soporta esta variante: la rechaza para evitar incluir silencios por error. El modo ordinario de una sola pieza mantiene proyectos **versión 1** y la exportación anterior.

Cada intervención compuesta admite **exactamente dos intervalos**, cada uno de al menos 0,1 s, con pausa estrictamente superior a 2 s y una duración **seleccionada** combinada de hasta 300 s. Se conserva un máximo de 25 intervenciones y 900 s seleccionados por ZIP.

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

Los pull requests ejecutan pruebas del exportador y **no publican ejecutables automáticamente**. Al lanzar workflow_dispatch después de revisar la rama, el paquete de cada sistema debe superar `--self-check`: **inicialización de Tcl sin pantalla, presencia de los scripts Tk/ttk del paquete (o framework nativo de macOS) y codificación efectiva de 0,25 segundos de silencio sintético con libmp3lame**. Esto verifica que el ejecutable incluya tanto la interfaz como el códec MP3 requerido sin acceder a grabaciones ni Internet. Después se producen:

| Plataforma | Archivo | Observación |
| --- | --- | --- |
| Windows | RoleplayStudioLocal-windows.zip | Aplicación sin firma Authenticode |
| macOS | RoleplayStudioLocal-macos.zip | App sin firma ni notarización |
| Linux | RoleplayStudioLocal-linux.tar.gz | Puede requerir bibliotecas gráficas/Tk |

Cada artefacto contiene ahora el archivo **`SHA256SUMS.txt`** junto con el ZIP/TAR.GZ del ejecutable. El workflow calcula su SHA-256 después de empaquetar y lo comprueba antes de subirlo. Puedes verificar la descarga desde una terminal, situándote en la carpeta de ambos archivos:

- **Linux:** `sha256sum -c SHA256SUMS.txt`
- **macOS:** `shasum -a 256 -c SHA256SUMS.txt`
- **Windows PowerShell:** `(Get-FileHash .\\RoleplayStudioLocal-windows.zip -Algorithm SHA256).Hash` y comparar el resultado (sin distinguir mayúsculas/minúsculas) con el código de `SHA256SUMS.txt`.

**La suma SHA-256 detecta archivos dañados o alterados con respecto al manifiesto descargado, pero no autentica al autor ni sustituye una firma digital.** Verifica que ambos archivos provienen del **mismo artefacto del workflow** [Roleplay Audio Studio - local desktop exporter](https://github.com/tadtaxiadvertising/interpretes-rd/actions/workflows/roleplay-studio-desktop.yml), que el commit corresponde al código revisado y que el job de empaquetado fue exitoso.

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
