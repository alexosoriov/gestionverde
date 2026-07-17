package cl.rutaverde.navigator;

import android.Manifest;
import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.JsPromptResult;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

public final class MainActivity extends Activity {
    private static final int LOCATION_PERMISSION_REQUEST = 4101;
    private static final String PENDING_FIXES_KEY = "pending_location_fixes";

    private static final String NATIVE_BRIDGE_SCRIPT = """
        (() => {
          if (window.__rutaVerdeNativeInstalled) return;
          window.__rutaVerdeNativeInstalled = true;
          const watchers = new Map();
          const seen = new Set();
          let nextId = 1;
          let lastFix = null;

          const callNative = (action) => {
            try { return window.prompt(`ruta-verde-native:${action}`, "") || ""; }
            catch { return ""; }
          };

          const toPosition = (fix) => ({
            coords: {
              latitude: Number(fix.latitude),
              longitude: Number(fix.longitude),
              accuracy: Number(fix.accuracy || 0),
              altitude: fix.altitude == null ? null : Number(fix.altitude),
              altitudeAccuracy: null,
              heading: fix.heading == null ? null : Number(fix.heading),
              speed: fix.speed == null ? null : Number(fix.speed),
            },
            timestamp: Number(fix.timestamp || Date.now()),
          });

          window.__rutaVerdeNativePush = (fix) => {
            if (!fix || !Number.isFinite(Number(fix.latitude)) || !Number.isFinite(Number(fix.longitude))) return;
            const key = `${fix.timestamp}:${fix.latitude}:${fix.longitude}`;
            if (seen.has(key)) return;
            seen.add(key);
            if (seen.size > 1200) seen.delete(seen.values().next().value);
            lastFix = fix;
            const position = toPosition(fix);
            watchers.forEach(({ success }) => {
              try { success(position); } catch {}
            });
            window.dispatchEvent(new CustomEvent("ruta-verde-native-location", { detail: fix }));
          };

          const nativeGeolocation = {
            watchPosition(success, error) {
              if (typeof success !== "function") throw new TypeError("El callback de ubicación es obligatorio");
              const id = nextId++;
              watchers.set(id, { success, error });
              callNative("start");
              if (lastFix) setTimeout(() => success(toPosition(lastFix)), 0);
              return id;
            },
            clearWatch(id) {
              watchers.delete(Number(id));
              if (watchers.size === 0) callNative("stop");
            },
            getCurrentPosition(success, error) {
              if (lastFix) {
                setTimeout(() => success(toPosition(lastFix)), 0);
                return;
              }
              const id = nextId++;
              watchers.set(id, {
                success: (position) => {
                  watchers.delete(id);
                  try { success(position); } catch {}
                },
                error,
              });
              callNative("start");
            },
          };

          try {
            Object.defineProperty(navigator, "geolocation", {
              configurable: true,
              enumerable: true,
              value: nativeGeolocation,
            });
          } catch {
            try {
              navigator.geolocation.watchPosition = nativeGeolocation.watchPosition;
              navigator.geolocation.clearWatch = nativeGeolocation.clearWatch;
              navigator.geolocation.getCurrentPosition = nativeGeolocation.getCurrentPosition;
            } catch {}
          }

          window.__rutaVerdeNative = {
            platform: "android",
            version: "1.0.0",
            stop: () => callNative("stop"),
          };
          window.dispatchEvent(new CustomEvent("ruta-verde-native-ready", { detail: window.__rutaVerdeNative }));
        })();
        """;

    private WebView webView;
    private boolean receiverRegistered;
    private boolean startAfterPermission;

    private final BroadcastReceiver locationReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            String payload = intent.getStringExtra(LocationTrackingService.EXTRA_LOCATION_JSON);
            if (payload != null) pushLocationToWeb(payload);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.rgb(18, 58, 49));
        getWindow().setNavigationBarColor(Color.rgb(18, 58, 49));

        webView = new WebView(this);
        webView.setLayoutParams(new ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));
        setContentView(webView);
        configureWebView();

        if (savedInstanceState == null) webView.loadUrl(BuildConfig.RUTA_VERDE_URL);
        else webView.restoreState(savedInstanceState);
    }

    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setGeolocationEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setUserAgentString(settings.getUserAgentString() + " RutaVerdeNative/1.0 Android");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) settings.setSafeBrowsingEnabled(true);

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, false);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (isAllowedUri(uri)) return false;
                openExternal(uri);
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (!isAllowedUri(Uri.parse(url))) return;
                injectNativeBridge();
                flushPendingLocations();
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(
                String origin,
                GeolocationPermissions.Callback callback
            ) {
                boolean allow = isAllowedUri(Uri.parse(origin)) && hasLocationPermission();
                callback.invoke(origin, allow, false);
            }

            @Override
            public boolean onJsPrompt(
                WebView view,
                String url,
                String message,
                String defaultValue,
                JsPromptResult result
            ) {
                if (!isAllowedUri(Uri.parse(url)) || message == null || !message.startsWith("ruta-verde-native:")) {
                    return false;
                }
                String action = message.substring("ruta-verde-native:".length());
                if ("start".equals(action)) {
                    ensurePermissionsAndStart();
                    result.confirm("ok");
                    return true;
                }
                if ("stop".equals(action)) {
                    stopLocationService();
                    result.confirm("ok");
                    return true;
                }
                if ("platform".equals(action)) {
                    result.confirm("android");
                    return true;
                }
                result.cancel();
                return true;
            }
        });
    }

    private boolean isAllowedUri(Uri uri) {
        return uri != null
            && "https".equalsIgnoreCase(uri.getScheme())
            && BuildConfig.RUTA_VERDE_HOST.equalsIgnoreCase(uri.getHost());
    }

    private void openExternal(Uri uri) {
        if (uri == null) return;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (Exception ignored) {
            Toast.makeText(this, "No hay una aplicación disponible para abrir el enlace.", Toast.LENGTH_LONG).show();
        }
    }

    private void injectNativeBridge() {
        webView.evaluateJavascript(NATIVE_BRIDGE_SCRIPT, null);
    }

    private void pushLocationToWeb(String payload) {
        if (webView == null) return;
        String quoted = JSONObject.quote(payload);
        String script = "window.__rutaVerdeNativePush && window.__rutaVerdeNativePush(JSON.parse(" + quoted + "));";
        webView.post(() -> webView.evaluateJavascript(script, null));
    }

    private void flushPendingLocations() {
        String raw = getSharedPreferences(LocationTrackingService.STORAGE_NAME, MODE_PRIVATE)
            .getString(PENDING_FIXES_KEY, "[]");
        try {
            JSONArray fixes = new JSONArray(raw);
            for (int index = 0; index < fixes.length(); index++) {
                pushLocationToWeb(fixes.getJSONObject(index).toString());
            }
            getSharedPreferences(LocationTrackingService.STORAGE_NAME, MODE_PRIVATE)
                .edit()
                .putString(PENDING_FIXES_KEY, "[]")
                .apply();
        } catch (Exception ignored) {
            getSharedPreferences(LocationTrackingService.STORAGE_NAME, MODE_PRIVATE)
                .edit()
                .putString(PENDING_FIXES_KEY, "[]")
                .apply();
        }
    }

    private boolean hasLocationPermission() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private void ensurePermissionsAndStart() {
        if (hasLocationPermission()) {
            requestNotificationPermissionIfNeeded();
            startLocationService();
            return;
        }
        startAfterPermission = true;
        requestPermissions(
            new String[] {
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION
            },
            LOCATION_PERMISSION_REQUEST
        );
    }

    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= 33
            && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, LOCATION_PERMISSION_REQUEST + 1);
        }
    }

    private void startLocationService() {
        Intent intent = new Intent(this, LocationTrackingService.class)
            .setAction(LocationTrackingService.ACTION_START);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(intent);
        else startService(intent);
    }

    private void stopLocationService() {
        Intent intent = new Intent(this, LocationTrackingService.class)
            .setAction(LocationTrackingService.ACTION_STOP);
        startService(intent);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != LOCATION_PERMISSION_REQUEST) return;
        boolean granted = hasLocationPermission();
        if (granted && startAfterPermission) {
            startAfterPermission = false;
            requestNotificationPermissionIfNeeded();
            startLocationService();
        } else if (!granted) {
            startAfterPermission = false;
            Toast.makeText(this, getString(R.string.permission_explanation), Toast.LENGTH_LONG).show();
        }
    }

    @Override
    protected void onStart() {
        super.onStart();
        IntentFilter filter = new IntentFilter(LocationTrackingService.ACTION_LOCATION_UPDATE);
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(locationReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(locationReceiver, filter);
        }
        receiverRegistered = true;
        injectNativeBridge();
        flushPendingLocations();
    }

    @Override
    protected void onStop() {
        if (receiverRegistered) {
            unregisterReceiver(locationReceiver);
            receiverRegistered = false;
        }
        super.onStop();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) {
            webView.onResume();
            injectNativeBridge();
            flushPendingLocations();
        }
    }

    @Override
    protected void onPause() {
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        if (webView != null) webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else moveTaskToBack(true);
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.loadUrl("about:blank");
            webView.stopLoading();
            webView.setWebChromeClient(null);
            webView.setWebViewClient(null);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
