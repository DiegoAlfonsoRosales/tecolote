// Tecolote 🦉: pendientes con recordatorios insistentes por ntfy.
// Sin dependencias externas: solo Node.js 22+.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Store } = require('./lib/store');
const reminders = require('./lib/reminders');
const ntfy = require('./lib/ntfy');
const { buildCalendar } = require('./lib/ics');

const PORT = parseInt(process.env.PORT || '8088', 10);
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const PASSWORD = process.env.APP_PASSWORD;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');
const COOKIE = 'tecolote_sesion';
const VERSION = require('./package.json').version;
const TEN_YEARS = 10 * 365 * 24 * 3600;

if (!PASSWORD) {
  console.error('Falta APP_PASSWORD en el archivo .env');
  process.exit(1);
}

const store = new Store(DATA_DIR);
const SECRET = store.secret();

// ---------- utilidades ----------
const hmac = (txt) => crypto.createHmac('sha256', SECRET).update(txt).digest('hex');
// La sesión depende de la contraseña: si la cambias, se cierran todas las sesiones.
const sessionToken = () => hmac(`sesion:${crypto.createHash('sha256').update(PASSWORD).digest('hex')}`);
const actionToken = (id, action) => hmac(`${action}:${id}`);
// Enlace secreto del calendario (.ics) para ICSx⁵.
const calToken = () => hmac('calendario').slice(0, 32);
const calUrl = () => `${PUBLIC_URL}/cal/${calToken()}.ics`;

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

const isLogged = (req) => safeEqual(parseCookies(req)[COOKIE] || '', sessionToken());

function send(res, status, data, headers = {}) {
  const body = data === undefined ? '' : JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 100_000) {
        reject(new Error('Demasiado grande'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('JSON inválido'));
      }
    });
  });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

function cleanTask(body, partial = false) {
  const out = {};
  if (!partial || body.title !== undefined) {
    const title = String(body.title || '').trim().slice(0, 200);
    if (!title) throw new Error('El pendiente necesita un título');
    out.title = title;
  }
  if (!partial || body.dueDate !== undefined) {
    if (!DATE_RE.test(body.dueDate || '')) throw new Error('Fecha inválida');
    out.dueDate = body.dueDate;
  }
  if (body.dueTime !== undefined) {
    if (body.dueTime && !TIME_RE.test(body.dueTime)) throw new Error('Hora inválida');
    out.dueTime = body.dueTime || null;
  }
  if (body.notes !== undefined) out.notes = String(body.notes || '').slice(0, 2000);
  return out;
}

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function cleanRoutine(body, partial = false) {
  const out = {};
  if (!partial || body.title !== undefined) {
    const title = String(body.title || '').trim().slice(0, 200);
    if (!title) throw new Error('La rutina necesita un título');
    out.title = title;
  }
  if (!partial || body.time !== undefined) {
    if (!HHMM_RE.test(body.time || '')) throw new Error('Hora inválida');
    out.time = body.time;
  }
  if (!partial || body.days !== undefined) {
    const days = [...new Set((Array.isArray(body.days) ? body.days : []).map(Number))].filter((d) => d >= 0 && d <= 6).sort();
    if (!days.length) throw new Error('Elige al menos un día');
    out.days = days;
  }
  if (body.notes !== undefined) out.notes = String(body.notes || '').slice(0, 2000);
  if (body.paused !== undefined) out.paused = !!body.paused;
  return out;
}

/** Rutina + datos calculados para la interfaz. */
function routineView(r, now = new Date()) {
  return {
    ...r,
    streak: reminders.streak(r, now),
    doneToday: reminders.doneOn(r, now),
    scheduledToday: reminders.isScheduled(r, now),
  };
}

function markRoutine(id, done, now = new Date()) {
  const r = store.getRoutine(id);
  const today = reminders.ymd(now);
  const doneDates = r.doneDates.filter((d) => d !== today);
  if (done) doneDates.push(today);
  const updated = store.updateRoutine(id, { doneDates });
  // Si ya no queda ninguna rutina pendiente hoy, quita el aviso agrupado del cel.
  if (done && !reminders.pendingRoutines(store.routines, now).length) ntfy.clear(routinesSeq(now));
  if (done) ntfy.clear(`miss-${id}`);
  return updated;
}

// Ids de notificación (sequence id de ntfy): un aviso nuevo con el mismo id reemplaza al anterior.
const taskSeq = (id) => `t-${id}`;
const routinesSeq = (now) => `rut-${reminders.ymd(now)}`;

function completeTask(id) {
  ntfy.clear(taskSeq(id));
  return store.update(id, { completedAt: new Date().toISOString() });
}

// Freno simple contra adivinar la contraseña: 5 intentos fallidos por minuto por IP.
const failedLogins = new Map();
function tooManyAttempts(ip) {
  const now = Date.now();
  const list = (failedLogins.get(ip) || []).filter((t) => now - t < 60_000);
  failedLogins.set(ip, list);
  return list.length >= 5;
}
const clientIp = (req) => req.headers['cf-connecting-ip'] || req.socket.remoteAddress;

// ---------- notificaciones ----------
async function notifyTask(task, now = new Date()) {
  const msg = reminders.buildMessage(task, now);
  await ntfy.publish({
    sequenceId: taskSeq(task.id),
    title: msg.title,
    body: msg.body,
    tags: msg.tags,
    priority: msg.priority,
    click: PUBLIC_URL,
    actions: [
      {
        action: 'http',
        label: '✅ Completada',
        url: `${PUBLIC_URL}/api/hook/${task.id}/done?t=${actionToken(task.id, 'done')}`,
        method: 'POST',
        clear: true,
      },
      {
        action: 'http',
        label: '😴 En 1 hora',
        url: `${PUBLIC_URL}/api/hook/${task.id}/snooze?t=${actionToken(task.id, 'snooze')}`,
        method: 'POST',
        clear: true,
      },
    ],
  });
}

/** Un solo aviso con todas las rutinas pendientes; un botón "✅" por cada una (máx. 3, límite de ntfy). */
async function notifyRoutines(now) {
  const msg = reminders.buildRoutinesMessage(store.routines, now);
  const short = (t) => (t.length > 22 ? `${t.slice(0, 21)}…` : t);
  await ntfy.publish({
    sequenceId: routinesSeq(now),
    title: msg.title,
    body: msg.body,
    tags: msg.tags,
    priority: msg.priority,
    click: PUBLIC_URL,
    actions: msg.pending.slice(0, 3).map((r) => ({
      action: 'http',
      label: `✅ ${short(r.title)}`,
      url: `${PUBLIC_URL}/api/rhook/${r.id}/done?t=${actionToken(r.id, 'rdone')}`,
      method: 'POST',
      clear: true,
    })),
  });
  return msg.pending.length;
}

let ticking = false;
async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const now = new Date();
    for (const task of store.all()) {
      if (!reminders.shouldNotify(task, now)) continue;
      try {
        await notifyTask(task, now);
        store.update(task.id, { lastNotifiedAt: now.toISOString(), notifyCount: (task.notifyCount || 0) + 1 });
        console.log(`[aviso] ${task.title}`);
      } catch (err) {
        console.error(`[error ntfy] ${task.title}: ${err.message}`);
      }
    }
    if (reminders.shouldNotifyRoutines(store.routines, store.meta.routinesLastNotifiedAt, now)) {
      try {
        const n = await notifyRoutines(now);
        store.setMeta({ routinesLastNotifiedAt: now.toISOString() });
        console.log(`[rutinas] ${n} pendientes`);
      } catch (err) {
        console.error(`[error ntfy] rutinas: ${err.message}`);
      }
    }
    for (const r of store.routines) {
      if (!reminders.shouldNotifyMissed(r, now)) continue;
      try {
        const msg = reminders.buildMissedMessage(r, now);
        await ntfy.publish({ sequenceId: `miss-${r.id}`, ...msg, click: PUBLIC_URL });
        store.updateRoutine(r.id, { missedNotifiedDate: reminders.ymd(now) });
        console.log(`[saltada] ${r.title}`);
      } catch (err) {
        console.error(`[error ntfy] ${r.title}: ${err.message}`);
      }
    }
  } finally {
    ticking = false;
  }
}

// ---------- archivos estáticos ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

// Cache busting: a cada enlace de index.html se le agrega una huella del contenido
// del archivo (app.js?v=72caf09c12). Si el archivo cambia, cambia la huella y
// Cloudflare y el navegador lo bajan nuevo; si no cambia, se usa la copia guardada.
const fingerprints = new Map();
function fingerprint(rel) {
  if (!fingerprints.has(rel)) {
    const data = fs.readFileSync(path.join(PUBLIC_DIR, rel));
    fingerprints.set(rel, crypto.createHash('sha256').update(data).digest('hex').slice(0, 10));
  }
  return fingerprints.get(rel);
}

let indexHtml = null;
function versionedIndex() {
  if (!indexHtml) {
    indexHtml = fs
      .readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8')
      .replace(/(href|src)="\/([\w.-]+\.(?:css|js|svg|png|webmanifest))"/g, (_, attr, rel) => `${attr}="/${rel}?v=${fingerprint(rel)}"`);
  }
  return indexHtml;
}

function serveStatic(req, res, pathname, search) {
  const headers = { 'X-Content-Type-Options': 'nosniff' };
  if (pathname === '/' || pathname === '/index.html') {
    // El HTML nunca se guarda: así siempre trae las huellas actuales.
    res.writeHead(200, { ...headers, 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache, no-store, must-revalidate' });
    return res.end(versionedIndex());
  }
  const rel = pathname.slice(1);
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 404, { error: 'No encontrado' });
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, { error: 'No encontrado' });
    // Con huella el archivo nunca cambia bajo ese nombre: se puede guardar un año.
    const versioned = search.has('v') && pathname !== '/sw.js';
    res.writeHead(200, {
      ...headers,
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': versioned ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    res.end(data);
  });
}

// ---------- rutas ----------
async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const m = req.method;

  if (p === '/health') return send(res, 200, { ok: true });

  // Login
  if (p === '/api/login' && m === 'POST') {
    const ip = clientIp(req);
    if (tooManyAttempts(ip)) return send(res, 429, { error: 'Demasiados intentos, espera un minuto' });
    const body = await readBody(req);
    if (!safeEqual(body.password || '', PASSWORD)) {
      failedLogins.get(ip).push(Date.now());
      return send(res, 401, { error: 'Contraseña incorrecta' });
    }
    const secure = (req.headers['x-forwarded-proto'] || '').includes('https') || PUBLIC_URL.startsWith('https');
    const cookie = `${COOKIE}=${sessionToken()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${TEN_YEARS}${secure ? '; Secure' : ''}`;
    return send(res, 200, { ok: true }, { 'Set-Cookie': cookie });
  }
  if (p === '/api/logout' && m === 'POST') {
    return send(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE}=; Path=/; HttpOnly; Max-Age=0` });
  }

  // Botones de la notificación de ntfy (firmados, sin sesión)
  const hook = p.match(/^\/api\/hook\/([\w-]+)\/(done|snooze)$/);
  if (hook && m === 'POST') {
    const [, id, action] = hook;
    if (!safeEqual(url.searchParams.get('t') || '', actionToken(id, action))) return send(res, 403, { error: 'Token inválido' });
    if (!store.get(id)) return send(res, 404, { error: 'No existe' });
    if (action === 'done') completeTask(id);
    else store.update(id, { snoozedUntil: new Date(Date.now() + reminders.HOUR).toISOString() });
    return send(res, 200, { ok: true });
  }

  // Calendario para ICSx⁵ (respaldo sin internet). Protegido por el token del enlace.
  const cal = p.match(/^\/cal\/([a-f0-9]+)\.ics$/);
  if (cal && m === 'GET') {
    if (!safeEqual(cal[1], calToken())) return send(res, 404, { error: 'No encontrado' });
    res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(buildCalendar(store.all(), store.routines));
  }

  const rhook = p.match(/^\/api\/rhook\/([\w-]+)\/done$/);
  if (rhook && m === 'POST') {
    const id = rhook[1];
    if (!safeEqual(url.searchParams.get('t') || '', actionToken(id, 'rdone'))) return send(res, 403, { error: 'Token inválido' });
    if (!store.getRoutine(id)) return send(res, 404, { error: 'No existe' });
    markRoutine(id, true);
    return send(res, 200, { ok: true });
  }

  if (p.startsWith('/api/')) {
    if (!isLogged(req)) return send(res, 401, { error: 'Inicia sesión' });

    if (p === '/api/me' && m === 'GET') {
      return send(res, 200, { ok: true, version: VERSION, topic: ntfy.TOPIC, server: ntfy.SERVER, calUrl: calUrl() });
    }
    if (p === '/api/tasks' && m === 'GET') return send(res, 200, store.all());
    if (p === '/api/tasks' && m === 'POST') {
      const data = cleanTask(await readBody(req));
      return send(res, 201, store.create(data));
    }
    if (p === '/api/test' && m === 'POST') {
      await ntfy.publish({
        title: '🦉 Tecolote funciona',
        body: 'Así te llegarán los recordatorios de tus pendientes.',
        tags: ['owl'],
        priority: 3,
        click: PUBLIC_URL,
      });
      return send(res, 200, { ok: true });
    }

    if (p === '/api/routines' && m === 'GET') return send(res, 200, store.routines.map((r) => routineView(r)));
    if (p === '/api/routines' && m === 'POST') {
      return send(res, 201, routineView(store.createRoutine(cleanRoutine(await readBody(req)))));
    }
    const rt = p.match(/^\/api\/routines\/([\w-]+)(?:\/(done|undo))?$/);
    if (rt) {
      const [, id, action] = rt;
      if (!store.getRoutine(id)) return send(res, 404, { error: 'No existe' });
      if (action && m === 'POST') return send(res, 200, routineView(markRoutine(id, action === 'done')));
      if (!action && m === 'PATCH') return send(res, 200, routineView(store.updateRoutine(id, cleanRoutine(await readBody(req), true))));
      if (!action && m === 'DELETE') {
        store.removeRoutine(id);
        return send(res, 204);
      }
    }

    const one = p.match(/^\/api\/tasks\/([\w-]+)(?:\/(complete|reopen))?$/);
    if (one) {
      const [, id, action] = one;
      if (!store.get(id)) return send(res, 404, { error: 'No existe' });
      if (action === 'complete' && m === 'POST') return send(res, 200, completeTask(id));
      if (action === 'reopen' && m === 'POST') {
        return send(res, 200, store.update(id, { completedAt: null, snoozedUntil: null, lastNotifiedAt: new Date().toISOString() }));
      }
      if (!action && m === 'PATCH') {
        const patch = cleanTask(await readBody(req), true);
        // Si cambia la fecha, el conteo de avisos vuelve a empezar desde ahora.
        if (patch.dueDate !== undefined || patch.dueTime !== undefined) {
          patch.lastNotifiedAt = new Date().toISOString();
          patch.snoozedUntil = null;
        }
        return send(res, 200, store.update(id, patch));
      }
      if (!action && m === 'DELETE') {
        ntfy.clear(taskSeq(id));
        store.remove(id);
        return send(res, 204);
      }
    }
    return send(res, 404, { error: 'No encontrado' });
  }

  if (m === 'GET') return serveStatic(req, res, p, url.searchParams);
  return send(res, 405, { error: 'Método no permitido' });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    const status = /inválid|necesita|Demasiado|Elige/.test(err.message) ? 400 : 500;
    if (status === 500) console.error(err);
    send(res, status, { error: err.message });
  });
});

server.listen(PORT, () => {
  console.log(`🦉 Tecolote v${VERSION} escuchando en el puerto ${PORT} (${PUBLIC_URL})`);
  console.log(`   ntfy: ${ntfy.SERVER}/${ntfy.TOPIC || '(sin tema)'}`);
  tick();
  setInterval(tick, 60 * 1000);
});
