import "dotenv/config";
import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import { pool } from "./db.js";
import { WebSocketServer } from "ws";

const app = express();
app.use(express.json({ limit: "1mb" }));

const corsOrigin = process.env.CORS_ORIGIN || "*";
app.use(cors({ origin: corsOrigin, credentials: false }));

const JWT_SECRET = process.env.JWT_SECRET || "CHANGE_ME";

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "30d" });
}

function authDriver(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Sem token." });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.type !== "driver") return res.status(403).json({ error: "Token inválido." });
    req.driver = decoded;
    next();
  } catch {
    return res.status(401).json({ error: "Token inválido/expirado." });
  }
}

function authAdmin(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Sem token." });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.type !== "admin") return res.status(403).json({ error: "Token inválido." });
    req.admin = decoded;
    next();
  } catch {
    return res.status(401).json({ error: "Token inválido/expirado." });
  }
}

async function bootstrapAdmin() {
  const email = process.env.ADMIN_BOOTSTRAP_EMAIL;
  const pass = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  if (!email || !pass) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admins (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  const r = await pool.query("SELECT id FROM admins WHERE email=$1", [email]);
  if (r.rowCount > 0) return;

  const hash = await bcrypt.hash(pass, 10);
  await pool.query(
    "INSERT INTO admins (name,email,password_hash) VALUES ($1,$2,$3)",
    ["Admin", email, hash]
  );
  console.log("ADMIN bootstrap criado:", email);
}

// =========================
// WebSocket Broadcast
// =========================
const server = app.listen(process.env.PORT || 3000, async () => {
  console.log("API online");
  await bootstrapAdmin();
});

const wss = new WebSocketServer({ server });
const wsClients = new Set();

wss.on("connection", (ws) => {
  wsClients.add(ws);
  ws.on("close", () => wsClients.delete(ws));
});

function broadcast(event, payload) {
  const msg = JSON.stringify({ event, payload });
  for (const c of wsClients) {
    try { c.send(msg); } catch {}
  }
}

// =========================
// Health
// =========================
app.get("/", (req, res) => res.json({ ok: true, name: "Moove Tracking API" }));

// =========================
// Admin Auth
// =========================
app.post("/admin/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Dados ausentes." });

  const r = await pool.query("SELECT id, name, email, password_hash FROM admins WHERE email=$1", [String(email).toLowerCase()]);
  if (r.rowCount === 0) return res.status(401).json({ error: "Credenciais inválidas." });

  const admin = r.rows[0];
  const ok = await bcrypt.compare(String(password), admin.password_hash);
  if (!ok) return res.status(401).json({ error: "Credenciais inválidas." });

  const token = signToken({ type: "admin", id: admin.id, email: admin.email });
  res.json({ token, admin: { id: admin.id, name: admin.name, email: admin.email } });
});

// =========================
// Admin CRUD Drivers
// =========================
app.post("/admin/drivers", authAdmin, async (req, res) => {
  const { name, cpf, phone, password, plate } = req.body || {};
  if (!name || !cpf || !phone || !password || !plate) return res.status(400).json({ error: "Dados ausentes." });

  const hash = await bcrypt.hash(String(password), 10);
  const r = await pool.query(
    `INSERT INTO drivers (name, cpf, phone, password_hash, plate)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING id, name, cpf, phone, plate, is_active, created_at`,
    [String(name), String(cpf), String(phone), hash, String(plate).toUpperCase()]
  );

  res.json({ ok: true, driver: r.rows[0] });
});

app.get("/admin/drivers", authAdmin, async (req, res) => {
  const r = await pool.query(
    "SELECT id, name, cpf, phone, plate, is_active, created_at FROM drivers ORDER BY id DESC"
  );
  res.json({ drivers: r.rows });
});

app.patch("/admin/drivers/:id", authAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { name, cpf, phone, password, plate, is_active } = req.body || {};

  const cur = await pool.query("SELECT * FROM drivers WHERE id=$1", [id]);
  if (cur.rowCount === 0) return res.status(404).json({ error: "Motorista não encontrado." });

  let hash = null;
  if (password && String(password).trim() !== "") hash = await bcrypt.hash(String(password), 10);

  const next = {
    name: name ?? cur.rows[0].name,
    cpf: cpf ?? cur.rows[0].cpf,
    phone: phone ?? cur.rows[0].phone,
    plate: (plate ?? cur.rows[0].plate).toUpperCase(),
    is_active: typeof is_active === "boolean" ? is_active : cur.rows[0].is_active,
    password_hash: hash ?? cur.rows[0].password_hash
  };

  const r = await pool.query(
    `UPDATE drivers
     SET name=$1, cpf=$2, phone=$3, plate=$4, is_active=$5, password_hash=$6
     WHERE id=$7
     RETURNING id, name, cpf, phone, plate, is_active, created_at`,
    [next.name, next.cpf, next.phone, next.plate, next.is_active, next.password_hash, id]
  );

  res.json({ ok: true, driver: r.rows[0] });
});

// =========================
// Driver Auth
// =========================
app.post("/driver/login", async (req, res) => {
  const { identifier, password } = req.body || {};
  if (!identifier || !password) return res.status(400).json({ error: "Dados ausentes." });

  const idf = String(identifier);
  const r = await pool.query(
    `SELECT id, name, cpf, phone, plate, is_active, password_hash
     FROM drivers
     WHERE cpf=$1 OR phone=$1`,
    [idf]
  );
  if (r.rowCount === 0) return res.status(401).json({ error: "Credenciais inválidas." });

  const d = r.rows[0];
  if (!d.is_active) return res.status(403).json({ error: "Usuário inativo." });

  const ok = await bcrypt.compare(String(password), d.password_hash);
  if (!ok) return res.status(401).json({ error: "Credenciais inválidas." });

  const token = signToken({ type: "driver", id: d.id, plate: d.plate });
  res.json({ token, driver: { id: d.id, name: d.name, plate: d.plate } });
});

// =========================
// Trip Lifecycle
// =========================
app.post("/trip/start", authDriver, async (req, res) => {
  const tripId = uuidv4();
  const driverId = req.driver.id;
  const plate = (req.driver.plate || "").toUpperCase();
  const now = new Date();

  await pool.query(
    `INSERT INTO trips (id, driver_id, plate, status, started_at, last_seen_at)
     VALUES ($1,$2,$3,'started',$4,$4)`,
    [tripId, driverId, plate, now]
  );

  broadcast("trip_started", { trip_id: tripId, driver_id: driverId, plate, started_at: now.toISOString() });
  res.json({ ok: true, trip_id: tripId, plate });
});

app.post("/trip/pause", authDriver, async (req, res) => {
  const { trip_id } = req.body || {};
  if (!trip_id) return res.status(400).json({ error: "trip_id ausente." });

  const r = await pool.query(
    `UPDATE trips
     SET status='paused', last_seen_at=NOW()
     WHERE id=$1 AND driver_id=$2
     RETURNING id, status, plate`,
    [String(trip_id), req.driver.id]
  );
  if (r.rowCount === 0) return res.status(404).json({ error: "Viagem não encontrada." });

  broadcast("trip_paused", { trip_id, driver_id: req.driver.id, plate: r.rows[0].plate });
  res.json({ ok: true });
});

app.post("/trip/finish", authDriver, async (req, res) => {
  const { trip_id } = req.body || {};
  if (!trip_id) return res.status(400).json({ error: "trip_id ausente." });

  const r = await pool.query(
    `UPDATE trips
     SET status='finished', ended_at=NOW(), last_seen_at=NOW()
     WHERE id=$1 AND driver_id=$2
     RETURNING id, status, plate`,
    [String(trip_id), req.driver.id]
  );
  if (r.rowCount === 0) return res.status(404).json({ error: "Viagem não encontrada." });

  broadcast("trip_finished", { trip_id, driver_id: req.driver.id, plate: r.rows[0].plate });
  res.json({ ok: true });
});

// =========================
// Position Ingest
// =========================
app.post("/position", authDriver, async (req, res) => {
  const {
    trip_id, ts, lat, lng, speed, heading, accuracy, battery
  } = req.body || {};

  if (!trip_id || lat == null || lng == null) {
    return res.status(400).json({ error: "Dados ausentes (trip_id/lat/lng)." });
  }

  const driverId = req.driver.id;
  const plate = (req.driver.plate || "").toUpperCase();
  const t = ts ? new Date(ts) : new Date();

  await pool.query(
    `INSERT INTO positions (trip_id, driver_id, plate, ts, lat, lng, speed, heading, accuracy, battery)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [String(trip_id), driverId, plate, t, Number(lat), Number(lng),
      speed == null ? null : Number(speed),
      heading == null ? null : Number(heading),
      accuracy == null ? null : Number(accuracy),
      battery == null ? null : Number(battery)
    ]
  );

  const upd = await pool.query(
    `UPDATE trips
     SET last_lat=$1, last_lng=$2, last_speed=$3, last_heading=$4, last_accuracy=$5, last_battery=$6, last_seen_at=NOW()
     WHERE id=$7 AND driver_id=$8
     RETURNING id, status, plate, last_lat, last_lng, last_speed, last_seen_at`,
    [Number(lat), Number(lng),
      speed == null ? null : Number(speed),
      heading == null ? null : Number(heading),
      accuracy == null ? null : Number(accuracy),
      battery == null ? null : Number(battery),
      String(trip_id), driverId
    ]
  );

  if (upd.rowCount > 0) {
    broadcast("position", {
      trip_id: upd.rows[0].id,
      plate: upd.rows[0].plate,
      status: upd.rows[0].status,
      lat: upd.rows[0].last_lat,
      lng: upd.rows[0].last_lng,
      speed: upd.rows[0].last_speed,
      last_seen_at: upd.rows[0].last_seen_at
    });
  }

  res.json({ ok: true });
});

// =========================
// Dashboard Data (Web)
// =========================
app.get("/dashboard/trips", async (req, res) => {
  const days = Math.max(1, Math.min(30, Number(req.query.days || 30)));
  const r = await pool.query(
    `SELECT
       t.id, t.plate, t.status, t.started_at, t.ended_at,
       t.last_lat, t.last_lng, t.last_speed, t.last_seen_at,
       d.name AS driver_name
     FROM trips t
     JOIN drivers d ON d.id=t.driver_id
     WHERE t.started_at >= NOW() - ($1 || ' days')::interval
     ORDER BY t.started_at DESC
     LIMIT 500`,
    [days]
  );
  res.json({ trips: r.rows });
});
