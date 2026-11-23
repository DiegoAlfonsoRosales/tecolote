// Reglas de recordatorios de Tecolote.
// Todo se calcula en la zona horaria local del proceso (variable TZ).

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

const QUIET_START = num(process.env.QUIET_START, 0); // 0 = 12 am
const QUIET_END = num(process.env.QUIET_END, 6); // 6 = 6 am
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

// ---------- Rutinas (v2.0) ----------
// Cada rutina tiene una HORA LÍMITE. Desde que despiertas (fin del silencio) hasta esa hora,
// las rutinas pendientes se recuerdan juntas en UN solo aviso cada REMIND_EVERY min.
// Si pasa la hora límite sin marcarla, llega un aviso de "te la saltaste" y la racha se rompe.

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function routineTimeOn(r, day) {
  const [hh, mm] = r.time.split(':').map(Number);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hh, mm, 0, 0);
}

const isScheduled = (r, day) => r.days.includes(day.getDay());
const doneOn = (r, day) => (r.doneDates || []).includes(ymd(day));
const wakeOn = (day) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), QUIET_END, 0, 0, 0);

/** Rutinas que hoy siguen pendientes y aún están a tiempo (antes de su hora límite). */
function pendingRoutines(routines, now) {
  return routines
    .filter((r) => !r.paused && isScheduled(r, now) && !doneOn(r, now) && now < routineTimeOn(r, now))
    .sort((a, b) => a.time.localeCompare(b.time));
}

/** Rutinas cuya hora límite ya pasó hoy sin marcarse. */
function missedRoutines(routines, now) {
  return routines.filter((r) => !r.paused && isScheduled(r, now) && !doneOn(r, now) && now >= routineTimeOn(r, now));
}

/** ¿Toca el aviso agrupado de rutinas? lastAt = última vez que se mandó. */
function shouldNotifyRoutines(routines, lastAt, now) {
  if (isQuietHour(now) || now < wakeOn(now)) return false;
  if (!pendingRoutines(routines, now).length) return false;
  const last = lastAt ? new Date(lastAt) : null;
  if (!last || ymd(last) !== ymd(now)) return true;
  return now - last >= REMIND_EVERY - MIN;
}

/** ¿Toca avisar que se saltó esta rutina? (una sola vez por día) */
function shouldNotifyMissed(r, now) {
  if (r.createdAt && new Date(r.createdAt) >= routineTimeOn(r, now)) return false; // creada después de su hora de hoy
  return missedRoutines([r], now).length > 0 && r.missedNotifiedDate !== ymd(now);
}

/** Días seguidos cumplidos (solo cuenta los días programados). Hoy cuenta si ya está hecho. */
function streak(r, now) {
  const created = startOfDay(new Date(r.createdAt || now));
  let count = 0;
  const day = startOfDay(now);
  for (let i = 0; i < 800; i++) {
    if (day < created) break;
    if (isScheduled(r, day)) {
      if (doneOn(r, day)) count++;
      else if (i > 0) break; // hoy sin hacer todavía no rompe la racha
    }
    day.setDate(day.getDate() - 1);
  }
  return count;
}

function minutesLeft(r, now) {
  return Math.max(0, Math.round((routineTimeOn(r, now) - now) / MIN));
}

function leftLabel(mins) {
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `quedan ${h} h${m ? ` ${m} min` : ''}`;
  }
  return `quedan ${mins} min`;
}

/** Aviso agrupado: una línea por rutina pendiente. */
function buildRoutinesMessage(routines, now) {
  const pending = pendingRoutines(routines, now);
  const lines = pending.map((r) => {
    const s = streak(r, now);
    return `• ${r.title} — antes de las ${r.time} (${leftLabel(minutesLeft(r, now))})${s > 1 ? ` 🔥${s}` : ''}`;
  });
  const urgent = pending.some((r) => minutesLeft(r, now) <= 30);
  const n = pending.length;
  return {
    title: n === 1 ? `🔁 Rutina pendiente: ${pending[0].title}` : `🔁 Te faltan ${n} rutinas de hoy`,
    body: lines.join('\n'),
    tags: ['owl'],
    priority: urgent ? 5 : 4,
    pending,
  };
}

function buildMissedMessage(r, now) {
  // La racha que llevaba hasta ayer (hoy ya no cuenta).
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const had = streak(r, yesterday);
  let body = `No marcaste "${r.title}" antes de las ${r.time}.`;
  body += had > 1 ? ` Perdiste tu racha de ${had} días. 😢` : ' Mañana sí, ¿va?';
  return { title: `⚠️ Te saltaste: ${r.title}`, body, tags: ['warning'], priority: 4 };
}

Object.assign(module.exports, {
  ymd, isScheduled, doneOn, pendingRoutines, missedRoutines, shouldNotifyRoutines, shouldNotifyMissed,
  streak, buildRoutinesMessage, buildMissedMessage, routineTimeOn, REMIND_EVERY, OVERDUE_EVERY, QUIET_END,
});
