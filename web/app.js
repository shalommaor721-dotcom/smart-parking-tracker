// Dashboard logic: polls the API with fetch() and builds the UI dynamically
// (Dynamic DOM Manipulation - no page refresh needed).

const POLL_MS = 2000;
const $ = (id) => document.getElementById(id);

// ---------- helpers ----------
function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text; // textContent = safe against XSS
  if (className) node.className = className;
  return node;
}

function showToast(msg, isError = false) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast' + (isError ? ' error' : '');
  setTimeout(() => t.classList.add('hidden'), 3000);
}

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmtDuration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ---------- rendering ----------
function renderCars(cars) {
  const body = $('cars-body');
  body.replaceChildren(); // clear and rebuild
  $('empty-msg').classList.toggle('hidden', cars.length > 0);

  for (const car of cars) {
    const tr = el('tr');
    tr.appendChild(el('td', car.plate, 'plate'));
    tr.appendChild(el('td', fmtTime(car.enteredAt)));
    tr.appendChild(el('td', fmtDuration(car.minutes)));
    tr.appendChild(el('td', String(car.price)));

    const td = el('td');
    const btn = el('button', 'Release', 'release');
    btn.addEventListener('click', () => releaseCar(car.plate));
    td.appendChild(btn);
    tr.appendChild(td);
    body.appendChild(tr);
  }
}

const EVENT_TEXT = {
  entered: (e) => `🟢 ${e.plate} entered`,
  released: (e) => `🔴 ${e.plate} left after ${fmtDuration(e.minutes)} and paid ₪${e.price}`,
  rejected_full: (e) => `⛔ ${e.plate} rejected - parking is full`,
};

function renderEvents(events) {
  const ul = $('events');
  ul.replaceChildren();
  for (const e of events) {
    const text = (EVENT_TEXT[e.type] || ((x) => x.type))(e);
    ul.appendChild(el('li', `${fmtTime(e.at)}  ${text}`));
  }
}

function render(data) {
  $('stat-occupied').textContent = `${data.occupied} / ${data.capacity}`;
  $('stat-free').textContent = data.free;
  $('stat-total').textContent = data.totalEntries;
  $('stat-revenue').textContent = data.revenue.toFixed(0);

  const pct = Math.round((data.occupied / data.capacity) * 100);
  const fill = $('capacity-fill');
  fill.style.width = pct + '%';
  fill.className = pct >= 100 ? 'full' : pct >= 75 ? 'warn' : '';

  $('full-alert').classList.toggle('hidden', !data.full); // Full Capacity Alert
  renderCars(data.cars);
  renderEvents(data.events);
}

// ---------- API calls ----------
async function refresh() {
  try {
    const res = await fetch('/api/plates');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    render(await res.json());
  } catch (err) {
    console.error('Refresh failed', err);
  }
}

async function releaseCar(plate) {
  const res = await fetch(`/api/plates/${encodeURIComponent(plate)}/release`, { method: 'POST' });
  const data = await res.json();
  if (res.ok) showToast(`${plate} released. Fee: ₪${data.price}`);
  else showToast(data.error, true);
  refresh();
}

// Fake camera: sends a random plate exactly like the real IoT camera would
function randomPlate() {
  const digits = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');
  return Math.random() < 0.3 ? `VIP-${digits(3)}` : `${digits(3)}-${digits(2)}-${digits(3)}`;
}

async function simulateCamera() {
  const plate = randomPlate();
  const res = await fetch('/api/plates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plate }),
  });
  const data = await res.json();
  if (res.ok) showToast(`Camera detected ${plate}`);
  else showToast(data.error, true);
  refresh();
}

// ---------- dark mode (remembered in localStorage) ----------
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $('theme-btn').textContent = theme === 'dark' ? '☀️ Light Mode' : '🌙 Dark Mode';
  try { localStorage.setItem('theme', theme); } catch (_) { /* ignore */ }
}

$('theme-btn').addEventListener('click', () => {
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
});
$('sim-btn').addEventListener('click', simulateCamera);

let saved = 'light';
try { saved = localStorage.getItem('theme') || 'light'; } catch (_) { /* ignore */ }
applyTheme(saved);

// ---------- Easter egg: Konami code ----------
const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
let konamiPos = 0;
document.addEventListener('keydown', (e) => {
  konamiPos = e.key === KONAMI[konamiPos] ? konamiPos + 1 : 0;
  if (konamiPos === KONAMI.length) {
    konamiPos = 0;
    document.body.classList.add('warp');
    $('easter').classList.remove('hidden');
    setTimeout(() => {
      document.body.classList.remove('warp');
      $('easter').classList.add('hidden');
    }, 4000);
  }
});

// ---------- start ----------
refresh();
setInterval(refresh, POLL_MS);
