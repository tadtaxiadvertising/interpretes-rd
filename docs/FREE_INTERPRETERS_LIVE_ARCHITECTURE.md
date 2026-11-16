# Free Interpreters Live — arquitectura local-first

## Decisiones aprobadas

- Equipos: `all`. La interfaz debe degradarse progresivamente según la capacidad real del navegador y del dispositivo.
- Privacidad: `optional`. El procesamiento local es la ruta predeterminada. Un proveedor remoto solo se habilita tras una elección y consentimiento explícitos, separados por finalidad.
- Distribución: `web`. La primera entrega vive dentro de Next.js; no requiere instalación de escritorio.

## Objetivo económico

Objetivo: coste variable de inferencia de Free Interpreters cercano a cero. No enviar audio a infraestructura propia por defecto. Esto no elimina los costes de hosting, mantenimiento, desarrollo, distribución de modelos y soporte.

## Límites de confianza

1. El navegador captura audio con permiso explícito.
2. Audio, transcripciones, traducciones, glosarios e historial se mantienen en el dispositivo por defecto.
3. No se guardan grabaciones ni se inicia una transcripción automáticamente.
4. Una integración remota exige consentimiento específico para proveedor y finalidad; no se reutiliza consentimiento de transcripción para traducción.
5. Las claves de proveedor no se envían al servidor Free Interpreters. Una clave en almacenamiento web sigue expuesta a código ejecutado en el mismo origen; preferir OAuth oficial cuando exista y no persistir secretos en localStorage.
6. Los datos sincronizados a la cuenta serán opt-in, con selección por tipo de dato, retención y borrado.
7. El producto es asistencia al intérprete, no sustituto del juicio profesional ni garantía de exactitud clínica o jurídica.

## Capas

- **Web UI:** `src/app/live`; acceso a los perfiles administrador e intérprete autenticados (no candidato), enlazado desde el menú de ambos roles. La ruta independiente muestra un enlace de regreso al panel correspondiente.
- **Core:** contratos de proveedores, detección de capacidades y ciclo de vida de audio en `src/modules/live-engine/core`.
- **ASR local (experimental):** adaptador Web Speech estrictamente on-device con comprobación e instalación voluntaria de paquetes de idioma ES/EN. Se solicita calidad `dictation` para frases prolongadas; si el navegador carece de ese paquete o nivel de calidad se informa indisponibilidad, sin fallback remoto. Whisper.cpp/WebAssembly cuantizado queda como alternativa posterior para navegadores sin capacidad local nativa; requiere pruebas de memoria, latencia, precisión y licencia.
- **Traducción local (siguiente fase):** evaluar Argos Translate/WASM o motor compatible; probar ES↔EN y terminología de dominio. No asumir calidad profesional.
- **Proveedores del usuario (fase posterior):** adaptadores aislados, consentimiento por finalidad, límites y visualización de costes/cuotas.
- **Persistencia local (fase posterior):** IndexedDB para sesiones y glosarios. La exportación TXT explícita del texto final se realiza ya en el navegador; no existe sincronización automática.
- **Servidor:** identidad, permisos, configuración no sensible, entrega de versiones/modelos y sincronización opt-in. No procesa audio en el camino predeterminado.

## Estrategia para equipos básicos

- Detectar WebAssembly, WebGPU, AudioWorklet, memoria estimada y núcleos lógicos.
- Empezar con modelos pequeños y cuantizados, descarga bajo demanda y caché local.
- Permitir modo asistido sin ASR local cuando el dispositivo no alcance el umbral.
- No cargar modelos grandes al iniciar la aplicación.
- WebGPU es una mejora opcional; nunca un requisito para abrir Live.

## Integración existente

- Reutilizar `resolveCurrentIdentity()` y el middleware de rutas protegidas.
- Mantener el worker `scripts/roleplay-audio-worker.ts` dedicado a su actual pipeline de conversión de audio de Roleplay. No convertirlo en servidor de inferencia Live.
- Integración futura con Roleplay Studio mediante contratos compartidos y exportación voluntaria; no mezclar sesiones Live con `RoleplaySession` sin un caso de uso y modelo de permisos revisados.
- Admin: configuración y catálogo de proveedores/modelos, sin acceso al audio privado por defecto.
- Interpreter: espacio Live y control de consentimiento.
- Candidate: acceso solo cuando una actividad de Roleplay lo habilite expresamente; no se concede acceso general a herramientas privadas del intérprete.

## Estado de esta entrega

Implementado: ruta autenticada `/live`, prueba de micrófono sin grabación/transmisión, detección de capacidades, contratos tipados, exportación TXT local y transcripción experimental mediante reconocimiento **obligatoriamente local** del navegador en idiomas compatibles, activado por el usuario. El texto vive en memoria de la pestaña y no se sincroniza.

Pendiente: motor ASR local portable (por ejemplo, Whisper.cpp), traducción local, VAD/chunking, glosario, almacenamiento IndexedDB, exportación SRT/VTT con timestamps verificados, consentimiento persistente auditable, sincronización opt-in y pruebas de rendimiento/precisión.

La transcripción local es **experimental y limitada a navegadores con `SpeechRecognition.available()` y `processLocally=true`**; no declarar transcripción universal ni traducción en tiempo real disponible hasta que las fases pendientes estén implementadas y verificadas. La instalación del paquete puede descargar datos desde el proveedor del navegador, pero la inferencia de audio debe ejecutarse localmente. El navegador puede solicitar permisos de micrófono. No se deben introducir claves de API ni grabaciones por defecto.

## Exportación privada de texto

- Solo se exportan segmentos finales aceptados por el reconocedor; las hipótesis intermedias no se incluyen.
- El archivo `.txt` se construye mediante Blob/Object URL y se descarga desde el navegador; la plataforma no recibe ni almacena el contenido.
- La aplicación no genera SRT/VTT sin marcas temporales reales; inventar tiempos perjudicaría el entrenamiento de interpretación.
- La transcripción actual se pierde al recargar la página salvo que el usuario descargue el TXT; no se promete recuperación o persistencia.
## Diagnóstico de reconocimiento local

- Web Speech `available()` e `install()` consultan explícitamente `processLocally: true` y `quality: 'dictation'`. La compatibilidad con estas opciones es experimental y depende del navegador y del idioma.
- La política `on-device-speech-recognition` tiene `self` como lista de permisos predeterminada; no activar orígenes cruzados sin una revisión de seguridad.
- Si el navegador informa un error de reconocimiento se termina la sesión y el usuario debe reiniciarla manualmente; no hay reintento silencioso mediante proveedor remoto.
- La prueba del micrófono y el reconocedor nativo disponen de controles separados y no deben mantenerse activos simultáneamente hasta completar la unificación de captura.

## Preparación para audio largo — fragmentación PCM local

- `chunkLocalPcmFrames()` prepara ventanas mono PCM de duración controlada (por defecto 20 segundos, máximo 30) con solapamiento de 1 segundo, sin grabar audio ni llamar servicios externos.
- Recibe un flujo `AsyncIterable<Float32Array>` de pequeños frames ya decodificados: no lee un archivo entero en memoria ni realiza remuestreo. La captura, decodificación y normalización a la frecuencia requerida por cada modelo son responsabilidades separadas.
- Cada ventana incluye el índice, los offsets exactos de muestras y tiempos calculados a partir de la frecuencia de muestreo, que pueden alimentar una futura reconciliación de transcripciones; **no son timestamps de palabras ni subtítulos verificados**.
- Se emiten ventanas secuencialmente mediante iteración asíncrona. El consumidor debe procesar o desechar cada ventana antes de solicitar la siguiente, evitando acumulación del audio completo.
- Los productores de micrófono en tiempo real deberán implementar su propia cola acotada y política de pérdida de frames cuando la inferencia no alcance el ritmo de la captura. Esta función no proporciona ese puente todavía.
- Cancelación mediante `AbortSignal`; debe combinarse con cierre del micrófono/worker en la capa superior. El procesamiento del modelo WASM todavía está pendiente.
- No confundir esta infraestructura con transcripción, traducción ni soporte validado de vídeos largos: faltan integración del modelo, benchmark de memoria, audio-resampling, diarización, deduplicación y pruebas en equipos básicos.
