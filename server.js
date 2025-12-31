require("dotenv").config();

const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const { q } = require("./db");

const app = express();
app.use(express.json({ limit: "1mb" }));

const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
app.use(cors({
  origin: true,
  credentials: true
}));

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "*");
  next();
});



const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.JWT_SECRET || "change-me";

function signToken(payload, expiresIn) {
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

async function ensureSchema() {
  const schemaPath = path.join(__dirname, "schema.sql");
  const sql = fs.readFileSync(schemaPath, "utf8");
  await q(sql);
}

async function ensureBootstrapAdmin() {
  const email = (process.env.ADMIN_BOOTSTRAP_EMAIL || "").trim().toLowerCase();
  const pass = (process.env.ADMIN_BOOTSTRAP_PASSWORD || "").trim();

  if (!email || !pass) {
    console.log("BOOTSTRAP ADMIN não configurado (ADMIN_BOOTSTRAP_EMAIL/PASSWORD).");
    return;
  }

  const exists = await q("SELECT id FROM admins WHERE email=$1", [email]);
  if (exists.rowCount > 0) return;

  const hash = await bcrypt.hash(pass, 10);
  await q("INSERT INTO admins (email, password_hash) VALUES ($1,$2)", [email, hash]);
  console.log("Admin bootstrap criado:", email);
}

app.get("/", (req, res) => res.json({ ok: true, name: "Moove Tracking API" }));
app.get("/health", (req, res) => res.json({ ok: true }));

// =========================
// ADMIN AUTH
// =========================
app.post("/admin/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const e = (email || "").trim().toLowerCase();
    const p = (password || "").trim();

    if (!e || !p) return res.status(400).json({ error: "Email e senha obrigatórios." });

    const r = await q("SELECT id, email, password_hash FROM admins WHERE email=$1", [e]);
    if (r.rowCount === 0) return res.status(401).json({ error: "Credenciais inválidas." });

    const ok = await bcrypt.compare(p, r.rows[0].password_hash);
    if (!ok) return res.status(401).json({ error: "Credenciais inválidas." });

    const token = signToken({ type: "admin", admin_id: r.rows[0].id, email: r.rows[0].email }, "30d");
    res.json({ token });
  } catch (e) {
    res.status(500).json({ error: "Erro interno." });
  }
});

// =========================
// ADMIN CRUD DRIVERS
// =========================
app.post("/admin/drivers", authAdmin, async (req, res) => {
  try {
    const { cpf, phone, name, plate, password } = req.body || {};

    const CPF = (cpf || "").trim();
    const PHONE = (phone || "").trim() || null;
    const NAME = (name || "").trim();
    const PLATE = (plate || "").trim().toUpperCase();
    const PASS = (password || "").trim();

    if (!CPF || !NAME || !PLATE || !PASS) {
      return res.status(400).json({ error: "cpf, name, plate, password são obrigatórios." });
    }

    const hash = await bcrypt.hash(PASS, 10);

    const r = await q(
      "INSERT INTO drivers (cpf, phone, name, plate, password_hash) VALUES ($1,$2,$3,$4,$5) RETURNING id, cpf, phone, name, plate, is_active, created_at",
      [CPF, PHONE, NAME, PLATE, hash]
    );

    res.json({ driver: r.rows[0] });
  } catch (e) {
    if ((e.message || "").includes("duplicate key")) {
      return res.status(409).json({ error: "CPF já existe." });
    }
    res.status(500).json({ error: "Erro interno." });
  }
});

app.get("/admin/drivers", authAdmin, async (req, res) => {
  try {
    const r = await q(
      "SELECT id, cpf, phone, name, plate, is_active, created_at FROM drivers ORDER BY created_at DESC",
      []
    );
    res.json({ drivers: r.rows });
  } catch (e) {
    res.status(500).json({ error: "Erro interno." });
  }
});

app.patch("/admin/drivers/:id", authAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const { phone, name, plate, password, is_active } = req.body || {};

    const updates = [];
    const vals = [];
    let i = 1;

    if (phone !== undefined) { updates.push(`phone=$${i++}`); vals.push((phone || "").trim() || null); }
    if (name !== undefined) { updates.push(`name=$${i++}`); vals.push((name || "").trim()); }
    if (plate !== undefined) { updates.push(`plate=$${i++}`); vals.push((plate || "").trim().toUpperCase()); }
    if (is_active !== undefined) { updates.push(`is_active=$${i++}`); vals.push(!!is_active); }

    if (password !== undefined && (password || "").trim()) {
      const hash = await bcrypt.hash((password || "").trim(), 10);
      updates.push(`password_hash=$${i++}`);
      vals.push(hash);
    }

    if (updates.length === 0) return res.status(400).json({ error: "Nada para atualizar." });

    vals.push(id);
    const r = await q(
      `UPDATE drivers SET ${updates.join(", ")} WHERE id=$${i} RETURNING id, cpf, phone, name, plate, is_active, created_at`,
      vals
    );

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
      "SELECT id, cpf, name, plate, password_hash, is_active FROM drivers WHERE cpf=$1",
      [cpf]
    );
    if (r.rowCount === 0) return res.status(401).json({ error: "Credenciais inválidas." });
    if (!r.rows[0].is_active) return res.status(403).json({ error: "Usuário desativado." });

    const ok = await bcrypt.compare(pass, r.rows[0].password_hash);
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
// TRIP START / FINISH
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

app.post("/trip/finish", authDriver, async (req, res) => {
  try {
    const driverId = req.driver.driver_id;
    const { trip_id } = req.body || {};
    const tripId = (trip_id || "").trim();
    if (!tripId) return res.status(400).json({ error: "trip_id obrigatório." });

    const r = await q(
      "UPDATE trips SET status='finished', finish_at=NOW() WHERE id=$1 AND driver_id=$2 AND status='active' RETURNING id",
      [tripId, driverId]
    );

    if (r.rowCount === 0) return res.status(404).json({ error: "Viagem ativa não encontrada." });

    res.json({ ok: true });
  } catch (e) {
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

    // valida viagem ativa do próprio motorista
    const t = await q("SELECT id, plate FROM trips WHERE id=$1 AND driver_id=$2 AND status='active'", [tripId, driverId]);
    if (t.rowCount === 0) return res.status(403).json({ error: "Viagem inválida ou finalizada." });

    const plate = t.rows[0].plate || plateFromToken;
    const TS = typeof ts === "number" ? ts : Date.now();

    await q(
      "INSERT INTO positions (trip_id, driver_id, plate, ts, lat, lng, speed, heading, accuracy) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [tripId, driverId, plate, TS, lat, lng, speed ?? null, heading ?? null, accuracy ?? null]
    );

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Erro interno." });
  }
});

// =========================
// ADMIN DASHBOARD ENDPOINTS
// =========================
app.get("/admin/overview", authAdmin, async (req, res) => {
  try {
    const activeTrips = await q("SELECT COUNT(*)::int AS n FROM trips WHERE status='active'", []);
    const drivers = await q("SELECT COUNT(*)::int AS n FROM drivers WHERE is_active=true", []);
    res.json({
      active_trips: activeTrips.rows[0].n,
      active_drivers: drivers.rows[0].n
    });
  } catch (e) {
    res.status(500).json({ error: "Erro interno." });
  }
});

app.get("/admin/trips", authAdmin, async (req, res) => {
  try {
    const status = (req.query.status || "").toString().trim();
    const where = status ? "WHERE t.status=$1" : "";
    const params = status ? [status] : [];
    const r = await q(
      `
      SELECT
        t.id,
        t.status,
        t.start_at,
        t.finish_at,
        t.plate,
        d.name as driver_name,
        d.cpf as driver_cpf
      FROM trips t
      JOIN drivers d ON d.id = t.driver_id
      ${where}
      ORDER BY t.created_at DESC
      LIMIT 200
      `,
      params
    );
    res.json({ trips: r.rows });
  } catch (e) {
    res.status(500).json({ error: "Erro interno." });
  }
});

// “Mapa em tempo real”: retorna a última posição de cada viagem ativa (para plotar no mapa)
app.get("/admin/live", authAdmin, async (req, res) => {
  try {
    const r = await q(
      `
      WITH lastpos AS (
        SELECT DISTINCT ON (p.trip_id)
          p.trip_id,
          p.plate,
          p.lat,
          p.lng,
          p.speed,
          p.heading,
          p.accuracy,
          p.ts,
          p.created_at
        FROM positions p
        ORDER BY p.trip_id, p.created_at DESC
      )
      SELECT
        t.id as trip_id,
        t.plate,
        t.start_at,
        d.name as driver_name,
        d.cpf as driver_cpf,
        lp.lat,
        lp.lng,
        lp.speed,
        lp.heading,
        lp.accuracy,
        lp.ts,
        lp.created_at as last_seen
      FROM trips t
      JOIN drivers d ON d.id = t.driver_id
      LEFT JOIN lastpos lp ON lp.trip_id = t.id
      WHERE t.status='active'
      ORDER BY t.start_at DESC
      `,
      []
    );

    res.json({ live: r.rows });
  } catch (e) {
    res.status(500).json({ error: "Erro interno." });
  }
});

// SSE simples para “quase tempo real” sem WebSocket (o painel pode usar EventSource)
app.get("/admin/stream", authAdmin, async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  let alive = true;
  req.on("close", () => { alive = false; });

  const send = async () => {
    if (!alive) return;

    try {
      const r = await q(
        `
        WITH lastpos AS (
          SELECT DISTINCT ON (p.trip_id)
            p.trip_id, p.plate, p.lat, p.lng, p.speed, p.heading, p.accuracy, p.ts, p.created_at
          FROM positions p
          ORDER BY p.trip_id, p.created_at DESC
        )
        SELECT
          t.id as trip_id,
          t.plate,
          d.name as driver_name,
          d.cpf as driver_cpf,
          lp.lat,
          lp.lng,
          lp.speed,
          lp.heading,
          lp.accuracy,
          lp.ts,
          lp.created_at as last_seen
        FROM trips t
        JOIN drivers d ON d.id = t.driver_id
        LEFT JOIN lastpos lp ON lp.trip_id = t.id
        WHERE t.status='active'
        ORDER BY t.start_at DESC
        `,
        []
      );

      res.write(`event: live\n`);
      res.write(`data: ${JSON.stringify({ live: r.rows, now: Date.now() })}\n\n`);
    } catch (e) {
      res.write(`event: error\n`);
      res.write(`data: ${JSON.stringify({ error: "stream_error" })}\n\n`);
    }

    setTimeout(send, 5000); // a cada 5s
  };

  send();
});

// =========================
// BOOT
// =========================
(async () => {
  try {
    await ensureSchema();
    await ensureBootstrapAdmin();

    app.listen(PORT, () => {
      console.log("Moove Tracking API rodando na porta:", PORT);
    });
  } catch (e) {
    console.error("Falha ao iniciar:", e);
    process.exit(1);
  }
})();
