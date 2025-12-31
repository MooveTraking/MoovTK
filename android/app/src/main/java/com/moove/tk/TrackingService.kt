package com.moove.tk

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.location.Location
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.google.android.gms.location.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

class TrackingService : Service() {

    private val API = "https://moovtk.onrender.com"
    private val client = OkHttpClient()

    private lateinit var fused: FusedLocationProviderClient
    private lateinit var callback: LocationCallback

    override fun onCreate() {
        super.onCreate()

        fused = LocationServices.getFusedLocationProviderClient(this)

        createNotificationChannel()
        val notif: Notification = NotificationCompat.Builder(this, "moove_tk")
            .setContentTitle("Moove TK")
            .setContentText("Rastreando viagem em tempo real…")
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setOngoing(true)
            .build()

        startForeground(1, notif)

        val req = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 5000)
            .setMinUpdateIntervalMillis(3000)
            .build()

        callback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                val loc = result.lastLocation ?: return
                sendLocation(loc)
            }
        }

        fused.requestLocationUpdates(req, callback, mainLooper)
    }

    private fun sendLocation(loc: Location) {
        val prefs = getSharedPreferences("moove", MODE_PRIVATE)
        val token = prefs.getString("token", null) ?: return
        val tripId = prefs.getString("tripId", null) ?: return

        Thread {
            try {
                val json = JSONObject()
                json.put("trip_id", tripId)
                json.put("ts", System.currentTimeMillis())
                json.put("lat", loc.latitude)
                json.put("lng", loc.longitude)
                json.put("speed", loc.speed.toDouble())
                json.put("accuracy", loc.accuracy.toDouble())

                val body = json.toString().toRequestBody("application/json".toMediaType())
                val req = Request.Builder()
                    .url("$API/position")
                    .post(body)
                    .addHeader("Authorization", "Bearer $token")
                    .addHeader("Content-Type", "application/json")
                    .build()

                client.newCall(req).execute().close()
            } catch (_: Exception) {}
        }.start()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel("moove_tk", "Moove TK", NotificationManager.IMPORTANCE_LOW)
            val nm = getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(ch)
        }
    }

    override fun onDestroy() {
        try { fused.removeLocationUpdates(callback) } catch (_: Exception) {}
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
