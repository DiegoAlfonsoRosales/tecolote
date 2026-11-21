// Tecolote: interfaz
const $ = (s) => document.querySelector(s);
let tasks = [];
let editingId = null;

// ---------- API ----------
async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 401 && path !== '/api/login') {
    showLogin();
    throw new Error('Sesión cerrada');
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || 'Algo salió mal');
  return data;
}

// ---------- Fechas ----------
const pad = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

function dueMoment(t) {
  const [y, m, d] = t.dueDate.split('-').map(Number);
  if (t.dueTime) { const [h, mi] = t.dueTime.split(':').map(Number); return new Date(y, m - 1, d, h, mi); }
  return new Date(y, m - 1, d, 23, 59, 59);
}
function daysUntil(t) {
  const [y, m, d] = t.dueDate.split('-').map(Number);
  return Math.round((new Date(y, m - 1, d) - startOfDay(new Date())) / 86400000);
}
function status(t) {
  if (new Date() > dueMoment(t)) return 'overdue';
  return daysUntil(t) === 0 ? 'today' : 'upcoming';
}
const DOW = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MON = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function whenLabel(t) {
  const st = status(t);
  const time = t.dueTime ? ` a las ${t.dueTime}` : '';
  if (st === 'overdue') {
    const ms = Date.now() - dueMoment(t);
    const days = Math.floor(ms / 86400000);
    const hours = Math.floor(ms / 3600000);
    if (days >= 1) return `Venció hace ${days} ${days === 1 ? 'día' : 'días'}`;
    if (hours >= 1) return `Venció hace ${hours} h`;
    return 'Acaba de vencer';
  }
  const d = daysUntil(t);
  if (d === 0) return t.dueTime ? `Hoy${time}` : 'Hoy';
  if (d === 1) return `Mañana${time}`;
  const date = new Date(...t.dueDate.split('-').map((v, i) => (i === 1 ? v - 1 : +v)));
  if (d < 7) return `El ${DOW[date.getDay()]}${time}`;
  return `${date.getDate()} ${MON[date.getMonth()]}${time} · en ${d} días`;
}

// ---------- Render ----------
function taskItem(t) {
  const li = document.createElement('li');
  const st = t.completedAt ? 'done' : status(t);
  li.className = `task ${st}`;
  li.dataset.id = t.id;

  const check = document.createElement('button');
  check.className = 'check';
  check.textContent = '✓';
  check.setAttribute('aria-label', t.completedAt ? 'Marcar como pendiente' : 'Marcar como completada');
  check.onclick = () => (t.completedAt ? reopen(t, li) : complete(t, li, check));

  const body = document.createElement('div');
  body.className = 'task-body';
  body.onclick = () => openEditor(t);
  const title = document.createElement('div');
  title.className = 'task-title';
  title.textContent = t.title;
  const meta = document.createElement('div');
  meta.className = 'task-meta';
  const when = document.createElement('span');
  when.className = 'when';
  when.textContent = t.completedAt ? `Hecho el ${new Date(t.completedAt).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}` : whenLabel(t);
  meta.append(when);
  if (!t.completedAt && t.notifyCount) {
    const n = document.createElement('span');
    n.textContent = `🔔 ${t.notifyCount} ${t.notifyCount === 1 ? 'aviso' : 'avisos'}`;
    meta.append(n);
  }
  if (!t.completedAt && t.snoozedUntil && new Date(t.snoozedUntil) > new Date()) {
    const s = document.createElement('span');
    s.textContent = `😴 hasta ${new Date(t.snoozedUntil).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`;
    meta.append(s);
  }
  body.append(title, meta);
  if (t.notes) {
    const notes = document.createElement('div');
    notes.className = 'task-notes';
    notes.textContent = t.notes;
    body.append(notes);
  }
  li.append(check, body);
  return li;
}

function group(cls, label, items) {
  const sec = document.createElement('section');
  sec.className = `group ${cls}`;
  const h = document.createElement('h3');
  h.className = 'group-title';
  h.textContent = label;
  const badge = document.createElement('span');
  badge.className = 'badge';
  const inner = document.createElement('span');
  inner.textContent = items.length;
  badge.append(inner);
  h.append(badge);
  const ul = document.createElement('ul');
  ul.className = 'tasks';
  items.forEach((t) => ul.append(taskItem(t)));
  sec.append(h, ul);
  return sec;
}

function render() {
  const byDue = (a, b) => dueMoment(a) - dueMoment(b);
  const open = tasks.filter((t) => !t.completedAt).sort(byDue);
  const done = tasks.filter((t) => t.completedAt).sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
  const overdue = open.filter((t) => status(t) === 'overdue');
  const today = open.filter((t) => status(t) === 'today');
  const upcoming = open.filter((t) => status(t) === 'upcoming');

  const lists = $('#lists');
  lists.replaceChildren();
  if (overdue.length) lists.append(group('overdue', 'Vencidos', overdue));
  if (today.length) lists.append(group('today', 'Hoy', today));
  if (upcoming.length) lists.append(group('upcoming', 'Próximos', upcoming));

  $('#empty').hidden = open.length > 0;
  $('#done-section').hidden = done.length === 0;
  $('#done-count').textContent = done.length;
  $('#done-list').replaceChildren(...done.slice(0, 50).map(taskItem));

  let summary = 'Todo al día ✨';
  if (overdue.length) summary = `${overdue.length} ${overdue.length === 1 ? 'vencido' : 'vencidos'} · ¡ponte al corriente!`;
  else if (today.length) summary = `${today.length} para hoy`;
  else if (open.length) summary = `${open.length} ${open.length === 1 ? 'pendiente' : 'pendientes'}`;
  $('#summary').textContent = summary;
}

async function load() {
  tasks = await api('/api/tasks');
  render();
}

// ---------- Acciones ----------
const CHEERS = ['¡Bien hecho! 🎉', '¡Uno menos! 💪', '¡Eso! 🦉', '¡Listo! ✅'];

async function complete(t, li, check) {
  check.classList.add('checked');
  li.classList.add('leaving');
  try {
    const updated = await api(`/api/tasks/${t.id}/complete`, { method: 'POST' });
    Object.assign(t, updated);
    setTimeout(render, 250);
    toast(CHEERS[Math.floor(Math.random() * CHEERS.length)], 'Deshacer', () => reopen(t));
  } catch (e) {
    li.classList.remove('leaving');
    check.classList.remove('checked');
    toast(e.message);
  }
}

async function reopen(t) {
  const updated = await api(`/api/tasks/${t.id}/reopen`, { method: 'POST' });
  Object.assign(t, updated);
  render();
}

// ---------- Editor ----------
const sheet = $('#task-sheet');

function setDate(value) {
  $('#f-date').value = value;
  document.querySelectorAll('#date-chips .chip').forEach((c) => {
    c.classList.toggle('active', isoDate(addDays(+c.dataset.days)) === value);
  });
}

function openEditor(t = null) {
  editingId = t ? t.id : null;
  $('#sheet-title').textContent = t ? 'Editar pendiente' : 'Nuevo pendiente';
  $('#f-title').value = t ? t.title : '';
  $('#f-time').value = t && t.dueTime ? t.dueTime : '';
  $('#f-notes').value = t ? t.notes : '';
  setDate(t ? t.dueDate : isoDate(new Date()));
  $('#delete-btn').hidden = !t;
  sheet.showModal();
  if (!t) setTimeout(() => $('#f-title').focus(), 50);
}

document.querySelectorAll('#date-chips .chip').forEach((c) => {
  c.onclick = () => setDate(isoDate(addDays(+c.dataset.days)));
});
$('#f-date').oninput = (e) => setDate(e.target.value);
$('#add-btn').onclick = () => openEditor();
$('#cancel-btn').onclick = () => sheet.close();
sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.close(); });

$('#task-form').onsubmit = async (e) => {
  e.preventDefault();
  const body = {
    title: $('#f-title').value,
    dueDate: $('#f-date').value,
    dueTime: $('#f-time').value || null,
    notes: $('#f-notes').value,
  };
  try {
    if (editingId) {
      const updated = await api(`/api/tasks/${editingId}`, { method: 'PATCH', body });
      Object.assign(tasks.find((x) => x.id === editingId), updated);
    } else {
      tasks.push(await api('/api/tasks', { method: 'POST', body }));
      toast('Agendado. Yo te lo recuerdo 🦉');
    }
    sheet.close();
    render();
  } catch (err) {
    toast(err.message);
  }
};

$('#delete-btn').onclick = async () => {
  const t = tasks.find((x) => x.id === editingId);
  await api(`/api/tasks/${editingId}`, { method: 'DELETE' });
  tasks = tasks.filter((x) => x.id !== editingId);
  sheet.close();
  render();
  toast('Pendiente eliminado', 'Deshacer', async () => {
    tasks.push(await api('/api/tasks', { method: 'POST', body: t }));
    render();
  });
};

// ---------- Ajustes ----------
const settings = $('#settings-sheet');
$('#open-settings').onclick = () => settings.showModal();
$('#close-settings').onclick = () => settings.close();
settings.addEventListener('click', (e) => { if (e.target === settings) settings.close(); });
$('#test-btn').onclick = async () => {
  try {
    await api('/api/test', { method: 'POST' });
    toast('Aviso enviado. Revisa tu celular 📱');
  } catch (e) {
    toast(e.message);
  }
};
$('#logout-btn').onclick = async () => {
  await api('/api/logout', { method: 'POST' });
  settings.close();
  showLogin();
};

// ---------- Toast ----------
let toastTimer;
function toast(text, actionLabel, action) {
  const el = $('#toast');
  el.replaceChildren(document.createTextNode(text));
  if (actionLabel) {
    const b = document.createElement('button');
    b.textContent = actionLabel;
    b.onclick = () => { el.hidden = true; action(); };
    el.append(b);
  }
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 4000);
}

// ---------- Login ----------
function showLogin() {
  $('#app').hidden = true;
  $('#login').hidden = false;
  setTimeout(() => $('#password').focus(), 50);
}

async function showApp() {
  $('#login').hidden = true;
  $('#app').hidden = false;
  await load();
}

$('#login-form').onsubmit = async (e) => {
  e.preventDefault();
  $('#login-error').textContent = '';
  try {
    await api('/api/login', { method: 'POST', body: { password: $('#password').value } });
    $('#password').value = '';
    await init();
  } catch (err) {
    $('#login-error').textContent = err.message;
  }
};

async function init() {
  try {
    const me = await api('/api/me');
    $('#topic').textContent = `${me.server.replace(/^https?:\/\//, '')}/${me.topic || '(sin configurar)'}`;
    await showApp();
  } catch {
    /* showLogin ya se llamó */
  }
}

// Refrescar al volver a la app y cada minuto (para que "venció hace…" esté al día).
document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('#app').hidden) load(); });
setInterval(() => { if (!document.hidden && !$('#app').hidden) load(); }, 60000);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
init();
