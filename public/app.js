// Tecolote: interfaz
const $ = (s) => document.querySelector(s);
let tasks = [];
let routines = [];
let meds = [];
let editingId = null;
let currentTab = 'tasks';

// Íconos SVG propios: los emojis no se ven en compus sin fuente de emojis (ej. Fedora).
const ICONS = {
  pill: '<path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/>',
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
// v2.1: una rutina tiene uno o varios horarios (desde → hasta). Cada uno se marca por separado.
const nowMins = () => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); };
const toMins = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const fromMins = (x) => `${pad(Math.floor(((x % 1440) + 1440) % 1440 / 60))}:${pad(((x % 60) + 60) % 60)}`;
function leftLabel(mins) {
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    return `quedan ${h} h${mins % 60 ? ` ${mins % 60} min` : ''}`;
  }
  return `quedan ${mins} min`;
}
/** Estado del horario según la hora actual del cel (el servidor manda si ya está hecho). */
function slotState(slot) {
  if (slot.state === 'done') return 'done';
  const n = nowMins();
  if (n >= toMins(slot.until)) return 'missed';
  if (n >= toMins(slot.from)) return 'open';
  return 'upcoming';
}
const slotsLabel = (r) => r.slots.map((sl) => `${sl.from}–${sl.until}`).join(', ');
const firstUntil = (r) => r.slots[0].until;

/** Renglón de "Rutinas de hoy": uno por horario. */
function routineSlotItem({ r, slot }) {
  const st = slotState(slot);
  const li = document.createElement('li');
  li.className = `task routine${st === 'done' ? ' done-today' : ''}${st === 'missed' ? ' missed' : ''}${st === 'open' && toMins(slot.until) - nowMins() <= 30 ? ' due' : ''}${st === 'upcoming' ? ' upcoming' : ''}`;

  const check = document.createElement('button');
  check.className = 'check';
  check.textContent = '✓';
  check.setAttribute('aria-label', st === 'done' ? 'Desmarcar' : 'Marcar como hecha');
  check.onclick = () => toggleSlot(r, slot);

  const body = document.createElement('div');
  body.className = 'task-body';
  body.onclick = () => openEditor(r, 'routine');
  const title = document.createElement('div');
  title.className = 'task-title';
  title.textContent = r.slots.length > 1 ? `${r.title} (${slot.index} de ${slot.total})` : r.title;
  const meta = document.createElement('div');
  meta.className = 'task-meta';
  const when = document.createElement('span');
  when.className = 'when';
  if (st === 'done') when.textContent = 'Hecha';
  else if (st === 'missed') when.textContent = `Te la saltaste (límite ${slot.until})`;
  else if (st === 'open') when.textContent = `Antes de las ${slot.until} · ${leftLabel(toMins(slot.until) - nowMins())}`;
  else when.textContent = `De ${slot.from} a ${slot.until}`;
  meta.append(when);
  if (r.streak > 0 && slot.index === slot.total) {
    meta.append(withIcon('flame', `${r.streak} ${r.streak === 1 ? 'día' : 'días'}`, 'streak'));
  }
  body.append(title, meta);
  li.append(check, body);
  return li;
}

/** Renglón de la pestaña Rutinas: uno por rutina. */
function routineItem(r) {
  const li = document.createElement('li');
  li.className = `task routine${r.doneToday && r.scheduledToday ? ' done-today' : ''}${r.paused ? ' paused' : ''}`;
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
  when.textContent = `${daysLabel(r.days)} · ${slotsLabel(r)}`;
  meta.append(when);
  if (r.streak > 0) meta.append(withIcon('flame', `${r.streak} ${r.streak === 1 ? 'día' : 'días'}`, 'streak'));
  if (r.paused) meta.append(withIcon('pause', 'Pausada'));
  body.append(title, meta);
  li.append(body);
  return li;
}

async function toggleSlot(r, slot) {
  const wasDone = slot.state === 'done';
  try {
    const updated = await api(`/api/routines/${r.id}/${wasDone ? 'undo' : 'done'}`, { method: 'POST', body: { slot: slot.id } });
    Object.assign(r, updated);
    render();
    if (!wasDone) toast(r.doneToday && r.streak > 1 ? `¡${r.streak} días seguidos!` : CHEERS[Math.floor(Math.random() * CHEERS.length)]);
  } catch (e) {
    toast(e.message);
  }
}

// ---------- Medicinas ----------
const DOSE_LABEL = { taken: 'Tomada', due: 'Ahora · márcala', soon: 'En unos minutos', upcoming: 'Pendiente', missed: 'No registrada' };

/** Renglón de "Medicinas de hoy": una toma. */
function doseItem({ md, dose }) {
  const li = document.createElement('li');
  li.className = `task med ${dose.state}`;
  const check = document.createElement('button');
  check.className = 'check';
  check.textContent = '✓';
  check.setAttribute('aria-label', dose.state === 'taken' ? 'Desmarcar' : 'Marcar como tomada');
  check.onclick = () => toggleDose(md, dose);
  const body = document.createElement('div');
  body.className = 'task-body';
  body.onclick = () => openEditor(md, 'med');
  const title = document.createElement('div');
  title.className = 'task-title';
  title.textContent = `${md.name} · ${dose.time}`;
  const meta = document.createElement('div');
  meta.className = 'task-meta';
  const when = document.createElement('span');
  when.className = 'when';
  when.textContent = DOSE_LABEL[dose.state];
  meta.append(when, withIcon('pill', `Día ${dose.day} de ${md.days}`));
  body.append(title, meta);
  if (md.notes) {
    const notes = document.createElement('div');
    notes.className = 'task-notes';
    notes.textContent = md.notes;
    body.append(notes);
  }
  li.append(check, body);
  return li;
}

/** Tarjeta de la pestaña Medicinas. */
function medItem(md) {
  const li = document.createElement('li');
  li.className = `task med${md.finished ? ' done-today' : ''}${md.paused ? ' paused' : ''}`;
  const body = document.createElement('div');
  body.className = 'task-body';
  body.onclick = () => openEditor(md, 'med');
  const title = document.createElement('div');
  title.className = 'task-title';
  title.textContent = md.name;
  const meta = document.createElement('div');
  meta.className = 'task-meta';
  const when = document.createElement('span');
  when.className = 'when';
  when.textContent = `Cada ${md.everyHours} h · ${md.times}`;
  meta.append(when);
  if (md.finished) meta.append(withIcon('pill', `Terminado (${md.days} días)`));
  else if (md.next) {
    meta.append(withIcon('pill', `Día ${md.next.day} de ${md.days}`));
    const nx = new Date(md.next.at);
    const isToday = isoDate(nx) === isoDate(new Date());
    meta.append(withIcon('clock', `Siguiente: ${isToday ? 'hoy' : `${nx.getDate()} ${MON[nx.getMonth()]}`} ${md.next.time}`));
  }
  if (md.paused) meta.append(withIcon('pause', 'Pausada'));
  body.append(title, meta);
  li.append(body);
  return li;
}

async function toggleDose(md, dose) {
  const wasTaken = dose.state === 'taken';
  try {
    const updated = await api(`/api/meds/${md.id}/${wasTaken ? 'untake' : 'take'}`, { method: 'POST', body: { dose: dose.key } });
    Object.assign(md, updated);
    render();
    if (!wasTaken) toast('¡Tomada!');
  } catch (e) {
    toast(e.message);
  }
}

function setTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $('#tasks-view').hidden = tab !== 'tasks';
  $('#routines-view').hidden = tab !== 'routines';
  $('#meds-view').hidden = tab !== 'meds';
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
  const byTime = (a, b) => firstUntil(a).localeCompare(firstUntil(b));
  const todaySlots = routines
    .filter((r) => r.scheduledToday && !r.paused)
    .flatMap((r) => (r.today || []).map((slot) => ({ r, slot })))
    .sort((a, b) => a.slot.until.localeCompare(b.slot.until));
  const pendingRoutines = todaySlots.filter((x) => slotState(x.slot) === 'open');
  if (todaySlots.length) {
    const g = group('routines', 'Rutinas de hoy', todaySlots, routineSlotItem);
    g.querySelector('.badge span').textContent = `${todaySlots.filter((x) => x.slot.state === 'done').length}/${todaySlots.length}`;
    colA.append(g);
  }
  const todayDoses = meds
    .filter((md) => !md.paused && !md.finished)
    .flatMap((md) => md.today.map((dose) => ({ md, dose })))
    .sort((a, b) => a.dose.time.localeCompare(b.dose.time));
  if (todayDoses.length) {
    const g = group('meds', 'Medicinas de hoy', todayDoses, doseItem);
    g.querySelector('.badge span').textContent = `${todayDoses.filter((x) => x.dose.state === 'taken').length}/${todayDoses.length}`;
    colA.prepend(g);
  }
  if (overdue.length) colA.append(group('overdue', 'Vencidos', overdue));
  if (today.length) colA.append(group('today', 'Hoy', today));
  if (upcoming.length) colB.append(group('upcoming', 'Próximos', upcoming));

  $('#empty').hidden = open.length > 0 || todaySlots.length > 0 || todayDoses.length > 0;
  const activeMeds = meds.filter((md) => !md.finished);
  const doneMeds = meds.filter((md) => md.finished);
  $('#med-list').replaceChildren(...activeMeds.map(medItem));
  $('#meds-empty').hidden = activeMeds.length > 0;
  $('#meds-done-section').hidden = doneMeds.length === 0;
  $('#meds-done-count').textContent = doneMeds.length;
  $('#meds-done-list').replaceChildren(...doneMeds.map(medItem));
  $('#routine-list').replaceChildren(...[...routines].sort(byTime).map((r) => routineItem(r)));
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
  [tasks, routines, meds] = await Promise.all([api('/api/tasks'), api('/api/routines'), api('/api/meds')]);
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
// Horarios de la rutina en edición: [{ id?, from, until, auto }]. auto = "desde" calculado solo (2 h antes).
let slots = [];
let wakeHour = 7;

function renderSlots() {
  const box = $('#slots');
  box.replaceChildren(...slots.map((sl, i) => {
    const row = document.createElement('div');
    row.className = 'slot-row';
    const from = document.createElement('input');
    from.type = 'time';
    from.value = sl.from;
    from.setAttribute('aria-label', `Horario ${i + 1}: desde`);
    from.oninput = () => { sl.from = from.value; sl.auto = false; };
    const until = document.createElement('input');
    until.type = 'time';
    until.value = sl.until;
    until.setAttribute('aria-label', `Horario ${i + 1}: hasta (hora límite)`);
    until.oninput = () => {
      sl.until = until.value;
      if (sl.auto && until.value) {
        sl.from = i === 0 && toMins(until.value) > wakeHour * 60 ? fromMins(wakeHour * 60) : fromMins(Math.max(0, toMins(until.value) - 120));
        from.value = sl.from;
      }
    };
    const arrow = document.createElement('span');
    arrow.className = 'slot-lbl';
    arrow.textContent = '→';
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'slot-del';
    del.textContent = '×';
    del.setAttribute('aria-label', 'Quitar horario');
    del.hidden = slots.length === 1;
    del.onclick = () => { slots.splice(i, 1); renderSlots(); };
    row.append(from, arrow, until, del);
    return row;
  }));
  $('#add-slot').hidden = slots.length >= 6;
}

$('#add-slot').onclick = () => {
  const last = slots[slots.length - 1];
  const until = last ? fromMins(Math.min(23 * 60 + 59, toMins(last.until) + 4 * 60)) : '08:30';
  slots.push({ from: fromMins(Math.max(0, toMins(until) - 120)), until, auto: true });
  renderSlots();
};

function placeForm() {
  if (isWide()) {
    if (sheet.open) sheet.close();
    $('#side').append(form);
  } else {
    sheet.append(form);
  }
}
wide.addEventListener('change', () => { placeForm(); resetEditor(); });

const defaultType = () => ({ routines: 'routine', meds: 'med' }[currentTab] || 'task');

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
  document.querySelectorAll('#type-switch button').forEach((b) => b.classList.toggle('active', b.dataset.type === type));
  $('#task-fields').hidden = type !== 'task';
  $('#routine-fields').hidden = type !== 'routine';
  $('#med-fields').hidden = type !== 'med';
  $('#f-date').required = type === 'task';
  $('#f-title').placeholder = {
    task: '¿Qué tienes que hacer?',
    routine: '¿Qué haces cada día? (ej. tender la cama)',
    med: '¿Qué medicina? (ej. gotas para los ojos)',
  }[type];
  $('#f-notes').placeholder = type === 'med' ? 'Dosis (opcional, ej. 1 gota en cada ojo)' : 'Notas (opcional)';
  const [noun, fem] = { task: ['pendiente', false], routine: ['rutina', true], med: ['medicina', true] }[type];
  $('#sheet-title').textContent = editingId ? `Editar ${noun}` : `${fem ? 'Nueva' : 'Nuevo'} ${noun}`;
  if (type === 'med') medPreview();
}

// ---------- Formulario de medicinas ----------
function renderEvery() {
  document.querySelectorAll('#every-chips .chip').forEach((c) => c.classList.toggle('active', c.dataset.h === $('#f-every').value));
}
function medPreview() {
  const every = parseInt($('#f-every').value, 10);
  const days = parseInt($('#f-mdays').value, 10);
  const [y, mo, d] = ($('#f-mdate').value || isoDate(new Date())).split('-').map(Number);
  const [h, mi] = ($('#f-mtime').value || '09:30').split(':').map(Number);
  if (!every || !days) { $('#med-preview').textContent = ''; return; }
  const start = new Date(y, mo - 1, d, h, mi);
  const end = new Date(start.getTime() + days * 86400000);
  const times = new Set();
  let count = 0;
  let last = start;
  for (let t = new Date(start); t < end && count < 500; t = new Date(t.getTime() + every * 3600000)) {
    if (count < Math.ceil(24 / every)) times.add(`${pad(t.getHours())}:${pad(t.getMinutes())}`);
    count++;
    last = t;
  }
  const list = [...times].sort();
  const label = list.length > 1 ? `${list.slice(0, -1).join(', ')} y ${list[list.length - 1]}` : list[0];
  $('#med-preview').textContent = `Tomas a las ${label} · ${count} en total · última el ${last.getDate()} ${MON[last.getMonth()]} a las ${pad(last.getHours())}:${pad(last.getMinutes())}.`;
}
document.querySelectorAll('#every-chips .chip').forEach((c) => {
  c.onclick = () => { $('#f-every').value = c.dataset.h; renderEvery(); medPreview(); };
});
['#f-every', '#f-mdays', '#f-mdate', '#f-mtime'].forEach((sel) => {
  $(sel).addEventListener('input', () => { renderEvery(); medPreview(); });
});

function fillEditor(item, type) {
  editingId = item ? item.id : null;
  $('#type-switch').hidden = !!item; // al editar no se cambia el tipo
  $('#f-title').value = item ? item.title || item.name : '';
  $('#f-notes').value = item ? item.notes || '' : '';
  if (type === 'med') {
    $('#f-every').value = item ? item.everyHours : 12;
    $('#f-mdate').value = item ? item.startDate : isoDate(new Date());
    $('#f-mtime').value = item ? item.firstTime : '09:30';
    $('#f-mdays').value = item ? item.days : 7;
    $('#f-mpaused').checked = !!(item && item.paused);
    $('#mpause-row').hidden = !item;
    renderEvery();
  } else if (type === 'routine') {
    slots = item ? item.slots.map((sl) => ({ ...sl, auto: false })) : [{ from: fromMins(wakeHour * 60), until: '08:30', auto: true }];
    renderSlots();
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
    if (editType === 'med') {
      const body = {
        name: $('#f-title').value,
        everyHours: parseInt($('#f-every').value, 10),
        startDate: $('#f-mdate').value,
        firstTime: $('#f-mtime').value,
        days: parseInt($('#f-mdays').value, 10),
        notes: $('#f-notes').value,
      };
      if (editingId) {
        body.paused = $('#f-mpaused').checked;
        Object.assign(meds.find((x) => x.id === editingId), await api(`/api/meds/${editingId}`, { method: 'PATCH', body }));
      } else {
        meds.push(await api('/api/meds', { method: 'POST', body }));
        toast('Medicina agendada. Te aviso puntual');
      }
    } else if (editType === 'routine') {
      if (!selectedDays.size) throw new Error('Elige al menos un día');
      const body = { title: $('#f-title').value, slots: slots.map(({ id, from, until }) => ({ id, from, until })), days: [...selectedDays], notes: $('#f-notes').value };
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
  if (editType === 'med') {
    const md = meds.find((x) => x.id === editingId);
    if (!window.confirm(`¿Eliminar "${md.name}"?`)) return;
    await api(`/api/meds/${editingId}`, { method: 'DELETE' });
    meds = meds.filter((x) => x.id !== editingId);
    closeEditor();
    render();
    toast('Medicina eliminada');
    return;
  }
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
    wakeHour = me.wakeHour || 7;
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
try { const t = localStorage.getItem('tecolote-tab'); if (t === 'routines' || t === 'meds') currentTab = t; } catch { /* nada */ }
setTab(currentTab);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
init();
