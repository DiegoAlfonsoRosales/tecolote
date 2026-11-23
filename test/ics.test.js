process.env.TZ = 'America/Mexico_City';
const test = require('node:test');
const assert = require('node:assert');
const { buildCalendar } = require('../lib/ics');

test('calendario con pendientes y rutinas', () => {
  const ics = buildCalendar(
    [
      { id: '1', title: 'Pagar luz, agua', notes: '', dueDate: '2026-11-25', dueTime: '18:00', completedAt: null },
      { id: '2', title: 'Hecho', dueDate: '2026-11-25', dueTime: null, completedAt: '2026-11-20T00:00:00Z' },
    ],
    [{ id: 'r', title: 'Tender la cama', notes: '', time: '08:30', days: [1, 2, 3, 4, 5], createdAt: '2026-11-01T12:00:00Z', doneDates: ['2026-11-23'], paused: false }],
    new Date('2026-11-23T12:00:00Z'),
  );
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /DTSTART;TZID=America\/Mexico_City:20261125T180000/);
  assert.match(ics, /SUMMARY:🦉 Pagar luz\\, agua/);
  assert.doesNotMatch(ics, /tarea-2@/);
  assert.match(ics, /RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR/);
  assert.match(ics, /EXDATE;TZID=America\/Mexico_City:20261123T083000/);
  assert.equal((ics.match(/BEGIN:VALARM/g) || []).length, 9);
  assert.ok(ics.split('\r\n').every((l) => Buffer.byteLength(l) <= 75));
});
