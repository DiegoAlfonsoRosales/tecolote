process.env.TZ = 'America/Mexico_City';
const test = require('node:test');
const assert = require('node:assert');
const r = require('../lib/reminders');

const at = (s) => new Date(s);
// 2026-11-23 es lunes
const routine = (o) => ({ title: 'Tender la cama', notes: '', time: '08:30', days: [1, 2, 3, 4, 5], paused: false, createdAt: '2026-11-01T00:00:00', doneDates: [], lastNotifiedAt: null, notifyCountToday: 0, snoozedUntil: null, ...o });

test('avisa a la hora y luego cada 30 min', () => {
  assert.equal(r.shouldNotifyRoutine(routine(), at('2026-11-23T08:29')), false);
  assert.equal(r.shouldNotifyRoutine(routine(), at('2026-11-23T08:30')), true);
  const sent = routine({ lastNotifiedAt: at('2026-11-23T08:30').toISOString() });
  assert.equal(r.shouldNotifyRoutine(sent, at('2026-11-23T08:45')), false);
  assert.equal(r.shouldNotifyRoutine(sent, at('2026-11-23T09:00')), true);
});

test('aviso de ayer no cuenta: hoy vuelve a empezar a su hora', () => {
  const sent = routine({ lastNotifiedAt: at('2026-11-23T23:50').toISOString() });
  assert.equal(r.shouldNotifyRoutine(sent, at('2026-11-24T08:30')), true);
});

test('no avisa si ya está hecha, si no toca hoy o si está pausada', () => {
  assert.equal(r.shouldNotifyRoutine(routine({ doneDates: ['2026-11-23'] }), at('2026-11-23T09:00')), false);
  assert.equal(r.shouldNotifyRoutine(routine(), at('2026-11-22T09:00')), false); // domingo
  assert.equal(r.shouldNotifyRoutine(routine({ paused: true }), at('2026-11-23T09:00')), false);
});

test('racha cuenta solo días programados y no se rompe por hoy pendiente', () => {
  // L-V: hecho jue 19, vie 20, lun 23. Fin de semana no cuenta.
  const x = routine({ doneDates: ['2026-11-19', '2026-11-20', '2026-11-23'] });
  assert.equal(r.streak(x, at('2026-11-23T20:00')), 3);
  assert.equal(r.streak(x, at('2026-11-24T07:00')), 3); // martes aún sin hacer
  assert.equal(r.streak(x, at('2026-11-25T07:00')), 0); // se saltó el martes
});

test('mensaje de rutina con racha', () => {
  const x = routine({ doneDates: ['2026-11-20'] });
  const m = r.buildRoutineMessage(x, at('2026-11-23T08:30'));
  assert.match(m.title, /Tender la cama/);
  assert.match(m.body, /1 día seguidos|1 día/);
});
