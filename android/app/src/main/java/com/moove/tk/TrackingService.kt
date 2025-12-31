package com.moove.tk

import android.Manifest
import android.app.*
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.os.Build
import android.os.IBinder
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import com.google.android.gms.location.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

class TrackingService : Service() {

    private val http = OkHttpClient()

    private lateinit var fused: FusedLocationProviderClient
    private var callback: LocationCallback? = null

    private var api = ""
    private var token = ""
    private var tripId = ""

    override fun onCreate() {
        super.onCreate()
        fused = LocationServices.getFusedLocationProviderClient(this)
        startAsForeground()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        api = intent?.getStringExtra("API") ?: ""
        token = intent?.getStringExtra("TOKEN") ?: ""
        tripId = intent?.getStringExtra("TRIP_ID") ?: ""

        if (api.isBlank() || token.isBlank() || tripId.isBlank()) {
            stopSelf()
            return START_NOT_STICKY
        }

        startLocation()
        return START_STICKY
    }

    private fun startAsForeground() {
        val channelId = "moovtk_tracking"

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val chan = NotificationChannel(
                channelId,
                "Rastreamento",
                NotificationManager.IMPORTANCE_LOW
            )
            val nm = getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(chan)
        }

        val notif = NotificationCompat.Builder(this, channelId)
            .setContentTitle("MooveTK")
            .setContentText("Rastreando viagem...")
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setOngoing(true)
            .build()

        startForeground(1, notif)
    }

    private fun startLocation() {
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED &&
            ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED
        ) {
            stopSelf()
            return
        }

        val req = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 10_000L) // 10s
            .setMinUpdateIntervalMillis(10_000L)
            .setMinUpdateDistanceMeters(20f)
            .build()

        callback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                val loc = result.lastLocation ?: return
                sendPosition(loc)
            }
        }

        fused.requestLocationUpdates(req, callback as LocationCallback, mainLooper)
    }

    private fun sendPosition(loc: Location) {
        Thread {
            try {
                val payload = JSONObject()
                payload.put("trip_id", tripId)
                payload.put("ts", System.currentTimeMillis())
                payload.put("lat", loc.latitude)
                payload.put("lng", loc.longitude)
                payload.put("speed", loc.speed.toDouble())
                payload.put("heading", loc.bearing.toDouble())
                payload.put("accuracy", loc.accuracy.toDouble())

                val body = payload.toString().toRequestBody("application/json".toMediaType())

                val req = Request.Builder()
                    .url("$api/position")
                    .post(body)
                    .addHeader("Authorization", "Bearer $token")
                    .build()

                http.newCall(req).execute().close()
            } catch (_: Exception) {}
        }.start()
    }

    override fun onDestroy() {
        callback?.let { fused.removeLocationUpdates(it) }
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
