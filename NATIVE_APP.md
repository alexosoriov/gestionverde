# Ruta Verde Nativa

La versión web sigue siendo el panel operativo y el backend seguro. Las aplicaciones Android y iPhone agregan un puente de ubicación nativo para mantener el GPS durante una jornada activa y entregar las lecturas al mismo código de mapa, llegada, voz, kilómetros y sincronización.

## Estado

- Android: proyecto compilable incluido en `native/android`.
- iPhone: proyecto XcodeGen incluido en `native/ios`.
- Las aplicaciones cargan únicamente `https://rutaverde.cl` como contenido principal.
- El puente nativo implementa la misma forma de `navigator.geolocation`, por lo que la app web no mantiene dos lógicas GPS diferentes.
- Las lecturas quedan temporalmente en una cola privada nativa y se reenvían cuando la interfaz vuelve a estar disponible.

## Android

Requisitos:

- Android Studio compatible con Android Gradle Plugin 9.3.
- JDK 17.
- Android SDK 37.
- Gradle 9.5.

Compilación:

```bash
gradle -p native/android :app:assembleDebug
```

APK generado:

```text
native/android/app/build/outputs/apk/debug/app-debug.apk
```

Al iniciar GPS desde Ruta Verde, la aplicación solicita ubicación y levanta un servicio visible mediante una notificación permanente. El servicio debe iniciarse mientras la aplicación está visible.

## iPhone

Requisitos:

- macOS con Xcode.
- XcodeGen.
- Cuenta de desarrollo de Apple para instalar en un equipo físico.

```bash
cd native/ios
xcodegen generate
open RutaVerde.xcodeproj
```

Selecciona el equipo de firma, conecta el iPhone y ejecuta. El proyecto declara el modo de segundo plano `location`, activa `allowsBackgroundLocationUpdates` solo durante la jornada y muestra el indicador de ubicación del sistema.

## Seguridad

- El WebView/WKWebView restringe el contenido principal a `rutaverde.cl`.
- No se habilita tráfico HTTP sin cifrar.
- El puente JavaScript expone únicamente iniciar, detener y consultar plataforma.
- Las coordenadas pendientes se guardan en almacenamiento privado de cada aplicación.
- Los datos operativos siguen protegidos por las sesiones, roles y cifrado del backend actual.

## Limitaciones reales

- Android y iOS muestran indicadores del sistema cuando la ubicación funciona en segundo plano.
- El usuario puede revocar permisos, forzar el cierre o restringir batería.
- iOS puede pausar la interfaz web en segundo plano. Las lecturas quedan en cola y se entregan al reabrir la app.
- Para seguimiento remoto absolutamente continuo con la interfaz suspendida, la siguiente etapa es que el código nativo envíe directamente un paquete firmado al backend.
- Publicar en Google Play y App Store requiere iconos finales, política de privacidad, firma, fichas de tienda y revisión de permisos.

## Próxima etapa del navegador propio

Esta base permite sustituir gradualmente Leaflet por MapLibre Native, incorporar paquetes offline autorizados y ejecutar un motor de rutas propio. No se deben descargar masivamente teselas desde los servidores públicos de OpenStreetMap.
