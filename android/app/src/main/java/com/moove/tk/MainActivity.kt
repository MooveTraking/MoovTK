package com.moove.tk

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

class MainActivity : AppCompatActivity() {

    private val API = "https://moovtk.onrender.com"

    private val http = OkHttpClient()

    private lateinit var inCpf: EditText
    private lateinit var inPass: EditText
    private lateinit var btnLogin: Button
    private lateinit var btnStart: Button
    private lateinit var btnFinish: Button
    private lateinit var tUser: TextView
    private lateinit var tStatus: TextView

    private val prefs by lazy { getSharedPreferences("moovtk", Context.MODE_PRIVATE) }

    private fun setStatus(s: String) { runOnUiThread { tStatus.text = "Status: $s" } }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        inCpf = findViewById(R.id.inCpf)
        inPass = findViewById(R.id.inPass)
        btnLogin = findViewById(R.id.btnLogin)
        btnStart = findViewById(R.id.btnStart)
        btnFinish = findViewById(R.id.btnFinish)
        tUser = findViewById(R.id.tUser)
        tStatus = findViewById(R.id.tStatus)

        btnLogin.setOnClickListener { doLogin() }
        btnStart.setOnClickListener { startTrip() }
        btnFinish.setOnClickListener { finishTrip() }

        refreshUi()
        ensureLocationPermission()
    }

    private fun refreshUi() {
        val token = prefs.getString("driver_token", "") ?: ""
        val name = prefs.getString("driver_name", "") ?: ""
        val plate = prefs.getString("driver_plate", "") ?: ""
        val tripId = prefs.getString("trip_id", "") ?: ""

        if (token.isNotBlank()) {
            tUser.text = "Logado: $name · $plate"
            btnStart.isEnabled = tripId.isBlank()
            btnFinish.isEnabled = tripId.isNotBlank()
        } else {
            tUser.text = "Não logado"
            btnStart.isEnabled = false
            btnFinish.isEnabled = false
        }
    }

    private fun ensureLocationPermission() {
        val needed = arrayOf(
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION
        )

        val missing = needed.any {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }

        if (missing) {
            ActivityCompat.requestPermissions(this, needed, 101)
        }
    }

    private fun doLogin() {
        val cpf = inCpf.text.toString().trim()
        val pass = inPass.text.toString().trim()
        if (cpf.isBlank() || pass.isBlank()) {
            setStatus("Preencha CPF e senha")
            return
        }

        setStatus("Logando...")

        Thread {
            try {
                val payload = JSONObject()
                payload.put("identifier", cpf)
                payload.put("password", pass)

                val body = payload.toString().toRequestBody("application/json".toMediaType())

                val req = Request.Builder()
                    .url("$API/driver/login")
                    .post(body)
                    .build()

                val resp = http.newCall(req).execute()
                val txt = resp.body?.string() ?: ""

                if (!resp.isSuccessful) {
                    setStatus("Falha login: $txt")
                    return@Thread
                }

                val json = JSONObject(txt)
                val token = json.getString("token")
                val driver = json.getJSONObject("driver")
                val name = driver.getString("name")
                val plate = driver.getString("plate")

                prefs.edit()
                    .putString("driver_token", token)
                    .putString("driver_name", name)
                    .putString("driver_plate", plate)
                    .apply()

                setStatus("Logado")
                runOnUiThread { refreshUi() }

            } catch (e: Exception) {
                setStatus("Erro: ${e.message}")
            }
        }.start()
    }

    private fun startTrip() {
        val token = prefs.getString("driver_token", "") ?: ""
        if (token.isBlank()) { setStatus("Faça login"); return }

        setStatus("Iniciando viagem...")

        Thread {
            try {
                val req = Request.Builder()
                    .url("$API/trip/start")
                    .post("{}".toRequestBody("application/json".toMediaType()))
                    .addHeader("Authorization", "Bearer $token")
                    .build()

                val resp = http.newCall(req).execute()
                val txt = resp.body?.string() ?: ""

                if (!resp.isSuccessful) {
                    setStatus("Falha start: $txt")
                    return@Thread
                }

                val tripId = JSONObject(txt).getString("trip_id")

                prefs.edit().putString("trip_id", tripId).apply()

                val it = Intent(this, TrackingService::class.java)
                it.putExtra("API", API)
                it.putExtra("TOKEN", token)
                it.putExtra("TRIP_ID", tripId)

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    startForegroundService(it)
                } else {
                    startService(it)
                }

                setStatus("Viagem ativa: $tripId")
                runOnUiThread { refreshUi() }

            } catch (e: Exception) {
                setStatus("Erro: ${e.message}")
            }
        }.start()
    }

    private fun finishTrip() {
        val token = prefs.getString("driver_token", "") ?: ""
        val tripId = prefs.getString("trip_id", "") ?: ""
        if (token.isBlank()) { setStatus("Faça login"); return }
        if (tripId.isBlank()) { setStatus("Nenhuma viagem ativa"); return }

        setStatus("Finalizando viagem...")

        Thread {
            try {
                val payload = JSONObject()
                payload.put("trip_id", tripId)

                val req = Request.Builder()
                    .url("$API/trip/finish")
                    .post(payload.toString().toRequestBody("application/json".toMediaType()))
                    .addHeader("Authorization", "Bearer $token")
                    .build()

                val resp = http.newCall(req).execute()
                val txt = resp.body?.string() ?: ""

                if (!resp.isSuccessful) {
                    setStatus("Falha finish: $txt")
                    return@Thread
                }

                stopService(Intent(this, TrackingService::class.java))
                prefs.edit().remove("trip_id").apply()

                setStatus("Viagem finalizada")
                runOnUiThread { refreshUi() }

            } catch (e: Exception) {
                setStatus("Erro: ${e.message}")
            }
        }.start()
    }
}
