package cl.rutaverde.navigator;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;

import org.json.JSONArray;
import org.json.JSONObject;

public final class LocationTrackingService extends Service implements LocationListener {
    public static final String ACTION_START = "cl.rutaverde.navigator.START_TRACKING";
    public static final String ACTION_STOP = "cl.rutaverde.navigator.STOP_TRACKING";
    public static final String ACTION_LOCATION_UPDATE = "cl.rutaverde.navigator.LOCATION_UPDATE";
    public static final String EXTRA_LOCATION_JSON = "location_json";
    public static final String STORAGE_NAME = "ruta_verde_native_location";

    private static final String PENDING_FIXES_KEY = "pending_location_fixes";
    private static final String CHANNEL_ID = "ruta_verde_location";
    private static final int NOTIFICATION_ID = 4107;
    private static final long MIN_TIME_MS = 2_000L;
    private static final float MIN_DISTANCE_METERS = 2.0f;
    private static final int MAX_PENDING_FIXES = 600;

    private LocationManager locationManager;
    private boolean tracking;

    @Override
    public void onCreate() {
        super.onCreate();
        locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? ACTION_START : intent.getAction();
        if (ACTION_STOP.equals(action)) {
            stopTracking();
            stopSelf();
            return START_NOT_STICKY;
        }
        startTracking();
        return START_STICKY;
    }

    private void startTracking() {
        if (tracking) return;
        if (!hasLocationPermission()) {
            stopSelf();
            return;
        }

        Notification notification = buildNotification();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
            );
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }

        try {
            boolean providerAvailable = false;
            if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                locationManager.requestLocationUpdates(
                    LocationManager.GPS_PROVIDER,
                    MIN_TIME_MS,
                    MIN_DISTANCE_METERS,
                    this
                );
                providerAvailable = true;
            }
            if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                locationManager.requestLocationUpdates(
                    LocationManager.NETWORK_PROVIDER,
                    5_000L,
                    5.0f,
                    this
                );
                providerAvailable = true;
            }
            tracking = providerAvailable;
            if (!providerAvailable) stopSelf();
        } catch (SecurityException exception) {
            stopSelf();
        }
    }

    private void stopTracking() {
        if (locationManager != null) {
            try {
                locationManager.removeUpdates(this);
            } catch (SecurityException ignored) {}
        }
        tracking = false;
        stopForeground(STOP_FOREGROUND_REMOVE);
    }

    private boolean hasLocationPermission() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            getString(R.string.location_channel_name),
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription(getString(R.string.location_channel_description));
        channel.setShowBadge(false);
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.createNotificationChannel(channel);
    }

    private Notification buildNotification() {
        Intent openIntent = new Intent(this, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent openPendingIntent = PendingIntent.getActivity(
            this,
            1,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Intent stopIntent = new Intent(this, LocationTrackingService.class).setAction(ACTION_STOP);
        PendingIntent stopPendingIntent = PendingIntent.getService(
            this,
            2,
            stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);

        return builder
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle(getString(R.string.location_notification_title))
            .setContentText(getString(R.string.location_notification_text))
            .setContentIntent(openPendingIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_SERVICE)
            .addAction(android.R.drawable.ic_media_pause, "Detener GPS", stopPendingIntent)
            .build();
    }

    @Override
    public void onLocationChanged(Location location) {
        try {
            JSONObject fix = new JSONObject();
            fix.put("latitude", location.getLatitude());
            fix.put("longitude", location.getLongitude());
            fix.put("accuracy", location.hasAccuracy() ? location.getAccuracy() : 0);
            fix.put("speed", location.hasSpeed() ? location.getSpeed() : JSONObject.NULL);
            fix.put("heading", location.hasBearing() ? location.getBearing() : JSONObject.NULL);
            fix.put("altitude", location.hasAltitude() ? location.getAltitude() : JSONObject.NULL);
            fix.put("timestamp", location.getTime() > 0 ? location.getTime() : System.currentTimeMillis());
            fix.put("provider", location.getProvider() == null ? "native" : location.getProvider());

            appendPendingFix(fix);
            Intent update = new Intent(ACTION_LOCATION_UPDATE)
                .setPackage(getPackageName())
                .putExtra(EXTRA_LOCATION_JSON, fix.toString());
            sendBroadcast(update);
        } catch (Exception ignored) {}
    }

    private synchronized void appendPendingFix(JSONObject fix) {
        String raw = getSharedPreferences(STORAGE_NAME, MODE_PRIVATE)
            .getString(PENDING_FIXES_KEY, "[]");
        JSONArray fixes;
        try {
            fixes = new JSONArray(raw);
        } catch (Exception ignored) {
            fixes = new JSONArray();
        }
        while (fixes.length() >= MAX_PENDING_FIXES) fixes.remove(0);
        fixes.put(fix);
        getSharedPreferences(STORAGE_NAME, MODE_PRIVATE)
            .edit()
            .putString(PENDING_FIXES_KEY, fixes.toString())
            .apply();
    }

    @Override
    public void onProviderEnabled(String provider) {}

    @Override
    public void onProviderDisabled(String provider) {}

    @Override
    public void onStatusChanged(String provider, int status, Bundle extras) {}

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        stopTracking();
        super.onDestroy();
    }
}
