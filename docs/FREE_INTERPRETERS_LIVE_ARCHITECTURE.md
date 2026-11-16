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
- **Traducción local (experimental):** API Translator integrada en navegadores compatibles para ES↔EN, bajo acción voluntaria del intérprete y con paquetes descargados por el navegador. El texto final se copia manualmente a la caja editable; no se traduce automáticamente. Argos Translate/WASM u otro motor portable siguen pendientes para Firefox, Safari, móviles y equipos sin esta API. No asumir calidad profesional.
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

Pendiente: motor ASR local portable (por ejemplo, Whisper.cpp), traducción local portable multibrowser, VAD/chunking, glosario, almacenamiento IndexedDB, exportación SRT/VTT con timestamps verificados, consentimiento persistente auditable, sincronización opt-in y pruebas de rendimiento/precisión.

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
- La prueba del micrófono y el reconocedor nativo tienen controles separados, pero la UI impide capturar a la vez: mientras la prueba ocupa el micrófono se bloquea la transcripción y viceversa. La unificación del motor de captura sigue pendiente.

## Preparación para audio largo — fragmentación PCM local

- `chunkLocalPcmFrames()` prepara ventanas mono PCM de duración controlada (por defecto 20 segundos, máximo 30) con solapamiento de 1 segundo, sin grabar audio ni llamar servicios externos.
- Recibe un flujo `AsyncIterable<Float32Array>` de pequeños frames ya decodificados: no lee un archivo entero en memoria ni realiza remuestreo. La captura, decodificación y normalización a la frecuencia requerida por cada modelo son responsabilidades separadas.
- Cada ventana incluye el índice, los offsets exactos de muestras y tiempos calculados a partir de la frecuencia de muestreo, que pueden alimentar una futura reconciliación de transcripciones; **no son timestamps de palabras ni subtítulos verificados**.
- Se emiten ventanas secuencialmente mediante iteración asíncrona. El consumidor debe procesar o desechar cada ventana antes de solicitar la siguiente, evitando acumulación del audio completo.
- La captura de micrófono ya utiliza cola acotada y control de créditos entre Worklet y pestaña. Cuando el consumidor no alcanza el ritmo de la captura, se cancela explícitamente con error de desbordamiento; **no se permite perder frames de voz en silencio**. El fragmentador tampoco almacena sesiones completas.
- Cancelación mediante `AbortSignal`; debe combinarse con cierre del micrófono/worker en la capa superior. El procesamiento del modelo WASM todavía está pendiente.
- No confundir esta infraestructura con transcripción, traducción ni soporte validado de vídeos largos: faltan integración del modelo, benchmark de memoria, audio-resampling, diarización, deduplicación y pruebas en equipos básicos.

## Traducción local ES↔EN (experimental)

- El intérprete comprueba la capacidad del navegador y, en otro clic explícito, activa el modelo local. `Translator.create()` se inicia directamente desde el gesto del usuario porque requiere activación transitoria.
- La primera activación puede provocar una descarga del paquete de idioma desde el proveedor del navegador. La inferencia del texto corre localmente. No hay traducción en servidores Free Interpreters, API key, telemetría de contenido, ni fallback a nube.
- El texto de la sesión se mantiene en memoria. `Cargar transcripción confirmada` copia a una caja editable los últimos 1,800 caracteres finales; `Traducir en este equipo` requiere un clic separado. El texto parcial no se transfiere ni se traduce.
- El traductor se destruye al desactivar, cerrar la página o cambiar el idioma. Los trabajos iniciados se cancelan mediante AbortSignal y las respuestas tardías se ignoran.
- La API está limitada a navegadores compatibles y HTTPS. La traducción no es validación médica/jurídica; dosis, negaciones, cifras y nombres requieren revisión humana. La compatibilidad y calidad deben verificarse en dispositivos reales.

## Etapa de captura PCM con AudioWorklet (infraestructura, no UI)

- `public/live-pcm-capture-worklet.js` ejecuta el capturador en el hilo de audio del navegador. Mezcla canales a mono y envía paquetes de 1024 muestras a la pestaña mediante `MessagePort`. Su salida al dispositivo de audio es siempre silencio, evitando retorno audible del micrófono.
- `startLocalPcmCapture()` es una **API experimental de infraestructura**, no se ejecuta automáticamente ni está conectada todavía a un botón de Live. Requiere un contexto seguro, `getUserMedia` y soporte AudioWorklet.
- El modelo de permisos se mantiene: petición explícita, liberación de pistas incluso si se cancela mientras el navegador muestra el diálogo, cierre de `AudioContext` y desconexión del grafo al finalizar.
- `BoundedLocalPcmQueue` copia los frames para preservar propiedad de memoria y limita su retención a aproximadamente dos segundos a la frecuencia real del `AudioContext`. Además, el AudioWorklet usa créditos de paquetes (hasta 256 paquetes, acotados por la tasa de muestreo) y la pestaña solo devuelve créditos conforme consume los frames. Así también se limita el número de mensajes PCM pendientes en `MessagePort`.
- Ante retraso sostenido se detiene la captura con `LOCAL_PCM_TRANSPORT_OVERFLOW` o `LOCAL_PCM_QUEUE_OVERFLOW`; **nunca se descarta audio silenciosamente** ni se simula continuidad de muestras. Un futuro consumidor debe mostrar el error y pedir reiniciar.
- Las muestras se procesan localmente y se olvidan al cerrar. No hay `fetch`, WebSocket, MediaRecorder, almacenamiento, ni un modelo ASR contratado.
- El `AudioContext.sampleRate` se entrega al consumidor. El módulo `resampleLocalPcmTo16k()` permite ahora convertir audio mono de frecuencias habituales a 16 kHz con filtro sinc de ventana Blackman y salida en frames acotados; `prepareCapturedLocalAsrChunks()` conecta captura → remuestreo → ventanas ASR y libera la captura ante cierre, cancelación o error. **Todavía no se activa esta ruta en la UI, no hay inferencia de voz y el remuestreo aún necesita pruebas de rendimiento fuera del hilo principal**. En interpretación profesional no se debe ocultar pérdida de audio.
- Debe verificarse el archivo estático del worklet en el artefacto desplegado, la política CSP y el comportamiento de micrófono en los navegadores objetivo. La disponibilidad del worklet por sí sola no acredita compatibilidad completa.

## Remuestreo local a 16 kHz (infraestructura ASR)

- `src/modules/live-engine/core/local-pcm-resample.ts` convierte frames mono Float32 PCM de 8–192 kHz a 16 kHz, aplicando un filtro paso bajo sinc con ventana Blackman para reducir aliasing antes de disminuir la tasa de muestreo. La señal que ya llega a 16 kHz se copia sin filtrado ni alteración.
- Usa un historial circular fijo de 72 muestras y buffers de salida de hasta 1024 muestras; calcula posiciones absolutas desde el índice de salida para evitar deriva durante sesiones largas. Los extremos se extienden con su muestra de borde; el output tiene la duración definida por el conteo real de muestras, no por el reloj ni timestamps inventados.
- La latencia del filtro es una ventana de contexto de 32 muestras de entrada, más la acumulación de hasta 1024 muestras por frame de salida. No se ha cuantificado la latencia completa en equipos básicos.
- Rechaza frecuencia de muestreo inválida, frames de entrada de más de 2 segundos y muestras NaN/Infinity. Un `AbortSignal` puede interrumpir la iteración entre frames y durante el cálculo.
- `prepareCapturedLocalAsrChunks()` enlaza la captura AudioWorklet existente con remuestreo a 16 kHz y `chunkLocalPcmFrames()`, conservando offsets de muestra coherentes y liberando el micrófono por `finally` cuando el consumidor termina, cancela o falla.
- **No se ha incorporado ningún modelo ASR**, ni descarga de pesos, ni Whisper WASM, ni ejecución real en Worker. Este filtrado todavía se ejecuta donde el consumidor llama al generador; la integración de producción deberá realizarse fuera del hilo principal, medir CPU/RAM, calidad y latencia y verificar 10/30/60 minutos en equipos reales.
- No se deben mostrar los tiempos de los fragmentos PCM como tiempos verificados de palabras ni subtítulos. El modelo ASR deberá devolver referencias temporales reales y el reconciliador eliminar solapamientos duplicados.
- La conversión de 8 kHz a 16 kHz no recupera los detalles que el micrófono original no captó; se considera compatible como formato, no como una mejora de calidad.

## Preparación ASR en Worker (sin motor de inferencia)

- `local-asr-audio.worker.ts` crea un Web Worker de módulo de origen propio: el filtro PCM a 16 kHz y la división en ventanas se ejecutan **fuera del hilo principal**, reutilizando `resampleLocalPcmTo16k` y `chunkLocalPcmFrames`. El Worker no instala, descarga ni ejecuta todavía un modelo ASR.
- `prepareCapturedLocalAsrChunksInWorker()` es un adaptador **todavía sin conectar a la UI** que recibe la captura AudioWorklet existente. La pestaña transfiere un solo frame de entrada por petición explícita del Worker y el Worker entrega un solo chunk por cada petición del consumidor; no hay colas PCM de tamaño arbitrario entre ambos.
- La transferencia usa `ArrayBuffer` bajo propiedad del destino y solo ocurre dentro de la página y su Worker (no WebSocket, `fetch` ni servidor). Las ventanas ya incluyen offsets de muestra, no timestamps verificados de palabras.
- La cancelación, fallo del Worker o finalización del consumidor terminan el Worker y cierran el micrófono. Los errores de entrada, buffers y protocolo se transmiten como códigos, sin contenido de conversaciones en logs.
- Para compatibilidad se requiere Web Worker de módulo y un navegador capaz de cargar su chunk empaquetado. Un equipo sin Worker no debe recibir una caída silenciosa al hilo principal: se informa la indisponibilidad y se cierra la captura.
- **Próximo hito**: elegir y revisar licencia/tamaño de modelo ASR local WASM; descarga voluntaria, caché, límites RAM y aceleración opcional; benchmark de 10/30/60 minutos en equipos básicos. Un procesamiento fuera del hilo UI no garantiza tiempo real si el CPU del dispositivo no alcanza el ritmo de la llamada.

## Piloto Whisper tiny WebAssembly (experimental, opt-in)

- La interfaz de Live ofrece un proveedor **experimental**, desactivado hasta que el intérprete marque su consentimiento de descarga y pulse `Descargar y preparar Whisper local`. El modelo es `onnx-community/whisper-tiny` multilingüe, cargado desde Hugging Face por el navegador con Transformers.js 4.3.1 y pesos cuantizados `q8`.
- Los archivos de ONNX Runtime Web se copian durante `prebuild` de la dependencia fijada en `package-lock.json` a `public/live-onnx-runtime/` y se sirven desde el mismo origen. Nunca se descargan binarios durante el build. `npm ci` sigue usando el lockfile.
- El primer uso puede descargar muchos MB de modelos, tokenizadores y configuraciones; el uso de RAM es mayor que el peso descargado. La descarga se ejecuta desde el navegador al proveedor público, no mediante el servidor de Free Interpreters. El navegador administra la caché y puede expulsarla según espacio disponible. Los modelos no están garantizados en equipos básicos.
- La carga e inferencia se realizan en un **Worker distinto del Worker PCM**. El micrófono, `AudioWorklet`, remuestreo 16 kHz y ventanas de 10 s con 1 s de solapamiento utilizan exclusivamente los recursos del usuario. No hay solicitudes del tipo `/api/transcribe`, audios guardados, autenticación de terceros ni facturación por minuto.
- Por defecto se utiliza CPU/WASM de un solo hilo para compatibilidad; no se cambia silenciosamente a un proveedor remoto. No se activa WebGPU hasta ejecutar benchmarks y pruebas de compatibilidad específicos.
- El Worker rechaza ventanas de más de 30 s, valores no finitos y peticiones de inferencia concurrentes. La cancelación termina su contexto para liberar modelos y abortar inferencia; la cola de audio detiene el micrófono con error explícito si el dispositivo procesa más lento que el audio real.
- Los resultados se muestran por ventanas con límites calculados a partir de muestras; **NO** incluyen alineación de palabras ni detección precisa de intervenciones. Los fragmentos solapados pueden repetir texto; no se elimina contenido arbitrariamente (especialmente negaciones, cantidades o dosis). Se permite exportar texto final local a TXT, sujeto a revisión.
- La CSP amplía los destinos de descarga de pesos solo en `/live` y las respuestas de bundles Worker de `/_next/static/chunks/`; todas las demás páginas conservan la política original. El runtime WASM se sirve desde el mismo origen. Verificar en DevTools, especialmente redirecciones de Hugging Face, para determinar si se necesitan destinos adicionales sin permisos amplios.
- **Producción aún no autorizada:** comprobar descarga y ASR en Chromium, Firefox y Safari, CPU y RAM real, tiempos por 10/30/60 minutos, privacidad de red, licencias/atribución y texto especializado de interpretación médica. El CI valida código y pruebas simuladas, pero no descarga el modelo en una sesión real.
