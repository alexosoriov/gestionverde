import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function text(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Android native shell declares a visible location foreground service", async () => {
  const [manifest, activity, service, build] = await Promise.all([
    text("native/android/app/src/main/AndroidManifest.xml"),
    text("native/android/app/src/main/java/cl/rutaverde/navigator/MainActivity.java"),
    text("native/android/app/src/main/java/cl/rutaverde/navigator/LocationTrackingService.java"),
    text("native/android/app/build.gradle.kts"),
  ]);

  assert.match(manifest, /android\.permission\.FOREGROUND_SERVICE_LOCATION/);
  assert.match(manifest, /android:foregroundServiceType="location"/);
  assert.match(manifest, /android:usesCleartextTraffic="false"/);
  assert.match(manifest, /android\.permission\.ACCESS_FINE_LOCATION/);
  assert.match(build, /compileSdk = 36/);
  assert.match(build, /RUTA_VERDE_URL.*https:\/\/rutaverde\.cl/);
  assert.match(activity, /MIXED_CONTENT_NEVER_ALLOW/);
  assert.match(activity, /RUTA_VERDE_HOST\.equalsIgnoreCase/);
  assert.match(activity, /Object\.defineProperty\(navigator, "geolocation"/);
  assert.match(activity, /ruta-verde-native:/);
  assert.match(service, /FOREGROUND_SERVICE_TYPE_LOCATION/);
  assert.match(service, /START_STICKY/);
  assert.match(service, /pending_location_fixes/);
  assert.match(service, /MAX_PENDING_FIXES = 600/);
});

test("iPhone native shell declares background location and a main-frame bridge", async () => {
  const [plist, controller, project] = await Promise.all([
    text("native/ios/RutaVerde/Info.plist"),
    text("native/ios/RutaVerde/ViewController.swift"),
    text("native/ios/project.yml"),
  ]);

  assert.match(plist, /NSLocationAlwaysAndWhenInUseUsageDescription/);
  assert.match(plist, /UIBackgroundModes[\s\S]*<string>location<\/string>/);
  assert.match(controller, /injectionTime: \.atDocumentStart/);
  assert.match(controller, /message\.frameInfo\.isMainFrame/);
  assert.match(controller, /allowsBackgroundLocationUpdates = true/);
  assert.match(controller, /showsBackgroundLocationIndicator = true/);
  assert.match(controller, /Object\.defineProperty\(navigator, "geolocation"/);
  assert.match(controller, /private static let allowedHost = "rutaverde\.cl"/);
  assert.match(controller, /maxQueuedFixes = 600/);
  assert.match(project, /PRODUCT_BUNDLE_IDENTIFIER: cl\.rutaverde\.navigator/);
});

test("native Android workflow compiles and preserves the APK", async () => {
  const workflow = await text(".github/workflows/native-android.yml");
  assert.match(workflow, /gradle-version: "9\.5\.0"/);
  assert.match(workflow, /platforms;android-36/);
  assert.match(workflow, /:app:assembleDebug/);
  assert.match(workflow, /app-debug\.apk/);
});
