# Prueba física de aceptación — Ruta Verde

Fecha: __________  Sector: __________  Conductor: __________  Teléfono: __________

Marca cada punto como **Aprobado**, **Falló** o **No aplica**. Registra capturas únicamente cuando no expongan nombres, direcciones ni coordenadas privadas.

## A. Instalación y acceso

- [ ] El dominio abre mediante HTTPS.
- [ ] La PWA puede instalarse y abrirse sin barra del navegador.
- [ ] Conductor entra únicamente a sus funciones.
- [ ] Jefatura no puede modificar la jornada.
- [ ] Superadministrador puede revisar ambas vistas.
- [ ] Cinco contraseñas incorrectas activan bloqueo.

## B. GPS

- [ ] La aplicación solicita permiso de ubicación.
- [ ] El camión aparece en la ubicación correcta.
- [ ] La precisión baja a un valor aceptable al aire libre.
- [ ] El camión se mueve suavemente sin saltos imposibles.
- [ ] Kilómetros aumentan al avanzar.
- [ ] Tiempo en movimiento y detenido cambian correctamente.
- [ ] Al llegar a una vivienda se produce aviso y vibración.
- [ ] Al cambiar a otra aplicación y volver, el GPS se recupera.
- [ ] Al bloquear la pantalla durante 30 segundos y volver, se muestra advertencia.
- [ ] Con ahorro de batería activado se documenta el comportamiento real.
- [ ] Con cargador vehicular el recorrido mantiene batería suficiente.

## C. Navegación y vehículo

- [ ] OpenRouteService está configurado.
- [ ] Altura, ancho, largo, peso y carga por eje corresponden al camión.
- [ ] La respuesta indica ruta restringida para camión.
- [ ] Se reconocen y documentan rutas de respaldo OSRM.
- [ ] Los sentidos de tránsito coinciden con terreno.
- [ ] No se dirige por calles inaccesibles o demasiado estrechas.
- [ ] Los lugares de detención son seguros.
- [ ] Google Maps no contradice una restricción física conocida.

## D. Jornada

- [ ] Marcar Realizado funciona.
- [ ] Marcar Ausente funciona.
- [ ] Volver una vivienda a Pendiente funciona.
- [ ] Kilos, material y nota se guardan.
- [ ] Agregar una vivienda funciona.
- [ ] Seleccionar su ubicación en el mapa funciona.
- [ ] Cerrar y abrir conserva el avance.
- [ ] El informe final coincide con los registros realizados.

## E. Sin conexión

- [ ] Se inicia la jornada con internet.
- [ ] Se activa modo avión.
- [ ] Se registran al menos tres viviendas.
- [ ] Los datos permanecen al cerrar y abrir la PWA.
- [ ] Se recupera internet.
- [ ] Aparece aviso de sincronización.
- [ ] Jefatura recibe todos los cambios pendientes.
- [ ] D1 no contiene datos operativos en texto legible.

## F. Dos teléfonos

- [ ] Teléfono A modifica vivienda 01.
- [ ] Teléfono B modifica vivienda 02.
- [ ] El servidor conserva ambos cambios.
- [ ] Ambos modifican la misma vivienda.
- [ ] Se conserva la modificación individual más reciente.
- [ ] Ninguna otra vivienda desaparece.
- [ ] El teléfono recibe aviso de combinación.
- [ ] Existe una nueva revisión de la jornada.
- [ ] El historial permite identificar el conflicto.

## G. Recuperación

- [ ] Se listan revisiones disponibles.
- [ ] Se abre una revisión antigua.
- [ ] La revisión está cifrada dentro de D1.
- [ ] Se documenta cómo restaurarla sin perder la actual.
- [ ] La cola offline puede vaciarse después de recuperar internet.

## H. Diagnósticos

- [ ] Un fallo de prueba genera un diagnóstico.
- [ ] Conductor no puede leer diagnósticos.
- [ ] Jefatura puede leerlos.
- [ ] El registro está cifrado en D1.
- [ ] Los diagnósticos pueden limpiarse según la política de retención.

## I. Usabilidad dentro del vehículo

- [ ] Los textos se leen con el teléfono en su soporte.
- [ ] Los botones principales se pueden tocar sin error.
- [ ] Realizado y Ausente se distinguen bajo luz solar.
- [ ] La dirección es más visible que las métricas secundarias.
- [ ] No es necesario hacer zoom manual en la interfaz.
- [ ] Ninguna acción crítica depende de un botón menor a 48 px.

## Resultado

- Fallos críticos: ________________________________________________
- Fallos menores: _________________________________________________
- Correcciones realizadas: ________________________________________
- Responsable de aprobar: _________________________________________

**Resultado final:** [ ] Aprobada  [ ] Aprobada con observaciones  [ ] Rechazada
