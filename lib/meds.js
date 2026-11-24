// Medicamentos (v2.2): tomas cada N horas por X días, con avisos estrictos.
//  - 10 min antes: aviso previo.
//  - A la hora: prioridad máxima cada 5 min hasta marcar "Tomada".
//  - Si pasa 1 h sin marcarla: "No registraste tu toma".
// Los medicamentos IGNORAN el silencio nocturno: si te toca a las 2 am, suena.
const MIN = 60 * 1000;
const HOUR = 60 * MIN;

const num = (v, d) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : d);
const PRE_MIN = num(process.env.MED_PRE_MIN, 10);
const NAG_MIN = num(process.env.MED_NAG_MIN, 5);
const GRACE_MIN = num(process.env.MED_GRACE_MIN, 60);

const pad = (n) => String(n).padStart(2, '0');
const doseKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

function startMoment(m) {
  const [y, mo, d] = m.startDate.split('-').map(Number);
  const first = m.mode === 'fixed' ? [...m.times].sort()[0] : m.firstTime;
  const [h, mi] = (first || '00:00').split(':').map(Number);
  return new Date(y, mo - 1, d, h, mi, 0, 0);
}

// v2.3: dos modos.
//  - mode 'interval': cada everyHours horas desde la primera toma (firstTime del startDate).
//  - mode 'fixed':    a horas fijas cada día (times: ['08:00', '20:00']).
// days = número de días, o null = sin fecha de fin (se calcula solo una ventana alrededor de hoy).
const isFixed = (m) => m.mode === 'fixed';
const startDay = (m) => {
  const [y, mo, d] = m.startDate.split('-').map(Number);
  return new Date(y, mo - 1, d);
};

function treatmentEnd(m) {
  if (!m.days) return null;
  const base = isFixed(m) ? startDay(m) : startMoment(m);
  return new Date(base.getTime() + m.days * 24 * HOUR);
}

/**
 * Tomas del tratamiento. Si no tiene fin, solo las de unos días alrededor de "now".
 * Sin "now" y con fin, devuelve todas (máx. 500).
 */
function doses(m, now = new Date()) {
  const end = treatmentEnd(m);
  const windowFrom = end ? null : new Date(now.getTime() - 3 * 24 * HOUR);
  const windowTo = end || new Date(now.getTime() + 3 * 24 * HOUR);
  const out = [];
  if (isFixed(m)) {
    const day = startDay(m);
    if (windowFrom && windowFrom > day) day.setTime(new Date(windowFrom.getFullYear(), windowFrom.getMonth(), windowFrom.getDate()).getTime());
    for (; day < windowTo && out.length < 500; day.setDate(day.getDate() + 1)) {
      for (const t of [...m.times].sort()) {
        const [h, mi] = t.split(':').map(Number);
        const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, mi, 0, 0);
        if (at < windowTo) out.push(at);
      }
    }
    return out;
  }
  const start = startMoment(m);
  const step = m.everyHours * HOUR;
  let k = windowFrom && windowFrom > start ? Math.floor((windowFrom - start) / step) : 0;
  for (let t = new Date(start.getTime() + k * step); t < windowTo && out.length < 500; k++, t = new Date(start.getTime() + k * step)) out.push(t);
  return out;
}

/** Horarios del día (ej. "09:30 y 21:30"). */
function timesLabel(m) {
  const set = isFixed(m) ? [...m.times].sort() : [...new Set(doses(m, startMoment(m)).slice(0, Math.ceil(24 / m.everyHours)).map(hhmm))].sort();
  return set.length > 1 ? `${set.slice(0, -1).join(', ')} y ${set[set.length - 1]}` : set[0];
}

const isTaken = (m, key) => (m.takenKeys || []).includes(key);

function doseState(m, t, now) {
  const key = doseKey(t);
  if (isTaken(m, key)) return 'taken';
  if (now < new Date(t.getTime() - PRE_MIN * MIN)) return 'upcoming';
  if (now < t) return 'soon';
  if (now < new Date(t.getTime() + GRACE_MIN * MIN)) return 'due';
  return 'missed';
}

function dayNumber(m, t) {
  return Math.floor((t - (isFixed(m) ? startDay(m) : startMoment(m))) / (24 * HOUR)) + 1;
}

/** "Día 3 de 7", o "Día 40" si no tiene fin. */
const dayLabel = (m, t) => (m.days ? `Día ${dayNumber(m, t)} de ${m.days}` : `Día ${dayNumber(m, t)}`);

function isFinished(m, now) {
  if (!m.days) return false;
  const all = doses(m, now);
  if (!all.length) return true;
  const last = all[all.length - 1];
  return now >= new Date(last.getTime() + GRACE_MIN * MIN) || all.every((t) => isTaken(m, doseKey(t)));
}

/** Tomas de hoy con su estado (para la interfaz). */
function dosesToday(m, now) {
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return doses(m, now)
    // No se muestran las tomas de antes de registrar el medicamento.
    .filter((t) => doseKey(t).startsWith(day) && t >= startMoment(m) && !(m.createdAt && new Date(m.createdAt) > t))
    .map((t) => ({ key: doseKey(t), time: hhmm(t), day: dayNumber(m, t), state: doseState(m, t, now) }));
}

function nextDose(m, now) {
  const t = doses(m, now).find((d) => d >= startMoment(m) && !isTaken(m, doseKey(d)) && now < new Date(d.getTime() + GRACE_MIN * MIN));
  return t ? { key: doseKey(t), time: hhmm(t), at: t.toISOString(), day: dayNumber(m, t) } : null;
}

/**
 * Qué aviso toca ahora para este medicamento (o null).
 * kind: 'pre' (10 min antes), 'due' (cada 5 min), 'missed' (una vez).
 */
function medAlert(m, now) {
  if (m.paused) return null;
  const notified = m.notified || {};
  for (const t of doses(m, now)) {
    if (t < startMoment(m)) continue; // antes de la primera toma
    const key = doseKey(t);
    const st = doseState(m, t, now);
    const n = notified[key] || {};
    if (st === 'soon' && !n.pre) return { kind: 'pre', key, t };
    if (st === 'due') {
      if (!n.lastNag || now - new Date(n.lastNag) >= NAG_MIN * MIN - 30 * 1000) return { kind: 'due', key, t };
    }
    if (st === 'missed' && !n.missed && now - t < 24 * HOUR) {
      if (m.createdAt && new Date(m.createdAt) > t) continue; // la toma era antes de registrar el medicamento
      return { kind: 'missed', key, t };
    }
  }
  return null;
}

function buildMedMessage(m, alert, now) {
  const time = hhmm(alert.t);
  const day = dayLabel(m, alert.t);
  const dose = m.notes ? `\n${m.notes}` : '';
  if (alert.kind === 'pre') {
    return { title: `💊 En ${PRE_MIN} min: ${m.name}`, body: `Toma de las ${time} · ${day}${dose}`, priority: 4, tags: ['pill'] };
  }
  if (alert.kind === 'due') {
    const late = Math.max(0, Math.round((now - alert.t) / MIN));
    return {
      title: `💊 Hora de tu medicamento: ${m.name}`,
      body: `Toma de las ${time}${late ? ` (hace ${late} min)` : ''} · ${day}${dose}\nMárcala como tomada para que deje de sonar.`,
      priority: 5,
      tags: ['pill'],
    };
  }
  return {
    title: `⚠️ No registraste tu toma: ${m.name}`,
    body: `La toma de las ${time} (${day}) no se marcó. Si ya la tomaste, márcala en Tecolote.`,
    priority: 4,
    tags: ['warning'],
  };
}

module.exports = { doses, doseKey, dosesToday, nextDose, isFinished, medAlert, buildMedMessage, timesLabel, dayNumber, dayLabel, startMoment, hhmm };
