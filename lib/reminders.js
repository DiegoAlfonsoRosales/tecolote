// Reglas de recordatorios de Tecolote.
// Todo se calcula en la zona horaria local del proceso (variable TZ).

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

const QUIET_START = num(process.env.QUIET_START, 0); // 0 = 12 am
const QUIET_END = num(process.env.QUIET_END, 6); // 6 = 6 am
const WAKE_HOUR = num(process.env.WAKE_HOUR, 7); // desde aquí empiezan los avisos de rutinas
const DAILY_HOUR = num(process.env.DAILY_HOUR, 9); // aviso diario para pendientes lejanos
// v2.0: el día y antes de la hora límite te recuerda cada REMIND_EVERY min; ya vencido, cada OVERDUE_EVERY min.
const REMIND_EVERY = num(process.env.REMIND_EVERY, 15) * 60 * 1000;
const OVERDUE_EVERY = num(process.env.OVERDUE_EVERY, 30) * 60 * 1000;

function num(v, def) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

/** Fecha/hora límite como Date local. Sin hora = fin del día. */
function dueMoment(task) {
  const [y, m, d] = task.dueDate.split('-').map(Number);
  if (task.dueTime) {
    const [hh, mm] = task.dueTime.split(':').map(Number);
    return new Date(y, m - 1, d, hh, mm, 0, 0);
  }
  return new Date(y, m - 1, d, 23, 59, 59, 999);
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Días de calendario entre hoy y la fecha límite (0 = hoy, negativo = ya pasó). */
function daysUntil(task, now) {
  const [y, m, d] = task.dueDate.split('-').map(Number);
  const due = new Date(y, m - 1, d);
  return Math.round((due - startOfDay(now)) / (24 * HOUR));
}

function isQuietHour(now) {
  const h = now.getHours();
  if (QUIET_START === QUIET_END) return false;
  if (QUIET_START < QUIET_END) return h >= QUIET_START && h < QUIET_END;
  return h >= QUIET_START || h < QUIET_END; // rango que cruza la medianoche
}

/**
 * Etapa del pendiente:
 *  - overdue: ya pasó la fecha/hora límite → cada 30 min (prioridad máxima)
 *  - today:   vence hoy → cada 15 min hasta la hora límite (prioridad máxima)
 *  - d1/d2/d3: faltan 1, 2 o 3 días → cada 2, 3, 4 horas
 *  - far:     faltan más de 3 días → 1 aviso diario
 */
function stage(task, now) {
  if (now > dueMoment(task)) return { name: 'overdue', interval: OVERDUE_EVERY, priority: 5 };
  const days = daysUntil(task, now);
  if (days <= 0) return { name: 'today', interval: REMIND_EVERY, priority: 5 };
  if (days === 1) return { name: 'd1', interval: 2 * HOUR, priority: 4, days };
  if (days === 2) return { name: 'd2', interval: 3 * HOUR, priority: 4, days };
  if (days === 3) return { name: 'd3', interval: 4 * HOUR, priority: 4, days };
  return { name: 'far', interval: null, priority: 3, days };
}

/** ¿Toca mandar aviso ahora? */
function shouldNotify(task, now) {
  if (task.completedAt) return false;
  if (isQuietHour(now)) return false;
  if (task.snoozedUntil && new Date(task.snoozedUntil) > now) return false;

  const st = stage(task, now);
  const last = task.lastNotifiedAt ? new Date(task.lastNotifiedAt) : null;

  // Si se acaba de pasar la fecha límite, avisar de inmediato.
  if (st.name === 'overdue' && last && last <= dueMoment(task)) return true;

  if (st.name === 'far') {
    if (now.getHours() < DAILY_HOUR) return false;
    return !last || startOfDay(last).getTime() !== startOfDay(now).getTime();
  }
  if (!last) return true;
  // 1 minuto de tolerancia para que el ciclo de cada minuto no se atrase.
  return now - last >= st.interval - MIN;
}

const OVERDUE_LINES = [
  '¡Debiste hacerlo!',
  'Esto ya se pasó. ¡Hazlo ya!',
  'Sigue pendiente… no lo olvides.',
  'El tecolote no se va a callar hasta que lo hagas.',
  '¿Ya? Todavía no lo marcas como hecho.',
];
const TODAY_LINES = [
  'Hoy toca. ¡No lo dejes para después!',
  'Es para hoy.',
  'Hoy es el día, aprovéchalo.',
];

function relativeOverdue(task, now) {
  const ms = now - dueMoment(task);
  const days = Math.floor(ms / (24 * HOUR));
  if (days >= 1) return `Venció hace ${days} ${days === 1 ? 'día' : 'días'}`;
  const hours = Math.floor(ms / HOUR);
  if (hours >= 1) return `Venció hace ${hours} ${hours === 1 ? 'hora' : 'horas'}`;
  return 'Acaba de vencer';
}

/** Arma el texto de la notificación. */
function buildMessage(task, now) {
  const st = stage(task, now);
  const n = task.notifyCount || 0;
  const pick = (arr) => arr[n % arr.length];
  const when = task.dueTime ? ` a las ${task.dueTime}` : '';
  let title;
  let body;
  let tags;
  switch (st.name) {
    case 'overdue':
      title = `⚠️ ${task.title}`;
      body = `${relativeOverdue(task, now)}. ${pick(OVERDUE_LINES)}`;
      tags = ['rotating_light'];
      break;
    case 'today':
      title = `⏰ Hoy: ${task.title}`;
      body = `${pick(TODAY_LINES)}${when ? ` Vence${when}.` : ''}`;
      tags = ['owl'];
      break;
    default: {
      const d = st.days;
      const label = d === 1 ? 'Mañana' : `En ${d} días`;
      title = `📅 ${label}: ${task.title}`;
      body = `Tienes este pendiente para ${d === 1 ? 'mañana' : `dentro de ${d} días`}${when}. Ve adelantándolo.`;
      tags = ['owl'];
    }
  }
  if (task.notes) body += `\n\n${task.notes}`;
  return { title, body, tags, priority: st.priority, stage: st.name };
}

module.exports = { dueMoment, daysUntil, isQuietHour, stage, shouldNotify, buildMessage, HOUR, MIN };

// ---------- Rutinas (v2.1) ----------
// Una rutina tiene uno o varios HORARIOS ("slots"), cada uno con "desde" y "hasta" (hora límite).
// Ej. perro: 07:00–08:30 y 20:00–22:00. Solo se recuerda un horario mientras está abierto;
// entre horarios hay silencio. Las rutinas pendientes van juntas en UN aviso cada REMIND_EVERY min.
// Si un horario cierra sin marcarse, llega "te la saltaste"; la racha cuenta días con TODOS hechos.

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const pad2 = (n) => String(n).padStart(2, '0');
const hhmm = (mins) => `${pad2(Math.floor(mins / 60))}:${pad2(mins % 60)}`;
const toMins = (t) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

function timeOn(t, day) {
  const [hh, mm] = t.split(':').map(Number);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hh, mm, 0, 0);
}

/** Convierte rutinas de versiones anteriores (una sola "time" y doneDates) al formato con horarios. */
function normalizeRoutine(r) {
  if (!Array.isArray(r.slots) || !r.slots.length) {
    const until = r.time || '08:30';
    // Igual que antes: desde que despiertas (o 2 h antes si el límite es muy temprano).
    const from = toMins(until) > WAKE_HOUR * 60 ? hhmm(WAKE_HOUR * 60) : hhmm(Math.max(0, toMins(until) - 120));
    r.slots = [{ id: 's1', from, until }];
  }
  if (!Array.isArray(r.doneKeys)) {
    r.doneKeys = (r.doneDates || []).flatMap((d) => r.slots.map((s) => `${d}:${s.id}`));
  }
  if (!Array.isArray(r.missedKeys)) r.missedKeys = r.missedNotifiedDate ? r.slots.map((s) => `${r.missedNotifiedDate}:${s.id}`) : [];
  delete r.time;
  delete r.doneDates;
  delete r.missedNotifiedDate;
  r.slots.sort((x, y) => x.until.localeCompare(y.until));
  return r;
}

const isScheduled = (r, day) => r.days.includes(day.getDay());
const slotDone = (r, day, slotId) => (r.doneKeys || []).includes(`${ymd(day)}:${slotId}`);
/** Día completo = todos los horarios hechos. */
const doneOn = (r, day) => r.slots.every((s) => slotDone(r, day, s.id));

/** Cada horario de hoy con su estado: upcoming | open | done | missed. */
function slotsToday(r, now) {
  return r.slots.map((s, i) => {
    let state;
    if (slotDone(r, now, s.id)) state = 'done';
    else if (now >= timeOn(s.until, now)) state = 'missed';
    else if (now >= timeOn(s.from, now)) state = 'open';
    else state = 'upcoming';
    return { ...s, index: i + 1, total: r.slots.length, state };
  });
}

/** Horarios abiertos ahora mismo (pendientes y a tiempo), de todas las rutinas. */
function pendingItems(routines, now) {
  const items = [];
  for (const r of routines) {
    if (r.paused || !isScheduled(r, now)) continue;
    for (const s of slotsToday(r, now)) if (s.state === 'open') items.push({ routine: r, slot: s });
  }
  return items.sort((a, b) => a.slot.until.localeCompare(b.slot.until));
}

/** Horarios que ya cerraron hoy sin marcarse y aún no se avisaron. */
function missedItems(routines, now) {
  const items = [];
  for (const r of routines) {
    if (r.paused || !isScheduled(r, now)) continue;
    for (const s of slotsToday(r, now)) {
      if (s.state !== 'missed') continue;
      if (r.createdAt && new Date(r.createdAt) >= timeOn(s.until, now)) continue; // creada después de ese horario
      if ((r.missedKeys || []).includes(`${ymd(now)}:${s.id}`)) continue;
      items.push({ routine: r, slot: s });
    }
  }
  return items;
}

/** ¿Toca el aviso agrupado de rutinas? lastAt = última vez que se mandó. */
function shouldNotifyRoutines(routines, lastAt, now) {
  if (isQuietHour(now)) return false;
  const items = pendingItems(routines, now);
  if (!items.length) return false;
  const last = lastAt ? new Date(lastAt) : null;
  if (!last || ymd(last) !== ymd(now)) return true;
  // Si se abrió un horario después del último aviso, avisar ya.
  if (items.some((it) => timeOn(it.slot.from, now) > last)) return true;
  return now - last >= REMIND_EVERY - MIN;
}

/** Días seguidos con todos los horarios hechos (solo días programados). Hoy cuenta si ya está completo. */
function streak(r, now) {
  const created = startOfDay(new Date(r.createdAt || now));
  let count = 0;
  const day = startOfDay(now);
  for (let i = 0; i < 800; i++) {
    if (day < created) break;
    if (isScheduled(r, day)) {
      if (doneOn(r, day)) count++;
      else if (i > 0) break; // hoy sin completar todavía no rompe la racha
    }
    day.setDate(day.getDate() - 1);
  }
  return count;
}

function leftLabel(mins) {
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `quedan ${h} h${m ? ` ${m} min` : ''}`;
  }
  return `quedan ${mins} min`;
}

const itemName = (it) => (it.slot.total > 1 ? `${it.routine.title} (${it.slot.index} de ${it.slot.total})` : it.routine.title);

/** Aviso agrupado: una línea por horario abierto. */
function buildRoutinesMessage(routines, now) {
  const items = pendingItems(routines, now);
  const lines = items.map((it) => {
    const left = Math.max(0, Math.round((timeOn(it.slot.until, now) - now) / MIN));
    const st = streak(it.routine, now);
    return `• ${itemName(it)} — antes de las ${it.slot.until} (${leftLabel(left)})${st > 1 ? ` 🔥${st}` : ''}`;
  });
  const urgent = items.some((it) => timeOn(it.slot.until, now) - now <= 30 * MIN);
  const n = items.length;
  return {
    title: n === 1 ? `🔁 Rutina pendiente: ${itemName(items[0])}` : `🔁 Te faltan ${n} rutinas`,
    body: lines.join('\n'),
    tags: ['owl'],
    priority: urgent ? 5 : 4,
    items,
  };
}

function buildMissedMessage(it, now) {
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const had = streak(it.routine, yesterday);
  let body = `No marcaste "${itemName(it)}" antes de las ${it.slot.until}.`;
  body += had > 1 ? ` Perdiste tu racha de ${had} días. 😢` : ' La próxima sí, ¿va?';
  return { title: `⚠️ Te saltaste: ${itemName(it)}`, body, tags: ['warning'], priority: 4 };
}

Object.assign(module.exports, {
  ymd, timeOn, normalizeRoutine, isScheduled, slotDone, doneOn, slotsToday, pendingItems, missedItems,
  shouldNotifyRoutines, streak, buildRoutinesMessage, buildMissedMessage, itemName,
  REMIND_EVERY, OVERDUE_EVERY, QUIET_END, WAKE_HOUR,
});
