require("dotenv").config();

console.log("DEPLOY-ATLAS-FIX-2026");

const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const { q } = require("./db");

const app = express();

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// static
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => res.send("MoovTK OK"));
app.get("/health", (req, res) => res.json({ ok: true, ts: Date.now() }));

function signToken(payload, expiresIn = "7d") {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

function authDriver(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Token ausente." });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.type !== "driver") return res.status(403).json({ error: "Token inválido." });
    req.driver = decoded;
    return next();
  } catch (e) {
    return res.status(401).json({ error: "Token inválido/expirado." });
  }
}

function authAdmin(req, res, next) {
  const h = req.headers.authorization || "";
  const fromHeader = h.startsWith("Bearer ") ? h.slice(7) : "";
  const fromQuery = (req.query && req.query.token) ? req.query.token : "";
  const token = fromHeader || fromQuery;

  if (!token) return res.status(401).json({ error: "Token ausente." });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.type !== "admin") return res.status(403).json({ error: "Token inválido." });
    req.admin = decoded;
    return next();
  } catch (e) {
    return res.status(401).json({ error: "Token inválido/expirado." });
  }
}

// =========================
// ADMIN LOGIN
// =========================
app.post("/admin/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const em = (email || "").trim().toLowerCase();
    const pass = (password || "").trim();

    if (!em || !pass) return res.status(400).json({ error: "Email e senha obrigatórios." });

    const r = await q("SELECT id, email, password_hash FROM admins WHERE email=$1", [em]);
    if (r.rowCount === 0) return res.status(401).json({ error: "Credenciais inválidas." });

    const ok = bcrypt.compareSync(pass, r.rows[0].password_hash);
    if (!ok) return res.status(401).json({ error: "Credenciais inválidas." });

    const token = signToken({ type: "admin", admin_id: r.rows[0].id, email: r.rows[0].email }, "30d");

    res.json({ token, admin: { id: r.rows[0].id, email: r.rows[0].email } });
  } catch (e) {
    res.status(500).json({ error: "Erro interno." });
  }
});

// =========================
// ADMIN CREATE DRIVER
// =========================
app.post("/admin/drivers", authAdmin, async (req, res) => {
  try {
    const { cpf, name, plate, password, phone } = req.body || {};
    const c = (cpf || "").trim();
    const n = (name || "").trim();
    const p = (plate || "").trim().toUpperCase();
    const pass = (password || "").trim();
    const ph = (phone || "").trim();

    if (!c || !n || !p || !pass) return res.status(400).json({ error: "CPF, nome, placa e senha são obrigatórios." });

    const hash = bcrypt.hashSync(pass, 10);

    const r = await q(
      "INSERT INTO drivers (cpf, phone, name, plate, password_hash) VALUES ($1,$2,$3,$4,$5) RETURNING id, cpf, phone, name, plate, created_at",
      [c, ph || null, n, p, hash]
    );

    res.json({ driver: r.rows[0] });
  } catch (e) {
    if ((e && e.code) === "23505") return res.status(409).json({ error: "CPF já cadastrado." });
    res.status(500).json({ error: "Erro interno." });
  }
});

// =========================
// ADMIN LIST DRIVERS
// =========================
app.get("/admin/drivers", authAdmin, async (req, res) => {
  try {
    const r = await q(
      "SELECT id, cpf, phone, name, plate, created_at FROM drivers ORDER BY created_at DESC",
      []
    );
    res.json({ drivers: r.rows });
  } catch (e) {
    res.status(500).json({ error: "Erro interno." });
  }
});




// =========================
// ADMIN DELETE DRIVER
// =========================
app.delete("/admin/drivers/:id", authAdmin, async (req, res) => {
  try {
    const id = req.params.id;

    await q("DELETE FROM positions WHERE driver_id = $1", [id]);
    await q("DELETE FROM trips WHERE driver_id = $1", [id]);
    await q("DELETE FROM drivers WHERE id = $1", [id]);

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao excluir motorista." });
  }
});





// =========================
// DRIVER LOOKUP (PUBLIC)
// =========================
app.post("/driver/lookup", async (req, res) => {
  try {
    const { cpf } = req.body || {};
    const c = (cpf || "").trim();
    if (!c) return res.status(400).json({ error: "CPF obrigatório." });

    const r = await q("SELECT id, cpf, name, plate FROM drivers WHERE cpf=$1", [c]);
    if (r.rowCount === 0) return res.status(404).json({ error: "Motorista não encontrado." });
    res.json({ driver: r.rows[0] });
  } catch (e) {
    res.status(500).json({ error: "Erro interno." });
  }
});

// =========================
// DRIVER AUTH (CPF + senha)
// =========================
app.post("/driver/login", async (req, res) => {
  try {
    const { identifier, password } = req.body || {};
    const cpf = (identifier || "").trim();
    const pass = (password || "").trim();

    if (!cpf || !pass) return res.status(400).json({ error: "CPF e senha obrigatórios." });

    const r = await q(
      "SELECT id, cpf, name, plate, password_hash FROM drivers WHERE cpf=$1",
      [cpf]
    );

    if (r.rowCount === 0) return res.status(401).json({ error: "Credenciais inválidas." });

    const ok = bcrypt.compareSync(pass, r.rows[0].password_hash);
    if (!ok) return res.status(401).json({ error: "Credenciais inválidas." });

    const token = signToken(
      { type: "driver", driver_id: r.rows[0].id, cpf: r.rows[0].cpf, plate: r.rows[0].plate },
      "30d"
    );

    res.json({
      token,
      driver: { id: r.rows[0].id, cpf: r.rows[0].cpf, name: r.rows[0].name, plate: r.rows[0].plate }
    });
  } catch (e) {
    res.status(500).json({ error: "Erro interno." });
  }
});

// =========================
// TRIP START
// =========================
app.post("/trip/start", authDriver, async (req, res) => {
  try {
    const driverId = req.driver.driver_id;

    // fecha qualquer active antiga por segurança (opcional)
    await q("UPDATE trips SET status='finished', finish_at=NOW() WHERE driver_id=$1 AND status='active'", [driverId]);

    const dr = await q("SELECT plate FROM drivers WHERE id=$1", [driverId]);
    if (dr.rowCount === 0) return res.status(404).json({ error: "Motorista não encontrado." });

    const plate = dr.rows[0].plate;

    const r = await q(
      "INSERT INTO trips (driver_id, plate, status) VALUES ($1,$2,'active') RETURNING id",
      [driverId, plate]
    );

    res.json({ trip_id: r.rows[0].id });
  } catch (e) {
    res.status(500).json({ error: "Erro interno." });
  }
});

// =========================
// TRIP FINISH
// =========================
app.post("/trip/finish", authDriver, async (req, res) => {
  try {
    const driverId = req.driver.driver_id;
    const { trip_id } = req.body || {};
    const tripId = (trip_id || "").trim();

    if (!tripId) {
      return res.status(400).json({ error: "trip_id obrigatório." });
    }

    const r = await q(
      "UPDATE trips SET status='finished', finish_at=NOW() WHERE id=$1 AND driver_id=$2 AND status='active' RETURNING id",
      [tripId, driverId]
    );

    if (r.rowCount === 0) {
      return res.status(404).json({ error: "Viagem ativa não encontrada." });
    }

    res.json({ ok: true });
  } catch (e) {
    console.error("TRIP FINISH ERROR:", e);
    res.status(500).json({ error: "Erro interno." });
  }
});


// =========================
// POSITION INGEST
// =========================
app.post("/position", authDriver, async (req, res) => {
  try {
    const driverId = req.driver.driver_id;
    const plateFromToken = req.driver.plate;

    const { trip_id, ts, lat, lng, speed, heading, accuracy } = req.body || {};
    const tripId = (trip_id || "").trim();

    if (!tripId) return res.status(400).json({ error: "trip_id obrigatório." });
    if (typeof lat !== "number" || typeof lng !== "number") return res.status(400).json({ error: "lat/lng obrigatórios." });

    // valida viagem ativa e pertencimento
    const tr = await q("SELECT id, plate, status FROM trips WHERE id=$1 AND driver_id=$2", [tripId, driverId]);
    if (tr.rowCount === 0) return res.status(404).json({ error: "Viagem não encontrada." });

    // plate: preferir a da viagem (fonte de verdade), senão do token
    const plate = tr.rows[0].plate || plateFromToken;

    await q(
      `INSERT INTO positions (trip_id, driver_id, plate, ts, lat, lng, speed, heading, accuracy)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        tripId,
        driverId,
        plate,
        typeof ts === "number" ? ts : Date.now(),
        lat,
        lng,
        (typeof speed === "number" ? speed : null),
        (typeof heading === "number" ? heading : null),
        (typeof accuracy === "number" ? accuracy : null)
      ]
    );

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Erro interno." });
  }
});

// =========================
// ADMIN OVERVIEW (counts)
// =========================
app.get("/admin/overview", authAdmin, async (req, res) => {
  try {
    const drivers = await q("SELECT COUNT(*)::int AS c FROM drivers", []);
    const activeTrips = await q("SELECT COUNT(*)::int AS c FROM trips WHERE status='active'", []);
    res.json({ drivers: drivers.rows[0].c, activeTrips: activeTrips.rows[0].c });
  } catch (e) {
    res.status(500).json({ error: "Erro interno." });
  }
});

// =========================
// ADMIN TRIPS
// =========================
app.get("/admin/trips", authAdmin, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || "100", 10) || 100, 500);
    const r = await q(
      `SELECT t.id, t.plate, t.status, t.start_at, t.finish_at, d.name, d.cpf
       FROM trips t
       JOIN drivers d ON d.id=t.driver_id
       ORDER BY t.start_at DESC
       LIMIT $1`,
      [limit]
    );
    res.json({ trips: r.rows });
  } catch (e) {
    res.status(500).json({ error: "Erro interno." });
  }
});

// =========================
// ADMIN LIVE
// =========================
app.get("/admin/live", authAdmin, async (req, res) => {
  try {
    // últimas posições por placa (somente trips ativas)
    const r = await q(
      `
      SELECT DISTINCT ON (p.plate)
        p.plate, p.trip_id, p.ts, p.lat, p.lng, p.speed, p.heading, p.accuracy,
        d.name, d.cpf
      FROM positions p
      JOIN trips t ON t.id=p.trip_id
      JOIN drivers d ON d.id=p.driver_id
      WHERE t.status='active'
      ORDER BY p.plate, p.created_at DESC
      `,
      []
    );

    res.json({ live: r.rows });
  } catch (e) {
    res.status(500).json({ error: "Erro interno." });
  }
});

// =========================
// ADMIN STREAM (SSE)
// =========================
app.get("/admin/stream", authAdmin, async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  let alive = true;
  req.on("close", () => { alive = false; });

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  while (alive) {
    try {
      const live = await q(
        `
        SELECT DISTINCT ON (p.plate)
          p.plate, p.trip_id, p.ts, p.lat, p.lng, p.speed, p.heading, p.accuracy,
          d.name, d.cpf
        FROM positions p
        JOIN trips t ON t.id=p.trip_id
        JOIN drivers d ON d.id=p.driver_id
        WHERE t.status='active'
        ORDER BY p.plate, p.created_at DESC
        `,
        []
      );

      const payload = {
        ts: Date.now(),
        live: { len: live.rowCount, rows: live.rows }
      };

      res.write(`event: live\n`);
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    } catch (e) {
      res.write(`event: live\n`);
      res.write(`data: ${JSON.stringify({ ts: Date.now(), live: { len: 0, rows: [] } })}\n\n`);
    }

    await sleep(2000);
  }
});

app.get("/app", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "tk.html"));
});

app.get("/tk", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "tk.html"));
});

app.listen(PORT, () => {
  console.log("MoovTK running on port", PORT);
});




// =========================
// ADMIN TRIP HISTORY
// =========================
app.get("/admin/trips/:tripId/history", authAdmin, async (req, res) => {
  try {
    const { tripId } = req.params;

    const trip = await q(`
      SELECT t.id, t.plate, t.start_at, t.finish_at, d.name, d.cpf
      FROM trips t
      JOIN drivers d ON d.id = t.driver_id
      WHERE t.id = $1
    `, [tripId]);

    if (trip.rowCount === 0) {
      return res.status(404).json({ error: "Viagem não encontrada" });
    }

    const points = await q(`
      SELECT ts, lat, lng, speed, heading, accuracy
      FROM positions
      WHERE trip_id = $1
      ORDER BY ts ASC
    `, [tripId]);

    res.json({
      trip: trip.rows[0],
      points: points.rows
    });

  } catch (e) {
    res.status(500).json({ error: "Erro ao carregar histórico" });
  }
});






// =========================
// ADMIN TRIPS BY DATE
// =========================
app.get("/admin/trips-by-date", authAdmin, async (req, res) => {
  try {
    const { date } = req.query; // formato YYYY-MM-DD

    const r = await q(`
      SELECT t.id, t.plate, t.start_at, t.finish_at, d.name
      FROM trips t
      JOIN drivers d ON d.id = t.driver_id
      WHERE DATE(t.start_at) = $1
      ORDER BY t.start_at DESC
    `, [date]);

    res.json({ trips: r.rows });

  } catch (e) {
    res.status(500).json({ error: "Erro ao buscar viagens" });
  }
});






app.get("/admin/plates", authAdmin, async (req, res) => {
  const r = await q("SELECT DISTINCT plate FROM drivers ORDER BY plate", []);
  res.json({ plates: r.rows.map(x => x.plate) });
});






app.get("/admin/trips/search", authAdmin, async (req, res) => {
  const { plate, start, end } = req.query;

  const r = await q(`
    SELECT id, plate, start_at, finish_at
    FROM trips
    WHERE plate = $1
      AND start_at >= $2
      AND (finish_at <= $3 OR finish_at IS NULL)
    ORDER BY start_at
  `, [plate, start, end]);

  res.json({ trips: r.rows });
});






app.get("/admin/trips/:id/positions", authAdmin, async (req, res) => {
  try {
    const id = req.params.id;

    const r = await q(
      `SELECT lat, lng
       FROM positions
       WHERE trip_id = $1
       ORDER BY ts ASC`,
      [id]
    );

    // Log para diagnóstico
    console.log(`[HISTÓRICO] Viagem ${id}: ${r.rowCount} pontos`);

    // Se não tem pontos suficientes, devolve cru
    if (r.rowCount < 2) {
      return res.json({ points: r.rows });
    }

    const raw = r.rows;

    // AMOSTRAGEM INTELIGENTE PARA O OSRM
    const MAX_PONTOS_OSRM = 90;
    let sampled = raw;

    if (raw.length > MAX_PONTOS_OSRM) {
      const passo = Math.ceil(raw.length / MAX_PONTOS_OSRM);
      sampled = [];
      
      for (let i = 0; i < raw.length; i += passo) {
        sampled.push(raw[i]);
      }
      
      // Garante último ponto
      const ultimo = raw[raw.length - 1];
      const jaTemUltimo = sampled.some(p => p.lat === ultimo.lat && p.lng === ultimo.lng);
      if (!jaTemUltimo) {
        sampled.push(ultimo);
      }
      
      // Garante primeiro ponto
      const primeiro = raw[0];
      const jaTemPrimeiro = sampled.some(p => p.lat === primeiro.lat && p.lng === primeiro.lng);
      if (!jaTemPrimeiro) {
        sampled.unshift(primeiro);
      }
    }

    // CHAMA O OSRM COM OS PONTOS AMOSTRADOS
    const coords = sampled.map(p => `${p.lng},${p.lat}`).join(";");

    const url =
      `https://router.project-osrm.org/match/v1/driving/${coords}` +
      `?geometries=geojson&overview=full&tidy=true`;

    const resp = await fetch(url);
    const data = await resp.json();

    if (!data.matchings || !data.matchings.length) {
      // Se OSRM falhar, retorna os pontos crus
      return res.json({ points: raw });
    }

    // Converte GeoJSON para formato do seu sistema
    const shape = data.matchings[0].geometry.coordinates.map(c => ({
      lat: c[1],
      lng: c[0]
    }));

    // Se shape vier vazio, retorna pontos crus
    if (!shape || shape.length < 2) {
      return res.json({ points: raw });
    }

    return res.json({ points: shape });

  } catch (e) {
    console.error("[OSRM ERROR]", e.message);
    // Em caso de erro, retorna os pontos crus
    const r = await q(
      `SELECT lat, lng
       FROM positions
       WHERE trip_id = $1
       ORDER BY ts ASC`,
      [req.params.id]
    );
    return res.json({ points: r.rows });
  }
});


