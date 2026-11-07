// זה השרת של הפרויקט: התוכנית שמקבלת את הלוחיות מהמצלמה ועונה ללוח הבקרה.
// הוא עושה שלושה דברים:
//   1. מקבל לוחית של רכב שנכנס לחניון
//   2. מחזיר ללוח הבקרה את כל המידע על החניון (כמה רכבים, כמה כסף וכו')
//   3. משחרר רכב ומחשב כמה הוא צריך לשלם
// את כל המידע הוא שומר במסד הנתונים (Redis), ולכן המידע לא הולך לאיבוד כשמכבים.

// טוענים ספרייה מוכנה שעוזרת לבנות שרת אינטרנט בקלות
const express = require('express');
// טוענים את הכלי שיודע להתחבר למסד הנתונים
const { createClient } = require('redis');

// ---------- הגדרות ----------
// הפורט שהשרת מקשיב בו. לוקחים מההגדרות, ואם אין שם ערך משתמשים ב-3000
const PORT = process.env.PORT || 3000;
// הכתובת של מסד הנתונים. לוקחים מההגדרות, ואם אין שם ערך משתמשים בכתובת הרגילה
const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';
// כמה מקומות חניה יש. ההגדרה מגיעה כטקסט, ולכן הופכים אותה למספר. אם אין ערך, 8
const CAPACITY = parseInt(process.env.CAPACITY || '8', 10);
// מחיר לשעה בשקלים (ההוספה האישית שלנו). הופכים לטקסט למספר, ואם אין ערך, 12
const PRICE_PER_HOUR = parseFloat(process.env.PRICE_PER_HOUR || '12');

// ---------- השמות שבהם שומרים מידע במסד הנתונים ----------
// רשימה של הרכבים שבחניון עכשיו: לכל לוחית נשמר הזמן שבו היא נכנסה
const K_INSIDE = 'parking:inside';
// מספר שסופר כמה רכבים נכנסו בסך הכול
const K_TOTAL = 'parking:total_entries';
// סך הכסף שנגבה
const K_REVENUE = 'parking:revenue';
// רשימת האירועים האחרונים (נכנס, שוחרר, נדחה)
const K_LOG = 'parking:log';

// יוצרים את החיבור למסד הנתונים (עדיין לא מתחברים, זה קורה בסוף הקובץ)
const redis = createClient({ url: REDIS_URL });
// אם יש שגיאה בחיבור, מדפיסים אותה במקום שכל התוכנית תקרוס
redis.on('error', (err) => console.error('Redis error:', err.message));

// יוצרים את השרת
const app = express();
// מלמדים את השרת לקרוא מידע שנשלח אליו בפורמט JSON (הצורה הרגילה להעברת מידע)
app.use(express.json());

// ---------- פונקציות עזר ----------

// תבנית שבודקת אם לוחית תקינה: 3 עד 10 תווים, ורק אותיות גדולות באנגלית, ספרות ומקף.
// הבדיקה מונעת מאנשים לשלוח לנו טקסט מוזר או מסוכן
const PLATE_RE = /^[A-Z0-9-]{3,10}$/;
// מנקה לוחית: הופך לטקסט, מוריד רווחים מהצדדים, והופך לאותיות גדולות.
// ככה vip-001 ו-VIP-001 נחשבות אותה לוחית
const normalize = (p) => String(p || '').trim().toUpperCase();

// מחשב כמה דקות רכב חנה וכמה הוא צריך לשלם.
// מקבל את זמן הכניסה, ואת הזמן הנוכחי (ברירת מחדל: עכשיו)
function calcPrice(enteredAt, now = Date.now()) {
  // הזמנים נמדדים באלפיות שנייה, ולכן מחלקים ב-60000 כדי לקבל דקות.
  // Math.max מוודא שלא יצא מספר שלילי
  const minutes = Math.max(0, Math.floor((now - enteredAt) / 60000));
  // מחלקים ב-60 לשעות ומעגלים למעלה: כל שעה שהתחילה נחשבת שעה מלאה. מינימום שעה אחת
  const hours = Math.max(1, Math.ceil(minutes / 60));
  // מחזירים את הדקות ואת המחיר (שעות כפול מחיר שעה)
  return { minutes, price: hours * PRICE_PER_HOUR };
}

// רושם אירוע ביומן שמוצג בלוח הבקרה. מקבל את סוג האירוע, את הלוחית ופרטים נוספים (לא חובה)
async function log(type, plate, extra = {}) {
  // בונים טקסט שמתאר את האירוע: הסוג, הלוחית, הזמן, וכל פרט נוסף
  const entry = JSON.stringify({ type, plate, at: Date.now(), ...extra });
  // מוסיפים את האירוע לתחילת הרשימה, כך שהחדש ביותר תמיד ראשון
  await redis.lPush(K_LOG, entry);
  // משאירים ברשימה רק 50 אירועים אחרונים, כדי שלא תגדל בלי סוף
  await redis.lTrim(K_LOG, 0, 49);
}

// ---------- קבלת לוחית מהמצלמה (רכב נכנס) ----------
// כשמישהו שולח לכתובת /api/plates בקשה מסוג POST, הקוד הזה רץ
app.post('/api/plates', async (req, res) => {
  // כל הקוד בתוך try: אם משהו נכשל (למשל מסד הנתונים נפל), עוברים ל-catch ולא קורסים
  try {
    // לוקחים את הלוחית שנשלחה, ומנקים אותה. הבדיקה הראשונה מונעת קריסה אם לא נשלח כלום
    const plate = normalize(req.body && req.body.plate);
    // אם הלוחית לא עומדת בתבנית, מחזירים שגיאה 400 (בקשה לא תקינה) ויוצאים
    if (!PLATE_RE.test(plate)) {
      return res.status(400).json({ error: 'Invalid plate. Use 3-10 chars: A-Z, 0-9, -' });
    }
    // בודקים קודם אם הרכב כבר בחניון (קודם כל, כדי שרכב שכבר בפנים יקבל את ההודעה הנכונה גם כשהחניון מלא).
    // אם הלוחית קיימת מקבלים את זמן הכניסה שלה, ואם לא מקבלים null
    if ((await redis.zScore(K_INSIDE, plate)) !== null) {
      // 409 אומר שהבקשה סותרת את המצב הקיים
      return res.status(409).json({ error: 'Car is already inside', plate });
    }
    // סופרים כמה רכבים יש עכשיו בחניון
    const occupied = await redis.zCard(K_INSIDE);
    // אם אין מקום פנוי
    if (occupied >= CAPACITY) {
      // רושמים ביומן שהרכב נדחה
      await log('rejected_full', plate);
      // מחזירים שגיאה 409, ומסמנים שהחניון מלא
      return res.status(409).json({ error: 'Parking lot is FULL', full: true, capacity: CAPACITY });
    }
    // הכול תקין: שומרים את זמן הכניסה הנוכחי
    const enteredAt = Date.now();
    // מוסיפים את הרכב לרשימת הרכבים שבחניון, יחד עם זמן הכניסה שלו
    await redis.zAdd(K_INSIDE, { score: enteredAt, value: plate });
    // מגדילים ב-1 את המספר שסופר כמה רכבים נכנסו בסך הכול
    await redis.incr(K_TOTAL);
    // רושמים ביומן שהרכב נכנס
    await log('entered', plate);
    // מחזירים תשובה 201 (נוצר בהצלחה) עם פרטי הרכב
    res.status(201).json({ plate, enteredAt, occupied: occupied + 1, capacity: CAPACITY });
  } catch (e) {
    // אם הייתה שגיאה, מדפיסים אותה לצורך בדיקה
    console.error(e);
    // ללקוח מחזירים רק הודעה כללית (500 = שגיאה בשרת), בלי לחשוף פרטים
    res.status(500).json({ error: 'Internal error' });
  }
});

// ---------- שליחת המצב הנוכחי ללוח הבקרה ----------
// לוח הבקרה פונה לכאן כל 2 שניות (בקשה מסוג GET). הקו התחתון אומר שאין צורך בפרטי הבקשה
app.get('/api/plates', async (_req, res) => {
  try {
    // שומרים את הזמן הנוכחי כדי לחשב לכל רכב כמה זמן הוא חונה
    const now = Date.now();
    // שולפים את כל הרכבים שבחניון עם זמן הכניסה שלהם. REV = מהחדש לישן
    const rows = await redis.zRangeWithScores(K_INSIDE, 0, -1, { REV: true });
    // הופכים כל רכב לפרטים מלאים: לוחית, זמן כניסה, דקות חניה ומחיר עד עכשיו
    const cars = rows.map(({ value, score }) => ({
      plate: value,
      enteredAt: score,
      ...calcPrice(score, now),
    }));
    // מבקשים ממסד הנתונים שלושה דברים בבת אחת (מהיר יותר מאחד אחרי השני):
    // כמה נכנסו בסך הכול, כמה כסף נגבה, ו-10 האירועים האחרונים
    const [total, revenue, rawLog] = await Promise.all([
      redis.get(K_TOTAL),
      redis.get(K_REVENUE),
      redis.lRange(K_LOG, 0, 9),
    ]);
    // שולחים ללוח הבקרה את כל מה שהוא צריך כדי לצייר את המסך
    res.json({
      // כמה מקומות יש בסך הכול
      capacity: CAPACITY,
      // כמה רכבים בפנים עכשיו
      occupied: cars.length,
      // כמה מקומות פנויים (לעולם לא פחות מ-0)
      free: Math.max(0, CAPACITY - cars.length),
      // האם החניון מלא. לפי זה לוח הבקרה מציג את ההתראה האדומה
      full: cars.length >= CAPACITY,
      // המחיר לשעה
      pricePerHour: PRICE_PER_HOUR,
      // מסד הנתונים מחזיר טקסט (או כלום אם עוד לא היה כלום), ולכן הופכים למספר
      totalEntries: parseInt(total || '0', 10),
      // אותו דבר לגבי הכסף שנגבה
      revenue: parseFloat(revenue || '0'),
      // רשימת הרכבים
      cars,
      // האירועים נשמרו כטקסט, ולכן הופכים אותם בחזרה לפרטים
      events: rawLog.map((l) => JSON.parse(l)),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ---------- שחרור רכב (כפתור Release) ----------
// בכתובת, המילה אחרי הנקודתיים (:plate) היא הלוחית של הרכב שרוצים לשחרר
app.post('/api/plates/:plate/release', async (req, res) => {
  try {
    // לוקחים את הלוחית מהכתובת ומנקים אותה
    const plate = normalize(req.params.plate);
    // מחפשים את זמן הכניסה של הרכב, כדי לדעת כמה זמן הוא חנה
    const enteredAt = await redis.zScore(K_INSIDE, plate);
    // אם הרכב לא נמצא בחניון, מחזירים שגיאה 404 (לא נמצא)
    if (enteredAt === null) return res.status(404).json({ error: 'Car not found', plate });
    // מחשבים כמה דקות הוא חנה וכמה הוא צריך לשלם
    const { minutes, price } = calcPrice(enteredAt);
    // מוציאים את הרכב מרשימת הרכבים שבחניון
    await redis.zRem(K_INSIDE, plate);
    // מוסיפים את התשלום לסך הכסף שנגבה
    await redis.incrByFloat(K_REVENUE, price);
    // רושמים ביומן שהרכב שוחרר, יחד עם הזמן והמחיר
    await log('released', plate, { minutes, price });
    // מחזירים ללוח הבקרה כמה זמן הרכב חנה וכמה הוא שילם
    res.json({ plate, minutes, price });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ---------- בדיקה שהשרת חי ----------
// כתובת קטנה שעונה "הכול בסדר". משתמשים בה כדי לוודא שהשרת עלה (למשל בבדיקה האוטומטית ב-GitHub).
// השדה redis אומר אם החיבור למסד הנתונים פעיל
app.get('/api/health', (_req, res) => res.json({ status: 'ok', redis: redis.isReady }));

// ---------- הפעלת השרת ----------
// פונקציה שרצה מיד כשהקובץ נטען
(async () => {
  // קודם מתחברים למסד הנתונים, ורק אחר כך מתחילים לקבל בקשות, כדי שאף בקשה לא תגיע לפני שהוא מוכן
  await redis.connect();
  // מתחילים להקשיב לבקשות בפורט שהוגדר, ומדפיסים הודעה
  app.listen(PORT, () => console.log(`API listening on :${PORT} (capacity=${CAPACITY})`));
})().catch((e) => {
  // אם ההפעלה נכשלה (למשל מסד הנתונים לא זמין), מדפיסים את השגיאה
  console.error('Startup failed', e);
  // ויוצאים עם סימן שגיאה, כדי ש-Docker ידע שהתוכנית קרסה ויפעיל אותה מחדש
  process.exit(1);
});
