// Tecolote: interfaz
const $ = (s) => document.querySelector(s);
let tasks = [];
let routines = [];
let editingId = null;
let currentTab = 'tasks';

// Íconos SVG propios: los emojis no se ven en compus sin fuente de emojis (ej. Fedora).
const ICONS = {
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
};
function withIcon(name, text, cls = '') {
  const span = document.createElement('span');
  span.className = `meta-ic ${cls}`.trim();
  span.innerHTML = `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
  span.append(document.createTextNode(text));
  return span;
}

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
    meta.append(withIcon('bell', `${t.notifyCount} ${t.notifyCount === 1 ? 'aviso' : 'avisos'}`));
  }
  if (!t.completedAt && t.snoozedUntil && new Date(t.snoozedUntil) > new Date()) {
    meta.append(withIcon('clock', `hasta ${new Date(t.snoozedUntil).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`));
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

// ---------- Rutinas ----------
const DAY_LETTERS = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
function daysLabel(days) {
  const k = [...days].sort().join(',');
  if (k === '0,1,2,3,4,5,6') return 'Todos los días';
  if (k === '1,2,3,4,5') return 'Lunes a viernes';
  if (k === '0,6') return 'Fines de semana';
  return [1, 2, 3, 4, 5, 6, 0].filter((d) => days.includes(d)).map((d) => DAY_LETTERS[d]).join(' ');
}
// v2.0: la hora de la rutina es su HORA LÍMITE. Antes de ella está pendiente; después, saltada.
function minutesToDeadline(r) {
  const [h, m] = r.time.split(':').map(Number);
  const now = new Date();
  return h * 60 + m - (now.getHours() * 60 + now.getMinutes());
}
function leftLabel(mins) {
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    return `quedan ${h} h${mins % 60 ? ` ${mins % 60} min` : ''}`;
  }
  return `quedan ${mins} min`;
}

function routineItem(r, full = false) {
  const li = document.createElement('li');
  const left = minutesToDeadline(r);
  const pending = !r.doneToday && r.scheduledToday && !r.paused;
  const missed = pending && left <= 0;
  const urgent = pending && left > 0 && left <= 30;
  li.className = `task routine${r.doneToday && (r.scheduledToday || !full) ? ' done-today' : ''}${missed ? ' missed' : ''}${urgent ? ' due' : ''}${r.paused ? ' paused' : ''}`;

  const check = document.createElement('button');
  check.className = 'check';
  check.textContent = '✓';
  check.setAttribute('aria-label', r.doneToday ? 'Desmarcar' : 'Marcar como hecha hoy');
  check.hidden = full && !r.scheduledToday;
  check.onclick = () => toggleRoutine(r);

  const body = document.createElement('div');
  body.className = 'task-body';
  body.onclick = () => openEditor(r, 'routine');
  const title = document.createElement('div');
  title.className = 'task-title';
  title.textContent = r.title;
  const meta = document.createElement('div');
  meta.className = 'task-meta';
  const when = document.createElement('span');
  when.className = 'when';
  if (full) when.textContent = `${daysLabel(r.days)} · antes de las ${r.time}`;
  else if (r.doneToday) when.textContent = 'Hecha hoy';
  else if (missed) when.textContent = `Te la saltaste (límite ${r.time})`;
  else when.textContent = `Antes de las ${r.time} · ${leftLabel(left)}`;
  meta.append(when);
  if (r.streak > 0) {
    meta.append(withIcon('flame', `${r.streak} ${r.streak === 1 ? 'día' : 'días'}`, 'streak'));
  }
  if (r.paused) {
    meta.append(withIcon('pause', 'Pausada'));
  }
  body.append(title, meta);
  li.append(check, body);
  return li;
}

async function toggleRoutine(r) {
  const wasDone = r.doneToday;
  try {
    const updated = await api(`/api/routines/${r.id}/${wasDone ? 'undo' : 'done'}`, { method: 'POST' });
    Object.assign(r, updated);
    render();
    if (!wasDone) toast(r.streak > 1 ? `¡${r.streak} días seguidos!` : CHEERS[Math.floor(Math.random() * CHEERS.length)]);
  } catch (e) {
    toast(e.message);
  }
}

function setTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $('#tasks-view').hidden = tab !== 'tasks';
  $('#routines-view').hidden = tab !== 'routines';
  if (!editingId) resetEditor();
  try { localStorage.setItem('tecolote-tab', tab); } catch { /* sin almacenamiento */ }
}
document.querySelectorAll('.tab').forEach((b) => { b.onclick = () => setTab(b.dataset.tab); });

function group(cls, label, items, itemFn = taskItem) {
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
  items.forEach((t) => ul.append(itemFn(t)));
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

  // En compu: columna A = Vencidos + Hoy, columna B = Próximos. En cel se apilan.
  const colA = $('#col-a');
  const colB = $('#col-b');
  colA.replaceChildren();
  colB.replaceChildren();
  const byTime = (a, b) => a.time.localeCompare(b.time);
  const todayRoutines = routines.filter((r) => r.scheduledToday && !r.paused).sort(byTime);
  const pendingRoutines = todayRoutines.filter((r) => !r.doneToday);
  if (todayRoutines.length) {
    const g = group('routines', 'Rutinas de hoy', todayRoutines, (r) => routineItem(r));
    g.querySelector('.badge span').textContent = `${todayRoutines.length - pendingRoutines.length}/${todayRoutines.length}`;
    colA.append(g);
  }
  if (overdue.length) colA.append(group('overdue', 'Vencidos', overdue));
  if (today.length) colA.append(group('today', 'Hoy', today));
  if (upcoming.length) colB.append(group('upcoming', 'Próximos', upcoming));

  $('#empty').hidden = open.length > 0 || todayRoutines.length > 0;
  $('#routine-list').replaceChildren(...[...routines].sort(byTime).map((r) => routineItem(r, true)));
  $('#routines-empty').hidden = routines.length > 0;
  $('#done-section').hidden = done.length === 0;
  $('#done-count').textContent = done.length;
  $('#done-list').replaceChildren(...done.slice(0, 50).map(taskItem));

  let summary = 'Todo al día';
  if (overdue.length) summary = `${overdue.length} ${overdue.length === 1 ? 'vencido' : 'vencidos'} · ¡ponte al corriente!`;
  else if (today.length || pendingRoutines.length) {
    const parts = [];
    if (today.length) parts.push(`${today.length} para hoy`);
    if (pendingRoutines.length) parts.push(`${pendingRoutines.length} ${pendingRoutines.length === 1 ? 'rutina' : 'rutinas'}`);
    summary = parts.join(' · ');
  }
  else if (open.length) summary = `${open.length} ${open.length === 1 ? 'pendiente' : 'pendientes'}`;
  $('#summary').textContent = summary;
}

async function load() {
  [tasks, routines] = await Promise.all([api('/api/tasks'), api('/api/routines')]);
  render();
}

// ---------- Acciones ----------
const CHEERS = ['¡Bien hecho!', '¡Uno menos!', '¡Eso!', '¡Listo!'];

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
// En cel el formulario vive en una hoja flotante; en compu, fijo en el panel lateral.
// Sirve para pendientes y rutinas (selector arriba del formulario).
const sheet = $('#task-sheet');
const form = $('#task-form');
const wide = window.matchMedia('(min-width: 1000px)');
const isWide = () => wide.matches;
let editType = 'task';
let selectedDays = new Set([1, 2, 3, 4, 5]);

function placeForm() {
  if (isWide()) {
    if (sheet.open) sheet.close();
    $('#side').append(form);
  } else {
    sheet.append(form);
  }
}
wide.addEventListener('change', () => { placeForm(); resetEditor(); });

const defaultType = () => (currentTab === 'routines' ? 'routine' : 'task');

function closeEditor() {
  if (isWide()) resetEditor();
  else sheet.close();
}

function setDate(value) {
  $('#f-date').value = value;
  document.querySelectorAll('#date-chips .chip').forEach((c) => {
    c.classList.toggle('active', isoDate(addDays(+c.dataset.days)) === value);
  });
}

function renderDays() {
  document.querySelectorAll('#day-picker button').forEach((b) => b.classList.toggle('active', selectedDays.has(+b.dataset.day)));
  const key = [...selectedDays].sort().join(',');
  document.querySelectorAll('#day-presets .chip').forEach((c) => {
    c.classList.toggle('active', c.dataset.preset.split(',').map(Number).sort().join(',') === key);
  });
}

function setType(type) {
  editType = type;
  const isRoutine = type === 'routine';
  document.querySelectorAll('#type-switch button').forEach((b) => b.classList.toggle('active', b.dataset.type === type));
  $('#task-fields').hidden = isRoutine;
  $('#routine-fields').hidden = !isRoutine;
  $('#f-date').required = !isRoutine;
  $('#f-rtime').required = isRoutine;
  $('#f-title').placeholder = isRoutine ? '¿Qué haces cada día? (ej. tender la cama)' : '¿Qué tienes que hacer?';
  const noun = isRoutine ? 'rutina' : 'pendiente';
  $('#sheet-title').textContent = editingId ? `Editar ${noun}` : `${isRoutine ? 'Nueva' : 'Nuevo'} ${noun}`;
}

function fillEditor(item, type) {
  editingId = item ? item.id : null;
  $('#type-switch').hidden = !!item; // al editar no se cambia el tipo
  $('#f-title').value = item ? item.title : '';
  $('#f-notes').value = item ? item.notes : '';
  if (type === 'routine') {
    $('#f-rtime').value = item ? item.time : '08:30';
    selectedDays = new Set(item ? item.days : [1, 2, 3, 4, 5]);
    $('#f-paused').checked = !!(item && item.paused);
    $('#pause-row').hidden = !item;
    renderDays();
  } else {
    $('#f-time').value = item && item.dueTime ? item.dueTime : '';
    setDate(item ? item.dueDate : isoDate(new Date()));
  }
  setType(type);
  $('#delete-btn').hidden = !item;
  $('#cancel-btn').hidden = isWide() && !item;
  $('#side').classList.toggle('editing', !!item);
}

function resetEditor() {
  fillEditor(null, defaultType());
}

function openEditor(item = null, type = defaultType()) {
  fillEditor(item, type);
  if (!isWide()) sheet.showModal();
  if (isWide()) $('#f-title').focus();
  else if (!item) setTimeout(() => $('#f-title').focus(), 50);
}

document.querySelectorAll('#type-switch button').forEach((b) => {
  b.onclick = () => {
    const title = $('#f-title').value;
    fillEditor(null, b.dataset.type);
    $('#f-title').value = title;
  };
});
document.querySelectorAll('#date-chips .chip').forEach((c) => {
  c.onclick = () => setDate(isoDate(addDays(+c.dataset.days)));
});
document.querySelectorAll('#day-picker button').forEach((b) => {
  b.onclick = () => {
    const d = +b.dataset.day;
    if (selectedDays.has(d)) selectedDays.delete(d);
    else selectedDays.add(d);
    renderDays();
  };
});
document.querySelectorAll('#day-presets .chip').forEach((c) => {
  c.onclick = () => { selectedDays = new Set(c.dataset.preset.split(',').map(Number)); renderDays(); };
});
$('#f-date').oninput = (e) => setDate(e.target.value);
$('#add-btn').onclick = () => openEditor();
$('#cancel-btn').onclick = closeEditor;
sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.close(); });

$('#task-form').onsubmit = async (e) => {
  e.preventDefault();
  try {
    if (editType === 'routine') {
      if (!selectedDays.size) throw new Error('Elige al menos un día');
      const body = { title: $('#f-title').value, time: $('#f-rtime').value, days: [...selectedDays], notes: $('#f-notes').value };
      if (editingId) {
        body.paused = $('#f-paused').checked;
        const updated = await api(`/api/routines/${editingId}`, { method: 'PATCH', body });
        Object.assign(routines.find((x) => x.id === editingId), updated);
      } else {
        routines.push(await api('/api/routines', { method: 'POST', body }));
        toast('Rutina creada. Te la recuerdo cada día');
      }
    } else {
      const body = { title: $('#f-title').value, dueDate: $('#f-date').value, dueTime: $('#f-time').value || null, notes: $('#f-notes').value };
      if (editingId) {
        const updated = await api(`/api/tasks/${editingId}`, { method: 'PATCH', body });
        Object.assign(tasks.find((x) => x.id === editingId), updated);
      } else {
        tasks.push(await api('/api/tasks', { method: 'POST', body }));
        toast('Agendado. Yo te lo recuerdo');
      }
    }
    closeEditor();
    render();
  } catch (err) {
    toast(err.message);
  }
};

$('#delete-btn').onclick = async () => {
  if (editType === 'routine') {
    const r = routines.find((x) => x.id === editingId);
    if (!window.confirm(`¿Eliminar la rutina "${r.title}"? Se pierde su racha.`)) return;
    await api(`/api/routines/${editingId}`, { method: 'DELETE' });
    routines = routines.filter((x) => x.id !== editingId);
    closeEditor();
    render();
    toast('Rutina eliminada');
    return;
  }
  const t = tasks.find((x) => x.id === editingId);
  await api(`/api/tasks/${editingId}`, { method: 'DELETE' });
  tasks = tasks.filter((x) => x.id !== editingId);
  closeEditor();
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
    toast('Aviso enviado. Revisa tu celular');
  } catch (e) {
    toast(e.message);
  }
};
$('#copy-cal').onclick = async () => {
  const input = $('#cal-url');
  try {
    await navigator.clipboard.writeText(input.value);
  } catch {
    input.select();
    document.execCommand('copy');
  }
  toast('Enlace copiado. Pégalo en ICSx⁵');
};
$('#logout-btn').onclick = async () => {
  await api('/api/logout', { method: 'POST' });
  settings.close();
  showLogin();
};

// ---------- Atajos de teclado ----------
document.addEventListener('keydown', (e) => {
  if ($('#app').hidden || e.ctrlKey || e.metaKey || e.altKey) return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
  if (e.key === 'Escape' && isWide() && editingId) {
    resetEditor();
    document.activeElement.blur();
  } else if (!typing && (e.key === 'n' || e.key === 'N') && !document.querySelector('dialog[open]')) {
    e.preventDefault();
    openEditor();
  }
});

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
    $('#version').textContent = `v${me.version}`;
    $('#cal-url').value = me.calUrl || '';
    $('#topic').textContent = `${me.server.replace(/^https?:\/\//, '')}/${me.topic || '(sin configurar)'}`;
    await showApp();
  } catch {
    /* showLogin ya se llamó */
  }
}

// Refrescar al volver a la app y cada minuto (para que "venció hace…" esté al día).
document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('#app').hidden) load(); });
setInterval(() => { if (!document.hidden && !$('#app').hidden) load(); }, 60000);

placeForm();
try { if (localStorage.getItem('tecolote-tab') === 'routines') currentTab = 'routines'; } catch { /* nada */ }
setTab(currentTab);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
init();
