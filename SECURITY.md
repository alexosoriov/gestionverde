# Seguridad de Ruta Verde

## Alcance

Ruta Verde protege nombres, direcciones, coordenadas, notas, actividad, viviendas nuevas y ubicación del vehículo tanto en el repositorio como en la base de datos administrada y en el almacenamiento offline del teléfono.

## Cifrado del recorrido base

El recorrido original vive en `worker/vault/sector-map.ts` como un bloque **AES-256-GCM** autenticado. La clave no está en GitHub; se configura mediante el secreto `ROUTE_DATA_KEY`.

Para actualizar la lista se usa:

```bash
ROUTE_DATA_KEY="..." npm run security:encrypt-route -- private/route.json
```

La herramienta genera un IV aleatorio nuevo en cada ejecución. Nunca reutilices un IV con la misma clave.

## Cifrado de datos operativos

- Las jornadas se cifran antes de escribirse en la base de datos administrada.
- El seguimiento remoto se guarda en un sobre cifrado; los campos históricos legibles se ponen en cero o vacío.
- Se derivan subclaves independientes con HKDF-SHA-256 para jornada y seguimiento.
- Cada escritura usa AES-256-GCM, IV aleatorio de 96 bits, AAD específico del registro y etiqueta de 128 bits.
- Los registros antiguos en texto plano se migran y limpian al ser leídos.

## Protección del teléfono

- IndexedDB guarda jornadas y cola offline cifradas.
- La clave local es una `CryptoKey` AES-256 no extraíble.
- `localStorage` guarda únicamente sobres cifrados.
- Los respaldos heredados en texto plano se migran y eliminan automáticamente.
- El service worker nunca almacena respuestas `/api/`.

## Cuentas y permisos

Las cuentas se configuran exclusivamente mediante secretos privados del entorno de alojamiento:

- Conductor: `ROUTE_USERNAME` y `ROUTE_PASSWORD`.
- Jefatura: `JEFATURA_USERNAME` y `JEFATURA_PASSWORD`.
- Superadministrador: `SUPERADMIN_USERNAME` y `SUPERADMIN_PASSWORD`.
- Compartidos: `ROUTE_SESSION_SECRET` y `ROUTE_DATA_KEY`.

Permisos activos:

- Conductor escribe jornada y seguimiento, pero no abre la vista exclusiva de Jefatura.
- Jefatura lee seguimiento y métricas, pero no puede escribir la jornada del conductor.
- Superadministrador tiene acceso completo.

## Controles de acceso

- cookie `__Host-rv_session`, `HttpOnly`, `Secure` y `SameSite=Strict` en HTTPS;
- firma HMAC-SHA-256 y duración de sesión según el rol;
- comparación constante de credenciales;
- bloqueo progresivo después de cinco intentos fallidos;
- identificadores de límite derivados por HMAC, sin almacenar usuario o IP en claro;
- verificación de mismo origen para iniciar o cerrar sesión;
- HSTS, CSP, `X-Frame-Options: DENY`, `no-referrer` y `Permissions-Policy`;
- respuestas privadas con `Cache-Control: no-store`.

## Rotación de secretos

Las contraseñas y `ROUTE_SESSION_SECRET` deben rotarse desde la configuración privada del alojamiento activo. Cambiar `ROUTE_DATA_KEY` exige volver a cifrar el recorrido base y migrar o eliminar los registros cifrados con la clave anterior.

Nunca publiques secretos en commits, issues, pull requests, capturas, chats o archivos `.env`.

## Historial de Git

La versión actual no contiene datos personales legibles, pero versiones públicas antiguas pueden permanecer en el historial, forks, clones o cachés. El repositorio debe mantenerse privado y el historial anterior debe reescribirse o sustituirse por un repositorio privado limpio.
