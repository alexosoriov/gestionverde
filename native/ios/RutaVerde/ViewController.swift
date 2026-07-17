import CoreLocation
import UIKit
import WebKit

private final class WeakScriptMessageHandler: NSObject, WKScriptMessageHandler {
    weak var delegate: WKScriptMessageHandler?

    init(delegate: WKScriptMessageHandler) {
        self.delegate = delegate
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        delegate?.userContentController(userContentController, didReceive: message)
    }
}

final class ViewController: UIViewController, WKNavigationDelegate, WKScriptMessageHandler, CLLocationManagerDelegate {
    private static let appURL = URL(string: "https://rutaverde.cl")!
    private static let allowedHost = "rutaverde.cl"
    private static let queueKey = "ruta-verde-native-location-fixes"
    private static let maxQueuedFixes = 600

    private var webView: WKWebView!
    private let locationManager = CLLocationManager()
    private var trackingRequested = false
    private var pageLoaded = false

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 18 / 255, green: 58 / 255, blue: 49 / 255, alpha: 1)
        configureLocationManager()
        configureWebView()
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(applicationDidBecomeActive),
            name: UIApplication.didBecomeActiveNotification,
            object: nil
        )
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "rutaVerdeNative")
    }

    private func configureLocationManager() {
        locationManager.delegate = self
        locationManager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
        locationManager.distanceFilter = 2
        locationManager.activityType = .automotiveNavigation
        locationManager.pausesLocationUpdatesAutomatically = false
    }

    private func configureWebView() {
        let contentController = WKUserContentController()
        contentController.addUserScript(
            WKUserScript(
                source: Self.nativeBridgeScript,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
        )
        contentController.add(WeakScriptMessageHandler(delegate: self), forName: "rutaVerdeNative")

        let configuration = WKWebViewConfiguration()
        configuration.userContentController = contentController
        configuration.websiteDataStore = .default()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []

        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.navigationDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.customUserAgent = "RutaVerdeNative/1.0 iOS"
        view.addSubview(webView)

        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])

        webView.load(URLRequest(url: Self.appURL, cachePolicy: .useProtocolCachePolicy, timeoutInterval: 30))
    }

    private static let nativeBridgeScript = """
    (() => {
      if (window.__rutaVerdeNativeInstalled) return;
      window.__rutaVerdeNativeInstalled = true;
      const watchers = new Map();
      const seen = new Set();
      let nextId = 1;
      let lastFix = null;

      const callNative = (action) => {
        try { window.webkit.messageHandlers.rutaVerdeNative.postMessage({ action }); }
        catch {}
      };

      const toPosition = (fix) => ({
        coords: {
          latitude: Number(fix.latitude),
          longitude: Number(fix.longitude),
          accuracy: Number(fix.accuracy || 0),
          altitude: fix.altitude == null ? null : Number(fix.altitude),
          altitudeAccuracy: fix.verticalAccuracy == null ? null : Number(fix.verticalAccuracy),
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
        platform: "ios",
        version: "1.0.0",
        stop: () => callNative("stop"),
      };
      window.dispatchEvent(new CustomEvent("ruta-verde-native-ready", { detail: window.__rutaVerdeNative }));
    })();
    """

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "rutaVerdeNative", message.frameInfo.isMainFrame else { return }
        guard let body = message.body as? [String: Any], let action = body["action"] as? String else { return }
        switch action {
        case "start":
            startNativeTracking()
        case "stop":
            stopNativeTracking()
        default:
            break
        }
    }

    private func startNativeTracking() {
        trackingRequested = true
        guard CLLocationManager.locationServicesEnabled() else {
            presentLocationAlert("Activa los servicios de ubicación del iPhone para comenzar la jornada.")
            return
        }

        switch locationManager.authorizationStatus {
        case .notDetermined:
            locationManager.requestAlwaysAuthorization()
        case .authorizedWhenInUse:
            locationManager.requestAlwaysAuthorization()
            beginLocationUpdates()
        case .authorizedAlways:
            beginLocationUpdates()
        case .denied, .restricted:
            presentLocationAlert("Permite la ubicación en Ajustes → Ruta Verde → Ubicación → Siempre.")
        @unknown default:
            presentLocationAlert("No fue posible comprobar el permiso de ubicación.")
        }
    }

    private func beginLocationUpdates() {
        locationManager.allowsBackgroundLocationUpdates = true
        locationManager.showsBackgroundLocationIndicator = true
        locationManager.startUpdatingLocation()
    }

    private func stopNativeTracking() {
        trackingRequested = false
        locationManager.stopUpdatingLocation()
        locationManager.allowsBackgroundLocationUpdates = false
        locationManager.showsBackgroundLocationIndicator = false
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard trackingRequested else { return }
        switch manager.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse:
            beginLocationUpdates()
        case .denied, .restricted:
            presentLocationAlert("Ruta Verde no puede registrar el recorrido sin permiso de ubicación.")
        default:
            break
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        for location in locations where location.horizontalAccuracy >= 0 {
            let fix: [String: Any] = [
                "latitude": location.coordinate.latitude,
                "longitude": location.coordinate.longitude,
                "accuracy": location.horizontalAccuracy,
                "verticalAccuracy": location.verticalAccuracy >= 0 ? location.verticalAccuracy : NSNull(),
                "speed": location.speed >= 0 ? location.speed : NSNull(),
                "heading": location.course >= 0 ? location.course : NSNull(),
                "altitude": location.altitude,
                "timestamp": location.timestamp.timeIntervalSince1970 * 1000,
                "provider": "core-location",
            ]
            enqueue(fix)
            pushToWeb(fix)
        }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        guard let locationError = error as? CLError, locationError.code == .denied else { return }
        stopNativeTracking()
        presentLocationAlert("El sistema detuvo la ubicación. Revisa el permiso de Ruta Verde.")
    }

    private func enqueue(_ fix: [String: Any]) {
        var fixes = queuedFixes()
        fixes.append(fix)
        if fixes.count > Self.maxQueuedFixes {
            fixes.removeFirst(fixes.count - Self.maxQueuedFixes)
        }
        guard JSONSerialization.isValidJSONObject(fixes),
              let data = try? JSONSerialization.data(withJSONObject: fixes) else { return }
        UserDefaults.standard.set(data, forKey: Self.queueKey)
    }

    private func queuedFixes() -> [[String: Any]] {
        guard let data = UserDefaults.standard.data(forKey: Self.queueKey),
              let object = try? JSONSerialization.jsonObject(with: data),
              let fixes = object as? [[String: Any]] else { return [] }
        return fixes
    }

    private func flushQueuedFixes() {
        let fixes = queuedFixes()
        guard !fixes.isEmpty else { return }
        for fix in fixes { pushToWeb(fix) }
        UserDefaults.standard.removeObject(forKey: Self.queueKey)
    }

    private func pushToWeb(_ fix: [String: Any]) {
        guard JSONSerialization.isValidJSONObject(fix),
              let data = try? JSONSerialization.data(withJSONObject: fix),
              let json = String(data: data, encoding: .utf8) else { return }
        DispatchQueue.main.async { [weak self] in
            self?.webView.evaluateJavaScript(
                "window.__rutaVerdeNativePush && window.__rutaVerdeNativePush(\(json));",
                completionHandler: nil
            )
        }
    }

    private func injectBridgeAndFlush() {
        webView.evaluateJavaScript(Self.nativeBridgeScript) { [weak self] _, _ in
            self?.flushQueuedFixes()
        }
    }

    @objc private func applicationDidBecomeActive() {
        guard pageLoaded else { return }
        injectBridgeAndFlush()
    }

    private func presentLocationAlert(_ message: String) {
        guard presentedViewController == nil else { return }
        let alert = UIAlertController(title: "Ubicación necesaria", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Entendido", style: .default))
        alert.addAction(UIAlertAction(title: "Abrir Ajustes", style: .default) { _ in
            guard let settings = URL(string: UIApplication.openSettingsURLString) else { return }
            UIApplication.shared.open(settings)
        })
        present(alert, animated: true)
    }

    private func isAllowed(_ url: URL) -> Bool {
        url.scheme?.lowercased() == "https" && url.host?.lowercased() == Self.allowedHost
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }
        if url.scheme == "about" {
            decisionHandler(.allow)
            return
        }
        if isAllowed(url) {
            if navigationAction.targetFrame == nil {
                webView.load(navigationAction.request)
                decisionHandler(.cancel)
            } else {
                decisionHandler(.allow)
            }
            return
        }
        UIApplication.shared.open(url)
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        pageLoaded = true
        injectBridgeAndFlush()
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        pageLoaded = false
        webView.reload()
    }
}
