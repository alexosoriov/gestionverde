# Bóveda del servidor

Esta carpeta contiene únicamente material cifrado necesario para el funcionamiento del recorrido.

Reglas:

- no guardar nombres, direcciones, teléfonos, RUT, notas o coordenadas en texto plano;
- no incluir la clave `ROUTE_DATA_KEY` en archivos, commits, issues o pull requests;
- mantener cifrado AES-256-GCM con IV, AAD y etiqueta de autenticación;
- descifrar únicamente dentro del Cloudflare Worker y después de validar la sesión;
- no enviar el bloque descifrado a usuarios sin autenticación;
- no guardar respuestas privadas en caché.

El mapa no importa esta carpeta directamente. Recibe los datos mediante el endpoint protegido del Worker, por lo que separar la bóveda no modifica el funcionamiento visual del recorrido.
