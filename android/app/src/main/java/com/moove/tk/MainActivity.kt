package com.moove.tk

import android.Manifest
import android.content.Intent
import android.content.SharedPreferences
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
    private val client = OkHttpClient()
    private lateinit var prefs: SharedPreferences

    private lateinit var etCpf: EditText
    private lateinit var etSenha: EditText
    private lateinit var btnEntrar: Button
    private lateinit var btnIniciar: Button
    private lateinit var btnFinalizar: Button
    private lateinit var tvStatus: TextView

    private var token: String? = null
    private var tripId: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        prefs = getSharedPreferences("moove", MODE_PRIVATE)
        token = prefs.getString("token", null)
        tripId = prefs.getString("tripId", null)

        etCpf = findViewById(R.id.etCpf)
        etSenha = findViewById(R.id.etSenha)
        btnEntrar = findViewById(R.id.btnEntrar)
        btnIniciar = findViewById(R.id.btnIniciar)
        btnFinalizar = findViewById(R.id.btnFinalizar)
        tvStatus = findViewById(R.id.tvStatus)

        requestPerms()

        updateUi()

        btnEntrar.setOnClickListener {
            login(etCpf.text.toString().trim(), etSenha.text.toString().trim())
        }

        btnIniciar.setOnClickListener {
            startTrip()
        }

        btnFinalizar.setOnClickListener {
            finishTrip()
        }
    }

    private fun requestPerms() {
        val perms = mutableListOf(
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION
        )
        if (Build.VERSION.SDK_INT >= 28) perms.add(Manifest.permission.FOREGROUND_SERVICE)

        val missing = perms.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }

        if (missing.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, missing.toTypedArray(), 101)
        }
    }

    private fun updateUi() {
        val logged = token != null
        val active = tripId != null

        btnIniciar.isEnabled = logged && !active
        btnFinalizar.isEnabled = logged && active

        tvStatus.text = when {
            token == null -> "Status: Desconectado"
            tripId == null -> "Status: Logado (sem viagem)"
            else -> "Status: Em viagem (enviando GPS)"
        }
    }

    private fun login(cpf: String, senha: String) {
        if (cpf.isEmpty() || senha.isEmpty()) {
            tvStatus.text = "Status: Informe CPF e senha"
            return
        }

        Thread {
            try {
                val json = JSONObject()
                json.put("identifier", cpf)
                json.put("password", senha)

                val body = json.toString().toRequestBody("application/json".toMediaType())
                val req = Request.Builder()
                    .url("$API/driver/login")
                    .post(body)
                    .build()

                val resp = client.newCall(req).execute()
                val text = resp.body?.string() ?: ""

                runOnUiThread {
                    if (!resp.isSuccessful) {
                        tvStatus.text = "Status: Login falhou"
                        return@runOnUiThread
                    }

                    val data = JSONObject(text)
                    token = data.getString("token")
                    prefs.edit().putString("token", token).apply()

                    tvStatus.text = "Status: Logado (sem viagem)"
                    updateUi()
                }

            } catch (e: Exception) {
                runOnUiThread {
                    tvStatus.text = "Status: Erro no login"
                }
            }
        }.start()
    }

    private fun startTrip() {
        val t = token ?: return

        Thread {
            try {
                val req = Request.Builder()
                    .url("$API/trip/start")
                    .post("{}".toRequestBody("application/json".toMediaType()))
                    .addHeader("Authorization", "Bearer $t")
                    .addHeader("Content-Type", "application/json")
                    .build()

                val resp = client.newCall(req).execute()
                val text = resp.body?.string() ?: ""

                runOnUiThread {
                    if (!resp.isSuccessful) {
                        tvStatus.text = "Status: Falha ao iniciar"
                        return@runOnUiThread
                    }

                    val data = JSONObject(text)
                    tripId = data.getString("trip_id")
                    prefs.edit().putString("tripId", tripId).apply()

                    startService()
                    updateUi()
                }

            } catch (e: Exception) {
                runOnUiThread { tvStatus.text = "Status: Erro ao iniciar" }
            }
        }.start()
    }

    private fun finishTrip() {
        val t = token ?: return
        val trip = tripId ?: return

        Thread {
            try {
                val json = JSONObject()
                json.put("trip_id", trip)

                val body = json.toString().toRequestBody("application/json".toMediaType())
                val req = Request.Builder()
                    .url("$API/trip/finish")
                    .post(body)
                    .addHeader("Authorization", "Bearer $t")
                    .addHeader("Content-Type", "application/json")
                    .build()

                val resp = client.newCall(req).execute()

                runOnUiThread {
                    if (!resp.isSuccessful) {
                        tvStatus.text = "Status: Falha ao finalizar"
                        return@runOnUiThread
                    }

                    stopService()
                    tripId = null
                    prefs.edit().remove("tripId").apply()

                    updateUi()
                }

            } catch (e: Exception) {
                runOnUiThread { tvStatus.text = "Status: Erro ao finalizar" }
            }
        }.start()
    }

    private fun startService() {
        val intent = Intent(this, TrackingService::class.java)
        ContextCompat.startForegroundService(this, intent)
    }

    private fun stopService() {
        stopService(Intent(this, TrackingService::class.java))
    }
}
