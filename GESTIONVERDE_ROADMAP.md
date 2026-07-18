# GestiónVerde 2.0 — Plan de implementación

Este repositorio es el proyecto principal. `ruta-verde` permanece separado como respaldo y no debe modificarse durante esta migración.

## Objetivo

Convertir la base actual en una aplicación operativa de recolección que se sienta como una app móvil profesional, con navegación, GPS, gestión de viviendas y supervisión en tiempo real.

## Entrega 1 — Base limpia

- Renombrar completamente Ruta Verde a GestiónVerde.
- Retirar la dependencia de `ROUTE_DATA_KEY` y el flujo AES del recorrido.
- Reemplazar el vault cifrado por un repositorio de datos con adaptadores para JSON local y base remota.
- Mantener roles: Conductor, Jefatura y Superadministrador.
- Mantener PWA y funcionamiento offline.

## Entrega 2 — Mapa operativo

- Ruta azul principal.
- Marcadores por vivienda.
- Estados visuales: realizada, ausente y pendiente.
- Marcador del camión rotado según rumbo GPS.
- Flecha del siguiente tramo y tarjeta de próximo destino.
- Recentrado, zoom y seguimiento automático.

## Entrega 3 — Recorrido del conductor

- Iniciar, pausar, reanudar y finalizar jornada.
- Próxima vivienda con calle y número.
- Marcar realizada, ausente o pendiente.
- Observaciones y fotografía por vivienda.
- Voz mediante Web Speech API con respaldo silencioso cuando no esté disponible.
- Persistencia offline y cola de sincronización.

## Entrega 4 — Dashboard vivo

- Avance total y porcentaje.
- Realizadas, ausentes y pendientes.
- Tiempo de recorrido, distancia y velocidad.
- Posición actual del vehículo.
- Historial por jornada.
- Exportación de resumen.

## Entrega 5 — Rutas inteligentes

- Reordenamiento de paradas.
- Recalcular tras desvíos.
- Perfil de vehículo pesado.
- Respeto de sentidos de tránsito y restricciones cuando exista una fuente vial compatible.
- Comparación entre ruta planificada y ruta realizada.

## Criterios de aceptación

- La aplicación debe abrir y ejecutar sin requerir `ROUTE_DATA_KEY`.
- Una jornada debe poder completarse sin conexión y sincronizarse después.
- El conductor debe poder operar las acciones principales con una mano.
- La voz nunca debe bloquear la navegación.
- Las fotografías no deben perderse por cierre o cambio de aplicación.
- El dashboard debe reflejar cambios sin recargar manualmente.

## Orden de trabajo

1. Limpieza de arquitectura y marca.
2. Modelo de datos sin vault.
3. Mapa y estados.
4. Operación del conductor.
5. Dashboard de jefatura.
6. Fotos, voz y sincronización.
7. Optimización de rutas y pruebas de terreno.
