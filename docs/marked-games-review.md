# Revisión de los ocho juegos marcados con «-»

Los cambios mantienen cada juego como un HTML autónomo: sus estilos y su lógica siguen incluidos en el archivo, como espera `api/proxy.js`. El catálogo de la tienda no cambia. Los nombres conservan el prefijo `-`.

| Juego          | Cambios principales                                                                                                                                                                                                                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Basketball     | Mundo de tamaño fijo para mantener la física al redimensionar; subpasos de colisión; trayectoria de ayuda; pista y aro más legibles; conservación del balón en vuelo; pausa del reinicio entre tiros; conservación del bonus de tiro limpio tras el rebote; cero recompensa si no hubo tiros.                       |
| Bubble Shooter | Archivo renombrado a `-bubble-shooter.html` para funcionar con el proxy; filas nuevas conservan posiciones y vecinos; ajuste de los bordes; encaje cercano a la colisión; restauración del tiro, modo, intercambio y temporizador; números sobre los colores; correcciones de pausa.                                |
| Connect Four   | Respeta jugar segundo; perspectiva corregida en la búsqueda del bot; cancela tareas antiguas al reiniciar; suspende el bot en pausa; guarda la jugada antes de animarla; valida gravedad y turnos; migra la clave antigua `four-in-a-row` a `connect-four`.                                                         |
| Drift Circuit  | Una sola cadena de animación; reloj de carrera que excluye las pausas; generación de deslizamiento lateral al girar; marcas de neumáticos; puntuación sin sumar dos veces el combo; guardado y continuación de carrera; liberación de los controles al pausar.                                                      |
| FreeCell       | Guardado seguro durante la inicialización; validación de las 52 cartas; selección y arrastre sin reemplazar prematuramente el elemento pulsado; movimientos a bases ocupadas; pistas de secuencias; conservación de fracciones de tiempo; doble toque y controles de teclado.                                       |
| Nonogram       | Finalización y progreso basados en las pistas públicas; acepta soluciones alternativas válidas; búsqueda de una solución compatible para asistencia; las pistas pueden corregir cruces; deshacer y limpiar conservan las penalizaciones; clic derecho sin aplicación duplicada; navegación de casillas con teclado. |
| Solitaire      | Validación de baraja y partidas; guardado periódico y al salir; cancelación del autocompletado al pausar o cambiar de partida; tiempo excluyendo el menú; botón principal que inicia la partida; ajustes de ancho y legibilidad en pantallas pequeñas.                                                              |
| Word Search    | Generación limitada a la categoría elegida; reintentos acotados; conservación del tiempo y palabras encontradas al recargar; validación de cuadrícula y colocaciones; selección equivalente de una palabra admitida; selección con teclado y mejoras de contraste.                                                  |

## Guardado compartido

Cada escritura vuelve a leer `ARCADE_GAMES` y actualiza únicamente la clave del juego. Los incrementos o gastos de créditos se concilian con el saldo más reciente, para conservar las recargas realizadas desde la tienda. Los errores de escritura mantienen la partida en memoria y muestran un aviso. Un contenedor JSON roto no se sobrescribe silenciosamente.

Se validan las opciones de modo, temas adquiridos, números y partidas compatibles. Los juegos conservan sus claves habituales sin el prefijo del nombre de archivo. La entrada antigua de Connect Four permanece disponible como respaldo de la migración.

El adaptador está incluido en cada HTML porque los archivos también deben funcionar de manera independiente. `localStorage` sigue siendo almacenamiento local: no ofrece sincronización de cuentas ni transacciones entre pestañas que escriben exactamente a la vez.

## Pruebas reproducibles

Desde la raíz del repositorio, con Node.js 20 o posterior:

```sh
npm ci
npx playwright install chromium
npm test
```

Las pruebas abren los juegos a través del propio `api/proxy.js`, en un servidor HTTP efímero. Comprueban menús y partidas a 320, 390 y 1365 píxeles, con emulación táctil en los tamaños móviles, además de guardado, recarga, créditos, cartas, pausas, lógica del bot, puzles y física.

Si ya existe un navegador Chromium instalado, se puede indicar su ejecutable mediante `CHROMIUM_PATH`. `PLAYWRIGHT_MODULE` permite utilizar una instalación preexistente de Playwright. No hace falta instalar dependencias para ejecutar los HTML descargados.

Resultado de la comprobación final: **38 pruebas superadas, 0 fallos**, con Chromium 153 y Playwright 1.62.1.

La validación automatizada usa Chromium. Queda pendiente la comprobación manual en dispositivos físicos y en Safari/Firefox. La revisión no fusiona los cambios ni modifica la producción.
