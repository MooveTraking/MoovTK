import express from "express";
import pool from "./db.js";

const router = express.Router();

router.post("/gps", async (req, res) => {
  try {
    const {
      device_id,
      trip_id,
      lat,
      lon,
      speed,
      accuracy,
      battery
    } = req.body;

    await pool.query(
      `INSERT INTO gps_logs
       (device_id, trip_id, latitude, longitude, speed, accuracy, battery)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [device_id, trip_id, lat, lon, speed, accuracy, battery]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error("GPS ERROR:", err);
    res.status(500).json({ error: "gps error" });
  }
});

export default router;
