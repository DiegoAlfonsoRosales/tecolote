process.env.TZ = 'America/Mexico_City';
const test = require('node:test');
const assert = require('node:assert');
const r = require('../lib/reminders');

const at = (s) => new Date(s);
// 2026-11-23 es lunes
const routine = (o) => ({ id: 'a', title: 'Tender la cama', notes: '', time: '08:30', days: [1, 2, 3, 4, 5], paused: false, createdAt: '2026-11-01T00:00:00', doneDates: [], missedNotifiedDate: null, ...o });
const dog = routine({ id: 'b', title: 'Darle de comer al perro', time: '19:00', days: [0, 1, 2, 3, 4, 5, 6] });

test('aviso agrupado desde que despiertas hasta la hora límite, cada 15 min', () => {
  const list = [routine(), dog];
  assert.equal(r.shouldNotifyRoutines(list, null, at('2026-11-23T06:30')), false); // aún no despiertas
  assert.equal(r.shouldNotifyRoutines(list, null, at('2026-11-23T07:00')), true);
  const last = at('2026-11-23T07:00').toISOString();
  assert.equal(r.shouldNotifyRoutines(list, last, at('2026-11-23T07:10')), false);
  assert.equal(r.shouldNotifyRoutines(list, last, at('2026-11-23T07:15')), true);
  // aviso de ayer no cuenta
  assert.equal(r.shouldNotifyRoutines(list, at('2026-11-22T21:00').toISOString(), at('2026-11-23T07:01')), true);
});

test('el aviso agrupado lista solo las que siguen a tiempo', () => {
  const list = [routine(), dog];
  let m = r.buildRoutinesMessage(list, at('2026-11-23T08:10'));
  assert.equal(m.pending.length, 2);
  assert.match(m.title, /Te faltan 2 rutinas/);
  assert.match(m.body, /Tender la cama — antes de las 08:30 \(quedan 20 min\)/);
  assert.equal(m.priority, 5); // quedan 30 min o menos
  m = r.buildRoutinesMessage(list, at('2026-11-23T09:00'));
  assert.equal(m.pending.length, 1);
  assert.match(m.title, /Rutina pendiente: Darle de comer/);
  assert.equal(m.priority, 4);
});

test('sin pendientes a tiempo no hay aviso agrupado', () => {
  const list = [routine({ doneDates: ['2026-11-23'] }), dog];
  assert.equal(r.shouldNotifyRoutines(list, null, at('2026-11-23T19:30')), false);
  assert.equal(r.shouldNotifyRoutines([routine()], null, at('2026-11-22T09:00')), false); // domingo no toca
});

test('te la saltaste: una vez, después de la hora límite', () => {
  assert.equal(r.shouldNotifyMissed(routine(), at('2026-11-23T08:29')), false);
  assert.equal(r.shouldNotifyMissed(routine(), at('2026-11-23T08:30')), true);
  assert.equal(r.shouldNotifyMissed(routine({ missedNotifiedDate: '2026-11-23' }), at('2026-11-23T09:00')), false);
  assert.equal(r.shouldNotifyMissed(routine({ doneDates: ['2026-11-23'] }), at('2026-11-23T09:00')), false);
  // creada hoy después de su hora: no cuenta como saltada
  assert.equal(r.shouldNotifyMissed(routine({ createdAt: '2026-11-23T10:00:00' }), at('2026-11-23T10:05')), false);
});

test('mensaje de rutina saltada menciona la racha perdida', () => {
  const x = routine({ doneDates: ['2026-11-19', '2026-11-20'] });
  const m = r.buildMissedMessage(x, at('2026-11-23T08:31'));
  assert.match(m.title, /Te saltaste: Tender la cama/);
  assert.match(m.body, /racha de 2 días/);
});

test('racha cuenta solo días programados y no se rompe por hoy pendiente', () => {
  const x = routine({ doneDates: ['2026-11-19', '2026-11-20', '2026-11-23'] });
  assert.equal(r.streak(x, at('2026-11-23T20:00')), 3);
  assert.equal(r.streak(x, at('2026-11-24T07:00')), 3);
  assert.equal(r.streak(x, at('2026-11-25T07:00')), 0);
});
