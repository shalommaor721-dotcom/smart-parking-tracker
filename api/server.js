// Smart Parking Tracker - API server (Track 2)
// Receives license plates from the IoT camera (POST) and serves the dashboard (GET).
// Data lives in Redis, which persists to a Docker volume (AOF).

const express = require('express');
const { createClient } = require('redis');

const PORT = process.env.PORT || 3000;
const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';
const CAPACITY = parseInt(process.env.CAPACITY || '8', 10);
const PRICE_PER_HOUR = parseFloat(process.env.PRICE_PER_HOUR || '12'); // personal feature: pricing

// Redis keys
const K_INSIDE = 'parking:inside'; // ZSET: plate -> entry timestamp (ms)
const K_TOTAL = 'parking:total_entries'; // counter of all entries ever
const K_REVENUE = 'parking:revenue'; // total money collected
const K_LOG = 'parking:log'; // LIST of recent events (JSON)

const redis = createClient({ url: REDIS_URL });
redis.on('error', (err) => console.error('Redis error:', err.message));

const app = express();
app.use(express.json());

// Israeli plates are 7-8 digits; we also allow letters/dashes so the
// camera simulator can send VIP-style plates.
const PLATE_RE = /^[A-Z0-9-]{3,10}$/;
const normalize = (p) => String(p || '').trim().toUpperCase();

// price = every started hour is charged, minimum one hour
function calcPrice(enteredAt, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - enteredAt) / 60000));
  const hours = Math.max(1, Math.ceil(minutes / 60));
  return { minutes, price: hours * PRICE_PER_HOUR };
}

async function log(type, plate, extra = {}) {
  const entry = JSON.stringify({ type, plate, at: Date.now(), ...extra });
  await redis.lPush(K_LOG, entry);
  await redis.lTrim(K_LOG, 0, 49); // keep the last 50 events
}

// ---- POST: the camera reports a car entering ----
app.post('/api/plates', async (req, res) => {
  try {
    const plate = normalize(req.body && req.body.plate);
    if (!PLATE_RE.test(plate)) {
      return res.status(400).json({ error: 'Invalid plate. Use 3-10 chars: A-Z, 0-9, -' });
    }
    // Check duplicates BEFORE capacity, so a car that is already inside
    // gets the right error even when the lot is full.
    if ((await redis.zScore(K_INSIDE, plate)) !== null) {
      return res.status(409).json({ error: 'Car is already inside', plate });
    }
    const occupied = await redis.zCard(K_INSIDE);
    if (occupied >= CAPACITY) {
      await log('rejected_full', plate);
      return res.status(409).json({ error: 'Parking lot is FULL', full: true, capacity: CAPACITY });
    }
    const enteredAt = Date.now();
    await redis.zAdd(K_INSIDE, { score: enteredAt, value: plate });
    await redis.incr(K_TOTAL);
    await log('entered', plate);
    res.status(201).json({ plate, enteredAt, occupied: occupied + 1, capacity: CAPACITY });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ---- GET: the dashboard polls this ----
app.get('/api/plates', async (_req, res) => {
  try {
    const now = Date.now();
    const rows = await redis.zRangeWithScores(K_INSIDE, 0, -1, { REV: true }); // newest first
    const cars = rows.map(({ value, score }) => ({
      plate: value,
      enteredAt: score,
      ...calcPrice(score, now),
    }));
    const [total, revenue, rawLog] = await Promise.all([
      redis.get(K_TOTAL),
      redis.get(K_REVENUE),
      redis.lRange(K_LOG, 0, 9),
    ]);
    res.json({
      capacity: CAPACITY,
      occupied: cars.length,
      free: Math.max(0, CAPACITY - cars.length),
      full: cars.length >= CAPACITY,
      pricePerHour: PRICE_PER_HOUR,
      totalEntries: parseInt(total || '0', 10),
      revenue: parseFloat(revenue || '0'),
      cars,
      events: rawLog.map((l) => JSON.parse(l)),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ---- Release a car (the "release" button) ----
app.post('/api/plates/:plate/release', async (req, res) => {
  try {
    const plate = normalize(req.params.plate);
    const enteredAt = await redis.zScore(K_INSIDE, plate);
    if (enteredAt === null) return res.status(404).json({ error: 'Car not found', plate });
    const { minutes, price } = calcPrice(enteredAt);
    await redis.zRem(K_INSIDE, plate);
    await redis.incrByFloat(K_REVENUE, price);
    await log('released', plate, { minutes, price });
    res.json({ plate, minutes, price });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.get('/api/health', (_req, res) => res.json({ status: 'ok', redis: redis.isReady }));

(async () => {
  await redis.connect();
  app.listen(PORT, () => console.log(`API listening on :${PORT} (capacity=${CAPACITY})`));
})().catch((e) => {
  console.error('Startup failed', e);
  process.exit(1);
});
