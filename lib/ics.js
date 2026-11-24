// Calendario .ics (v2.0): respaldo sin internet.
// La app ICSx⁵ lo copia al calendario del cel y sus alarmas suenan aunque no haya datos.
const { ymd } = require('./reminders');
const medsLib = require('./meds');

const TZID = process.env.TZ || 'America/Mexico_City';
const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

const pad = (n) => String(n).padStart(2, '0');
const stamp = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
const local = (dateStr, timeStr) => `${dateStr.replace(/-/g, '')}T${timeStr.replace(':', '')}00`;

/** Escapa texto según RFC 5545. */
const esc = (t) => String(t || '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Corta líneas largas a 75 bytes (RFC 5545). */
function fold(line) {
  const out = [];
  let cur = '';
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch) > 74) {
      out.push(cur);
      cur = ` ${ch}`;
    } else cur += ch;
  }
  out.push(cur);
  return out.join('\r\n');
}

function alarms(minutesBefore, title) {
  return minutesBefore.flatMap((m) => [
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${esc(title)}`,
    `TRIGGER:${m === 0 ? 'PT0M' : `-PT${m}M`}`,
    'END:VALARM',
  ]);
}

function buildCalendar(tasks, routines, meds = [], now = new Date()) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Tecolote//ES', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Tecolote', `X-WR-TIMEZONE:${TZID}`];
  const dtstamp = stamp(now);

  for (const t of tasks) {
    if (t.completedAt) continue;
    // Sin hora: el evento va a las 9:00 del día límite.
    const time = t.dueTime || '09:00';
    lines.push(
      'BEGIN:VEVENT',
      `UID:tarea-${t.id}@tecolote`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;TZID=${TZID}:${local(t.dueDate, time)}`,
      'DURATION:PT15M',
      `SUMMARY:${esc(`🦉 ${t.title}`)}`,
      `DESCRIPTION:${esc(t.notes ? `${t.notes}\n\nPendiente de Tecolote` : 'Pendiente de Tecolote')}`,
      ...alarms(t.dueTime ? [120, 60, 30, 15, 0] : [0], `Hoy: ${t.title}`),
      'END:VEVENT',
    );
  }

  for (const r of routines) {
    if (r.paused) continue;
    const start = new Date(r.createdAt || now);
    for (const [i, slot] of r.slots.entries()) {
      const name = r.slots.length > 1 ? `${r.title} (${i + 1} de ${r.slots.length})` : r.title;
      // Los días que ya hiciste ese horario se excluyen para que el cel no te avise de más.
      const exdates = (r.doneKeys || [])
        .filter((k) => k.endsWith(`:${slot.id}`))
        .slice(-60)
        .map((k) => local(k.split(':')[0], slot.until));
      lines.push(
        'BEGIN:VEVENT',
        `UID:rutina-${r.id}-${slot.id}@tecolote`,
        `DTSTAMP:${dtstamp}`,
        `DTSTART;TZID=${TZID}:${local(ymd(start), slot.until)}`,
        'DURATION:PT15M',
        `RRULE:FREQ=WEEKLY;BYDAY=${r.days.map((d) => BYDAY[d]).join(',')}`,
        ...(exdates.length ? [`EXDATE;TZID=${TZID}:${exdates.join(',')}`] : []),
        `SUMMARY:${esc(`🔁 ${name} (límite)`)}`,
        `DESCRIPTION:${esc(r.notes || 'Rutina de Tecolote')}`,
        ...alarms([60, 30, 15, 0], `Rutina: ${name}`),
        'END:VEVENT',
      );
    }
  }

  for (const m of meds) {
    if (m.paused || medsLib.isFinished(m, now)) continue;
    for (const t of medsLib.doses(m)) {
      const key = medsLib.doseKey(t);
      if (t < new Date(now.getTime() - 24 * 3600 * 1000) || (m.takenKeys || []).includes(key)) continue;
      lines.push(
        'BEGIN:VEVENT',
        `UID:med-${m.id}-${key.replace(/[^0-9]/g, '')}@tecolote`,
        `DTSTAMP:${dtstamp}`,
        `DTSTART;TZID=${TZID}:${local(key.slice(0, 10), key.slice(11))}`,
        'DURATION:PT10M',
        `SUMMARY:${esc(`💊 ${m.name}`)}`,
        `DESCRIPTION:${esc(m.notes || 'Medicamento de Tecolote')}`,
        ...alarms([10, 0], `Medicamento: ${m.name}`),
        'END:VEVENT',
      );
    }
  }

  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

module.exports = { buildCalendar };
