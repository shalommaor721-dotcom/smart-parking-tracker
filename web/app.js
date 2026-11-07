// זה הקוד שרץ בדפדפן של השומר ומפעיל את לוח הבקרה.
// הוא עושה שלושה דברים:
//   1. כל 2 שניות שואל את השרת מה מצב החניון
//   2. מצייר מחדש את הטבלה, המספרים והיומן, בלי לרענן את הדף
//   3. מטפל בלחיצות על הכפתורים (שחרור רכב, מצלמה מדומה, מצב כהה, ההפתעה החבויה)

// כל כמה אלפיות שנייה לשאול את השרת (2000 = 2 שניות)
const POLL_MS = 2000;
// קיצור: במקום לכתוב document.getElementById בכל פעם, כותבים רק $('שם')
const $ = (id) => document.getElementById(id);

// ---------- פונקציות עזר ----------

// יוצרת רכיב חדש בדף. מקבלת: סוג הרכיב, טקסט (לא חובה), ושם עיצוב (לא חובה)
function el(tag, text, className) {
  // יוצרים את הרכיב
  const node = document.createElement(tag);
  // מכניסים את הטקסט כטקסט רגיל בלבד (ולא כקוד), כדי שאף אחד לא יוכל להריץ קוד זדוני דרך לוחית
  if (text !== undefined) node.textContent = text;
  // אם קיבלנו שם עיצוב, מצמידים אותו לרכיב
  if (className) node.className = className;
  // מחזירים את הרכיב המוכן
  return node;
}

// מציגה הודעה קטנה בתחתית המסך ל-3 שניות (ירוק להצלחה, אדום לשגיאה)
function showToast(msg, isError = false) {
  // מוצאים את רכיב ההודעה בדף
  const t = $('toast');
  // כותבים בו את הטקסט
  t.textContent = msg;
  // בוחרים צבע: אדום אם זו שגיאה, אחרת ירוק. השורה הזאת גם מציגה את ההודעה
  t.className = 'toast' + (isError ? ' error' : '');
  // אחרי 3 שניות מסתירים אותה שוב
  setTimeout(() => t.classList.add('hidden'), 3000);
}

// הופכת זמן (באלפיות שנייה) לשעה קריאה, למשל 19:56:49
function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// הופכת מספר דקות לטקסט קריא: 75 דקות הופך ל-1h 15m, ו-8 דקות ל-8m
function fmtDuration(minutes) {
  // כמה שעות שלמות
  const h = Math.floor(minutes / 60);
  // כמה דקות נשארו אחרי השעות
  const m = minutes % 60;
  // אם יש שעות מציגים שעות ודקות, ואחרת רק דקות
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ---------- ציור המסך ----------

// בונה מחדש את טבלת הרכבים
function renderCars(cars) {
  // מוצאים את גוף הטבלה
  const body = $('cars-body');
  // מוחקים את כל השורות הישנות ובונים הכול מחדש (פשוט, ובלי שורות כפולות)
  body.replaceChildren();
  // אם אין אף רכב מציגים את ההודעה "החניון ריק", ואחרת מסתירים אותה
  $('empty-msg').classList.toggle('hidden', cars.length > 0);

  // עוברים על כל הרכבים אחד אחד
  for (const car of cars) {
    // יוצרים שורה חדשה בטבלה
    const tr = el('tr');
    // תא ראשון: הלוחית
    tr.appendChild(el('td', car.plate, 'plate'));
    // תא שני: שעת הכניסה
    tr.appendChild(el('td', fmtTime(car.enteredAt)));
    // תא שלישי: כמה זמן הרכב חונה
    tr.appendChild(el('td', fmtDuration(car.minutes)));
    // תא רביעי: המחיר עד עכשיו
    tr.appendChild(el('td', String(car.price)));

    // תא חמישי: כפתור שחרור
    const td = el('td');
    // יוצרים את הכפתור
    const btn = el('button', 'Release', 'release');
    // כשלוחצים עליו, משחררים את הרכב של השורה הזאת בלבד
    btn.addEventListener('click', () => releaseCar(car.plate));
    // מכניסים את הכפתור לתא, את התא לשורה, ואת השורה לטבלה
    td.appendChild(btn);
    tr.appendChild(td);
    body.appendChild(tr);
  }
}

// איך כותבים כל סוג אירוע ביומן
const EVENT_TEXT = {
  // רכב נכנס
  entered: (e) => `🟢 ${e.plate} entered`,
  // רכב שוחרר: מציגים כמה זמן חנה וכמה שילם
  released: (e) => `🔴 ${e.plate} left after ${fmtDuration(e.minutes)} and paid ₪${e.price}`,
  // רכב נדחה כי החניון מלא
  rejected_full: (e) => `⛔ ${e.plate} rejected - parking is full`,
};

// בונה מחדש את רשימת האירועים
function renderEvents(events) {
  // מוצאים את הרשימה ומנקים אותה
  const ul = $('events');
  ul.replaceChildren();
  // עוברים על כל האירועים
  for (const e of events) {
    // בוחרים את הניסוח לפי סוג האירוע. אם הסוג לא מוכר, מציגים את שמו
    const text = (EVENT_TEXT[e.type] || ((x) => x.type))(e);
    // מוסיפים שורה לרשימה: השעה ואחריה הטקסט
    ul.appendChild(el('li', `${fmtTime(e.at)}  ${text}`));
  }
}

// מקבלת מהשרת את כל המידע ומעדכנת את כל המסך
function render(data) {
  // הכרטיס הראשון: כמה רכבים בפנים מתוך כמה מקומות
  $('stat-occupied').textContent = `${data.occupied} / ${data.capacity}`;
  // הכרטיס השני: כמה מקומות פנויים
  $('stat-free').textContent = data.free;
  // הכרטיס השלישי: כמה רכבים נכנסו בסך הכול
  $('stat-total').textContent = data.totalEntries;
  // הכרטיס הרביעי: כמה כסף נגבה (מעוגל לשקל שלם)
  $('stat-revenue').textContent = data.revenue.toFixed(0);

  // מחשבים באחוזים כמה החניון מלא
  const pct = Math.round((data.occupied / data.capacity) * 100);
  // מוצאים את הפס הצבעוני
  const fill = $('capacity-fill');
  // קובעים את אורך הפס לפי האחוז
  fill.style.width = pct + '%';
  // קובעים צבע: אדום כשהחניון מלא, כתום מ-75% ומעלה, ואחרת ירוק
  fill.className = pct >= 100 ? 'full' : pct >= 75 ? 'warn' : '';

  // מציגים את ההתראה האדומה רק כשהחניון מלא
  $('full-alert').classList.toggle('hidden', !data.full);
  // מציירים את הטבלה
  renderCars(data.cars);
  // מציירים את היומן
  renderEvents(data.events);
}

// ---------- פנייה לשרת ----------

// שואלת את השרת מה המצב ומציירת. רצה שוב ושוב כל 2 שניות
async function refresh() {
  try {
    // שולחים לשרת בקשה. הכתובת קצרה כי Nginx מעביר אותה לשרת הנתונים
    const res = await fetch('/api/plates');
    // אם השרת ענה בשגיאה, זורקים שגיאה כדי לעבור לחלק של הטיפול בשגיאות
    if (!res.ok) throw new Error('HTTP ' + res.status);
    // מקבלים את המידע ומציירים את המסך
    render(await res.json());
  } catch (err) {
    // אם השרת לא זמין, רק מדפיסים הודעה ומנסים שוב בסבב הבא
    console.error('Refresh failed', err);
  }
}

// משחררת רכב: מבקשת מהשרת לשחרר אותו ומציגה כמה הוא שילם
async function releaseCar(plate) {
  // שולחים בקשת שחרור לכתובת של הלוחית. הפונקציה encodeURIComponent מגינה על תווים מיוחדים
  const res = await fetch(`/api/plates/${encodeURIComponent(plate)}/release`, { method: 'POST' });
  // קוראים את התשובה
  const data = await res.json();
  // אם הצליח, מציגים הודעה ירוקה עם המחיר. אחרת הודעת שגיאה אדומה
  if (res.ok) showToast(`${plate} released. Fee: ₪${data.price}`);
  else showToast(data.error, true);
  // מרעננים מיד כדי שהשומר לא יחכה 2 שניות לראות את השינוי
  refresh();
}

// ---------- מצלמה מדומה ----------
// אין לנו מצלמה אמיתית, ולכן הכפתור "Simulate camera" שולח לוחית אקראית, כמו שהמצלמה הייתה עושה

// יוצרת לוחית אקראית
function randomPlate() {
  // פונקציה קטנה שמחזירה כמה ספרות אקראיות שנבקש
  const digits = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');
  // ב-30% מהמקרים לוחית מיוחדת (VIP), ואחרת לוחית רגילה בפורמט 123-45-678
  return Math.random() < 0.3 ? `VIP-${digits(3)}` : `${digits(3)}-${digits(2)}-${digits(3)}`;
}

// שולחת לשרת לוחית אקראית, בדיוק כמו המצלמה
async function simulateCamera() {
  // יוצרים לוחית
  const plate = randomPlate();
  // שולחים אותה לשרת
  const res = await fetch('/api/plates', {
    // סוג הבקשה: שליחת מידע חדש
    method: 'POST',
    // אומרים לשרת שהמידע בפורמט JSON. בלי זה הוא לא יבין אותו
    headers: { 'Content-Type': 'application/json' },
    // המידע עצמו: הלוחית
    body: JSON.stringify({ plate }),
  });
  // קוראים את התשובה
  const data = await res.json();
  // הצלחה: הודעה ירוקה. כשלון (למשל החניון מלא): הודעה אדומה
  if (res.ok) showToast(`Camera detected ${plate}`);
  else showToast(data.error, true);
  // מרעננים את המסך
  refresh();
}

// ---------- מצב כהה ----------

// מחליפה בין מצב בהיר למצב כהה ושומרת את הבחירה
function applyTheme(theme) {
  // מסמנים על הדף איזה מצב פעיל. קובץ העיצוב משנה את הצבעים לפי הסימון הזה
  document.documentElement.dataset.theme = theme;
  // משנים את הטקסט שעל הכפתור
  $('theme-btn').textContent = theme === 'dark' ? '☀️ Light Mode' : '🌙 Dark Mode';
  // שומרים את הבחירה בדפדפן כדי שתיזכר גם בפעם הבאה. אם השמירה חסומה, מתעלמים
  try { localStorage.setItem('theme', theme); } catch (_) { /* ignore */ }
}

// כשלוחצים על הכפתור, עוברים למצב ההפוך
$('theme-btn').addEventListener('click', () => {
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
});
// כשלוחצים על כפתור המצלמה המדומה, מפעילים אותה
$('sim-btn').addEventListener('click', simulateCamera);

// כשהדף נטען, בודקים איזה מצב נשמר בפעם הקודמת (ברירת מחדל: בהיר)
let saved = 'light';
try { saved = localStorage.getItem('theme') || 'light'; } catch (_) { /* ignore */ }
// ומפעילים אותו
applyTheme(saved);

// ---------- ההפתעה החבויה ----------
// אם מקלידים בדיוק את הרצף חץ למעלה, חץ למעלה, חץ למטה, חץ למטה, שמאלה, ימינה, שמאלה, ימינה, B, A
// מופיעה הפתעה למשך 4 שניות
const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
// סופר כמה מקשים נכונים הוקלדו ברצף עד עכשיו
let konamiPos = 0;
// בכל לחיצה על מקש במקלדת
document.addEventListener('keydown', (e) => {
  // אם זה המקש הנכון הבא ברצף, מתקדמים. אם טעינו, מתחילים מההתחלה
  konamiPos = e.key === KONAMI[konamiPos] ? konamiPos + 1 : 0;
  // אם סיימנו את כל הרצף
  if (konamiPos === KONAMI.length) {
    // מאפסים כדי שאפשר יהיה להפעיל שוב
    konamiPos = 0;
    // מפעילים אפקט צבעים מסתובבים על הדף
    document.body.classList.add('warp');
    // ומציגים את ההודעה
    $('easter').classList.remove('hidden');
    // אחרי 4 שניות מכבים הכול
    setTimeout(() => {
      document.body.classList.remove('warp');
      $('easter').classList.add('hidden');
    }, 4000);
  }
});

// ---------- התחלה ----------
// שואלים את השרת מיד כשהדף נטען, כדי שהמסך לא יהיה ריק
refresh();
// ואחר כך שוב ושוב, כל 2 שניות
setInterval(refresh, POLL_MS);
