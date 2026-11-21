// Tecolote 🦉: pendientes con recordatorios insistentes por ntfy.
// Sin dependencias externas: solo Node.js 22+.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Store } = require('./lib/store');
const reminders = require('./lib/reminders');
const ntfy = require('./lib/ntfy');

const PORT = parseInt(process.env.PORT || '8088', 10);
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const PASSWORD = process.env.APP_PASSWORD;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');
const COOKIE = 'tecolote_sesion';
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

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 404, { error: 'No encontrado' });
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, { error: 'No encontrado' });
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
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
    if (action === 'done') store.update(id, { completedAt: new Date().toISOString() });
    else store.update(id, { snoozedUntil: new Date(Date.now() + reminders.HOUR).toISOString() });
    return send(res, 200, { ok: true });
  }

  if (p.startsWith('/api/')) {
    if (!isLogged(req)) return send(res, 401, { error: 'Inicia sesión' });

    if (p === '/api/me' && m === 'GET') {
      return send(res, 200, { ok: true, topic: ntfy.TOPIC, server: ntfy.SERVER });
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

    const one = p.match(/^\/api\/tasks\/([\w-]+)(?:\/(complete|reopen))?$/);
    if (one) {
      const [, id, action] = one;
      if (!store.get(id)) return send(res, 404, { error: 'No existe' });
      if (action === 'complete' && m === 'POST') return send(res, 200, store.update(id, { completedAt: new Date().toISOString() }));
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
        store.remove(id);
        return send(res, 204);
      }
    }
    return send(res, 404, { error: 'No encontrado' });
  }

  if (m === 'GET') return serveStatic(req, res, p);
  return send(res, 405, { error: 'Método no permitido' });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    const status = /inválid|necesita|Demasiado/.test(err.message) ? 400 : 500;
    if (status === 500) console.error(err);
    send(res, status, { error: err.message });
  });
});

server.listen(PORT, () => {
  console.log(`🦉 Tecolote escuchando en el puerto ${PORT} (${PUBLIC_URL})`);
  console.log(`   ntfy: ${ntfy.SERVER}/${ntfy.TOPIC || '(sin tema)'}`);
  tick();
  setInterval(tick, 60 * 1000);
});
