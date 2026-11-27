# Audio Studio — perfil reproducible de navegador

Este fixture monta los componentes reales StudioWaveform y FocusTimeline con estilos de la aplicación, sin Next.js, base de datos, autenticación, grabaciones reales ni peticiones externas. Utiliza Chromium y una compilación optimizada de Vite. El servidor escucha solamente en 127.0.0.1:4178.

## Ejecución local desde la raíz

Con las dependencias del proyecto instaladas:

```sh
npx playwright install chromium
npx playwright test --config benchmarks/audio-studio/playwright.config.ts
```

No requiere E2E_ALLOW_RUN ni acceso a producción: utiliza una configuración independiente que no inicia Next.js ni las pruebas E2E que requieren base de datos. La compilación queda en build/audio-studio-benchmark y los resultados en test-results/audio-studio-benchmark (ambos ignorados por Git).

## Protocolo

- 100 intervalos de metadatos y duración simulada de 12 horas.
- Ventanas completas y selección estable; ocho actualizaciones de calentamiento y 64 actualizaciones medidas del cursor.
- Mediana, p95 y máximo de duración de commits síncronos de React y de intervalos entre requestAnimationFrame.
- Deltas de contadores acumulados de Chromium (tareas, scripts, layout y estilos) y dos lecturas de heap JS. Se adjuntan muestras crudas en JSON.
- Cero nuevas lecturas de los intervalos y del archivo multimedia durante la medición; cero solicitudes externas; actualización efectiva del cursor. Estas son las condiciones deterministas de aceptación.

El tiempo de commit mide el trabajo síncrono alrededor de flushSync; no equivale a latencia total de interacción. Los intervalos de frame incluyen el ritmo de refresco y el planificador; no son FPS durante una reproducción real. Los contadores CDP no representan porcentaje de CPU del sistema y las lecturas de heap no representan pico de memoria ni memoria de audio. No se fuerza GC. Se reporta null si un contador no está disponible. No se simula decodificación de audio ni se evalúa la página editorial completa.

No hay umbrales de milisegundos dependientes de hardware. Para comparar versiones, repetir con el mismo Chromium, resolución, dispositivo y condiciones de carga, y registrar dispersión entre ejecuciones. No usar los resultados de runners distintos como comparación directa ni atribuir ahorros sin una medición de referencia.

El flujo dedicado de GitHub Actions conserva el informe y las trazas de fallos como artefactos, sin despliegues ni secretos de producción.
