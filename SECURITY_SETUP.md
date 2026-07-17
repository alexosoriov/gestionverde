# Activación de seguridad

## Secretos obligatorios del alojamiento

Configura estos valores únicamente en el panel privado del alojamiento activo o en `.env.local` durante el desarrollo. Nunca los escribas en el repositorio.

### Conductor

- `ROUTE_USERNAME`
- `ROUTE_PASSWORD`

### Jefatura

- `JEFATURA_USERNAME`
- `JEFATURA_PASSWORD`

### Superadministrador

- `SUPERADMIN_USERNAME`
- `SUPERADMIN_PASSWORD`

### Seguridad compartida

- `ROUTE_SESSION_SECRET`: secreto aleatorio de al menos 32 bytes.
- `ROUTE_DATA_KEY`: clave AES-256 de exactamente 32 bytes codificada en Base64.

Para desarrollo local:

```bash
cp .env.example .env.local
```

Después reemplaza todos los valores de ejemplo. No reutilices valores de conversaciones, capturas o commits anteriores.

## Permisos

- **Conductor:** recorrido, GPS, estados, jornada y escritura del seguimiento.
- **Jefatura:** lectura del seguimiento, métricas y mapa de supervisión.
- **Superadministrador:** acceso completo.

Los intentos fallidos se registran mediante identificadores HMAC; no se guarda el usuario ni la IP en texto legible. Cinco fallos activan un bloqueo progresivo.

## Componentes protegidos

- `app/route-data.ts` comienza vacío y no contiene registros personales.
- `worker/vault/sector-map.ts` contiene únicamente el recorrido cifrado.
- `worker/journey-state.ts` cifra jornadas completas antes de guardarlas.
- `worker/live-tracking.ts` cifra ubicación, actividad y métricas remotas.
- `app/journey-db.ts` cifra IndexedDB con una clave no extraíble del dispositivo.
- `app/journey-storage.ts` cifra respaldos y cola offline de `localStorage`.

## Actualizar las viviendas

Guarda temporalmente el JSON sin cifrar dentro de `private/`, carpeta ignorada por Git, y ejecuta:

```bash
ROUTE_DATA_KEY="TU_CLAVE_BASE64" npm run security:encrypt-route -- private/route.json
```

El comando reemplaza la bóveda usando un IV aleatorio nuevo. Después elimina de forma segura el archivo temporal.

## Comprobación posterior al despliegue

1. Sin sesión solo aparece el formulario de acceso.
2. El usuario no viene escrito por defecto.
3. Conductor no puede leer el panel remoto de Jefatura.
4. Jefatura no puede escribir jornadas ni ubicación del conductor.
5. Superadministrador puede usar ambas vistas.
6. Cinco contraseñas incorrectas producen bloqueo temporal y `Retry-After`.
7. La contraseña correcta carga las viviendas y el mapa correspondiente al rol.
8. La base de datos no contiene coordenadas, actividad, notas o casas nuevas en texto legible.
9. IndexedDB y `localStorage` contienen sobres con `iv` y `data`, no nombres ni direcciones.
10. Las respuestas `/api/` usan `Cache-Control: no-store`.

## Rotación

Cambiar `ROUTE_SESSION_SECRET` invalida todas las sesiones existentes. Cambiar `ROUTE_DATA_KEY` requiere volver a cifrar la bóveda y eliminar o migrar los registros cifrados con la clave anterior.

## Alojamiento administrado

Este repositorio no incluye comandos para crear, desplegar o eliminar una cuenta externa de Cloudflare. Los adaptadores internos del entorno de ChatGPT Sites deben mantenerse mientras la aplicación continúe publicada allí; quitarlos sin migrar las API y la base de datos rompería el acceso, el GPS sincronizado y los roles.
