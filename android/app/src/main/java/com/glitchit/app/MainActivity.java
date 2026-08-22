package com.glitchit.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private static final int PERMISSION_REQUEST_CODE = 100;
    private static final String[] REQUIRED_PERMISSIONS = {
        Manifest.permission.CAMERA,
        Manifest.permission.RECORD_AUDIO,
        Manifest.permission.ACCESS_FINE_LOCATION,
        Manifest.permission.ACCESS_COARSE_LOCATION
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestAppPermissions();
    }

    /**
     * Request all permissions the app uses (camera, microphone, location) at
     * startup so the WebView never silently fails when getUserMedia / geolocation
     * is called. On Android 6+ the user sees a system dialog for each permission
     * that hasn't been granted yet. On older devices the manifest entries alone
     * are sufficient.
     */
    private void requestAppPermissions() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return;

        java.util.List<String> needed = new java.util.ArrayList<>();
        for (String perm : REQUIRED_PERMISSIONS) {
            if (ContextCompat.checkSelfPermission(this, perm) != PackageManager.PERMISSION_GRANTED) {
                needed.add(perm);
            }
        }
        if (!needed.isEmpty()) {
            ActivityCompat.requestPermissions(this, needed.toArray(new String[0]), PERMISSION_REQUEST_CODE);
        }
    }
}
