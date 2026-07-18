# GestiónVerde

Aplicación de operación y supervisión para recorridos de recolección domiciliaria. La interfaz está pensada para utilizarse desde teléfono, tablet o computador como PWA y prioriza el trabajo en terreno.

## Estado actual

La rama `feature/gestionverde-2-base` contiene la reconstrucción de GestiónVerde 2.0:

- mapa de calles y vista satelital;
- ruta resaltada en azul;
- camión animado y orientado según el rumbo GPS;
- seguimiento GPS, velocidad, precisión y kilómetros reales;
- viviendas pendientes, realizadas y ausentes;
- detección de llegada al próximo destino;
- inicio, pausa, continuación y cierre de jornada;
- voz en español para próxima vivienda, llegada y cambios de estado;
- fotografías, observaciones, material y kilos por vivienda;
- persistencia local para seguir trabajando sin conexión;
- cola de seguimiento para reenviar cuando vuelva internet;
- panel de jefatura con ubicación y avance en vivo;
- historial de jornadas;
- exportación CSV e impresión/guardado como PDF;
- administración de rutas JSON por Superadministrador.

## Arquitectura de datos

La aplicación activa ya no utiliza `AES`, `worker/vault` ni `ROUTE_DATA_KEY` para cargar el recorrido.

Los datos operativos se guardan como JSON en tablas D1:

- `gestionverde_routes`;
- `gestionverde_tracking`;
- `gestionverde_journeys`;
- `gestionverde_diagnostics`.

En el teléfono, la jornada actual y las fotografías comprimidas se conservan en almacenamiento local para soportar cortes de conexión. El repositorio incluye solamente 44 puntos de demostración sin teléfonos, nombres de vecinos ni direcciones reales.

> Este repositorio es público. Nunca agregues a GitHub archivos con nombres, teléfonos, notas privadas o coordenadas reales. El recorrido productivo debe importarse desde la sesión de Superadministrador o cargarse mediante una fuente privada.

## Roles

- **Conductor:** recorrido, GPS, estados, fotos, observaciones y cierre de jornada.
- **Jefatura:** dashboard, métricas, actividad reciente y ubicación del camión.
- **Superadministrador:** experiencia operativa completa e importación/eliminación del recorrido privado.

Las credenciales se configuran mediante variables de entorno. No deben escribirse dentro del código.

## Variables de entorno

Copia `.env.example` como `.env.local` para desarrollo y reemplaza los valores de ejemplo:

```env
ROUTE_USERNAME=usuario_conductor
ROUTE_PASSWORD=contraseña_larga
JEFATURA_USERNAME=usuario_jefatura
JEFATURA_PASSWORD=contraseña_larga
SUPERADMIN_USERNAME=usuario_superadmin
SUPERADMIN_PASSWORD=contraseña_larga
ROUTE_SESSION_SECRET=secreto_aleatorio_de_32_bytes_o_mas
```

También se necesita el binding D1 `DB` para autenticación, rutas y sincronización operativa.

## Ejecutar localmente

Requiere Node.js 22 o posterior.

```bash
npm ci
npm run dev
```

## Verificación

```bash
npx tsc --noEmit
npm run lint
npm run build
node --test tests/*.test.mjs
```

El build utiliza vinext y genera el artefacto de Cloudflare definido por el proyecto.

## Formato para importar viviendas

La sesión de Superadministrador acepta una lista JSON o un objeto con la propiedad `stops`:

```json
{
  "stops": [
    {
      "id": "vivienda-001",
      "name": "Vivienda 01",
      "address": "Calle y número",
      "day": "Viernes",
      "lat": -41.4693,
      "lng": -72.9424,
      "km": 0
    }
  ]
}
```

Cada vivienda requiere `id`, `name`, `lat` y `lng`. Se aceptan hasta 500 registros por recorrido.

## Pruebas obligatorias antes del uso real

Un build exitoso no reemplaza la prueba física. Antes de una jornada real se debe comprobar:

- permisos de ubicación y cámara en el teléfono exacto del conductor;
- comportamiento con pantalla bloqueada y ahorro de batería;
- pérdida y recuperación de internet;
- exactitud de las coordenadas de cada vivienda;
- sentidos de tránsito y restricciones reales del vehículo;
- sincronización entre conductor y jefatura;
- almacenamiento y eliminación correcta de fotografías;
- cierre y exportación del resumen de jornada.

## Firebase

Firebase todavía no está conectado porque el repositorio no contiene una configuración ni credenciales de un proyecto Firebase. La implementación actual utiliza D1 y mantiene la capa de datos separada para que posteriormente se pueda crear un adaptador de Firestore sin volver a diseñar toda la interfaz.
