# Manual operativo de Ruta Verde

Este documento define las condiciones mínimas para desplegar, probar y utilizar Ruta Verde en un recorrido real.

## 1. Bloqueadores antes de producción

No se debe utilizar con datos reales hasta cumplir todos estos puntos:

- el repositorio debe estar **privado**;
- el historial público antiguo debe reescribirse o reemplazarse por un repositorio privado limpio;
- todas las cuentas y claves deben existir únicamente como secretos o variables privadas del alojamiento activo;
- la dirección publicada debe cargar mediante HTTPS válido;
- GitHub Actions debe terminar correctamente;
- la prueba física de terreno debe aprobarse con el teléfono del conductor;
- debe existir una persona responsable de la cuenta Superadministrador y de la recuperación de claves.

## 2. Secretos obligatorios

- `ROUTE_USERNAME`
- `ROUTE_PASSWORD`
- `JEFATURA_USERNAME`
- `JEFATURA_PASSWORD`
- `SUPERADMIN_USERNAME`
- `SUPERADMIN_PASSWORD`
- `ROUTE_SESSION_SECRET`
- `ROUTE_DATA_KEY`

La cuenta de Conductor escribe la jornada y ubicación. Jefatura consulta seguimiento y diagnósticos. Superadministrador puede realizar ambas funciones.

## 3. Configuración real del vehículo

Configura estas variables privadas del alojamiento con la ficha técnica o una medición real del camión:

- `VEHICLE_TYPE`: normalmente `delivery`, `goods` o `hgv`;
- `VEHICLE_LENGTH_METERS`;
- `VEHICLE_WIDTH_METERS`;
- `VEHICLE_HEIGHT_METERS`;
- `VEHICLE_AXLELOAD_TONS`;
- `VEHICLE_WEIGHT_TONS`;
- `VEHICLE_HAZMAT`: `true` o `false`.

También se requiere `OPENROUTESERVICE_API_KEY` para validar restricciones de vehículo pesado. Si falta la clave o el proveedor falla, la API devuelve una ruta vehicular normal e informa que no valida altura, ancho ni peso.

Nunca presentes la ruta automática como garantía absoluta. Debe comprobarse físicamente el sentido de tránsito, accesos, calles estrechas, pendientes, puentes, portones y lugares seguros para detenerse.

## 4. Sincronización entre dispositivos

Cada teléfono recibe un identificador y una secuencia local. Los estados, detalles y viviendas incorporadas mantienen relojes independientes.

Cuando dos dispositivos trabajan sobre la misma jornada:

- los cambios en viviendas diferentes se conservan;
- la modificación más reciente de una misma vivienda gana de forma determinista;
- volver una vivienda a pendiente se transmite como eliminación versionada;
- el servidor genera una revisión propia;
- la jornada fusionada vuelve al teléfono cifrada;
- se conserva un historial de auditoría dentro del snapshot;
- las últimas 30 revisiones se almacenan cifradas en la base de datos administrada.

## 5. Recuperación de una jornada

### Ver revisiones disponibles

Con una sesión de Conductor o Superadministrador:

```text
GET /api/journey-state?journey=santuario-AAAA-MM-DD&history=1
```

### Recuperar una revisión específica

```text
GET /api/journey-state?journey=santuario-AAAA-MM-DD&revision=NUMERO
```

La respuesta contiene el snapshot descifrado únicamente después de validar la sesión. La versión persistente permanece cifrada.

Antes de restaurar manualmente una revisión:

1. exporta o conserva la jornada actual;
2. anota la revisión y la hora;
3. confirma con Jefatura;
4. restaura desde un único teléfono;
5. verifica que la revisión vuelva a sincronizarse;
6. comprueba dos viviendas al azar.

## 6. Diagnósticos

Los errores no controlados del navegador se envían a `/api/diagnostics` y se guardan cifrados.

- Conductor puede enviar diagnósticos.
- Jefatura y Superadministrador pueden consultar los últimos 50.
- Los registros incluyen estado de conexión, versión, dispositivo y mensaje técnico.
- Los registros de más de 30 días pueden eliminarse mediante `DELETE /api/diagnostics` con una cuenta autorizada.

No utilices los diagnósticos para escribir nombres, direcciones o notas manuales. Su objetivo es registrar fallos técnicos.

## 7. Procedimiento diario

### Antes de salir

1. Cargar el teléfono sobre 80 %.
2. Desactivar ahorro de batería para el navegador o PWA.
3. Confirmar ubicación precisa habilitada.
4. Abrir Ruta Verde e iniciar sesión como Conductor.
5. Confirmar que aparecen las viviendas correctas.
6. Iniciar GPS y comprobar que el camión se mueve en el mapa.
7. Jefatura debe confirmar que recibe ubicación y métricas.
8. Mantener un cargador vehicular conectado.

### Durante la ruta

- No manipular la app mientras se conduce; debe hacerlo un acompañante o con el vehículo detenido.
- Mantener Ruta Verde visible cuando sea posible.
- Si se cambia de aplicación o se bloquea la pantalla, comprobar el movimiento del GPS al regresar.
- Si desaparece internet, continuar registrando: la jornada queda cifrada en el teléfono.
- Después de recuperar internet, esperar el aviso de sincronización.

### Al terminar

1. Verificar realizados, ausentes y pendientes.
2. Confirmar kilómetros y tiempos.
3. Sincronizar con internet estable.
4. Jefatura debe revisar el resumen.
5. Exportar el informe requerido.
6. Cerrar sesión en equipos compartidos.

## 8. Respuesta ante incidentes

### GPS detenido

- volver a Ruta Verde;
- comprobar permiso de ubicación;
- desactivar ahorro de batería;
- detener e iniciar el GPS;
- si persiste, reiniciar la PWA con el vehículo detenido.

### Dos teléfonos muestran información diferente

- conectar ambos a internet;
- dejar que uno sincronice;
- cerrar y abrir el segundo;
- confirmar el aviso de combinación;
- revisar las viviendas afectadas en el historial.

### Pérdida del teléfono

- cambiar inmediatamente la contraseña de Conductor;
- cambiar `ROUTE_SESSION_SECRET` para invalidar todas las sesiones;
- revisar diagnósticos y última ubicación;
- no cambiar `ROUTE_DATA_KEY` sin un plan de migración.

### Sospecha de exposición

- privatizar el repositorio;
- rotar contraseñas y secreto de sesión;
- revisar accesos del alojamiento activo y de GitHub;
- preservar registros para investigación;
- evaluar migración a un repositorio privado limpio.

## 9. Criterio de aprobación

Ruta Verde está aprobada para operación cuando:

- CI está verde;
- secretos y variables están configurados;
- repositorio e historial están protegidos;
- la ruta HGV usa medidas reales;
- la prueba física completa está aprobada;
- Conductor y Jefatura completan una jornada de ensayo;
- se demuestra recuperación offline y conflicto entre dos teléfonos;
- existe responsable de soporte y recuperación.

## 10. Proveedor externo eliminado

Este manual no requiere una cuenta externa de Cloudflare. La publicación actual depende del alojamiento administrado de ChatGPT Sites; cualquier migración futura debe reemplazar primero las API, los secretos y la base de datos antes de retirar sus adaptadores internos.
