// Calendario .ics (v2.0): respaldo sin internet.
// La app ICSx⁵ lo copia al calendario del cel y sus alarmas suenan aunque no haya datos.
const { ymd } = require('./reminders');

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

function buildCalendar(tasks, routines, now = new Date()) {
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
    // Los días que ya hiciste la rutina se excluyen para que el cel no te avise de más.
    const exdates = (r.doneDates || []).slice(-60).map((d) => local(d, r.time));
    lines.push(
      'BEGIN:VEVENT',
      `UID:rutina-${r.id}@tecolote`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;TZID=${TZID}:${local(ymd(start), r.time)}`,
      'DURATION:PT15M',
      `RRULE:FREQ=WEEKLY;BYDAY=${r.days.map((d) => BYDAY[d]).join(',')}`,
      ...(exdates.length ? [`EXDATE;TZID=${TZID}:${exdates.join(',')}`] : []),
      `SUMMARY:${esc(`🔁 ${r.title} (límite)`)}`,
      `DESCRIPTION:${esc(r.notes || 'Rutina de Tecolote')}`,
      ...alarms([60, 30, 15, 0], `Rutina: ${r.title}`),
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

module.exports = { buildCalendar };
