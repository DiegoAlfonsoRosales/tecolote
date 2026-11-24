process.env.TZ = 'America/Mexico_City';
const test = require('node:test');
const assert = require('node:assert');
const r = require('../lib/reminders');

const at = (s) => new Date(s);
// 2026-11-23 es lunes
const routine = (o) => ({ id: 'a', title: 'Tender la cama', notes: '', slots: [{ id: 's1', from: '07:00', until: '08:30' }], days: [1, 2, 3, 4, 5], paused: false, createdAt: '2026-11-01T00:00:00', doneKeys: [], missedKeys: [], ...o });
const dog = (o) => routine({ id: 'b', title: 'Perro', days: [0, 1, 2, 3, 4, 5, 6], slots: [{ id: 's1', from: '07:00', until: '08:30' }, { id: 's2', from: '20:00', until: '22:00' }], ...o });

test('migra rutinas viejas (time + doneDates) a horarios', () => {
  const old = r.normalizeRoutine({ title: 'x', time: '08:30', days: [1], doneDates: ['2026-11-20'], missedNotifiedDate: '2026-11-21' });
  assert.deepEqual(old.slots, [{ id: 's1', from: '07:00', until: '08:30' }]);
  assert.deepEqual(old.doneKeys, ['2026-11-20:s1']);
  assert.deepEqual(old.missedKeys, ['2026-11-21:s1']);
  assert.equal(old.time, undefined);
  const late = r.normalizeRoutine({ title: 'y', time: '19:00', days: [1] });
  assert.equal(late.slots[0].from, '07:00');
});

test('solo recuerda el horario abierto; entre horarios hay silencio', () => {
  assert.equal(r.shouldNotifyRoutines([dog()], null, at('2026-11-23T06:59')), false);
  assert.equal(r.shouldNotifyRoutines([dog()], null, at('2026-11-23T07:00')), true);
  const morningDone = dog({ doneKeys: ['2026-11-23:s1'] });
  assert.equal(r.shouldNotifyRoutines([morningDone], null, at('2026-11-23T12:00')), false);
  assert.equal(r.shouldNotifyRoutines([morningDone], at('2026-11-23T08:00').toISOString(), at('2026-11-23T20:00')), true);
  const m = r.buildRoutinesMessage([morningDone], at('2026-11-23T20:00'));
  assert.match(m.title, /Perro \(2 de 2\)/);
});

test('cada 15 min, y aviso inmediato cuando se abre otro horario', () => {
  const list = [routine(), dog({ slots: [{ id: 's1', from: '07:30', until: '09:00' }] })];
  const last = at('2026-11-23T07:20').toISOString();
  assert.equal(r.shouldNotifyRoutines(list, last, at('2026-11-23T07:25')), false);
  assert.equal(r.shouldNotifyRoutines(list, last, at('2026-11-23T07:30')), true); // abrió el del perro
  assert.equal(r.shouldNotifyRoutines(list, at('2026-11-23T07:30').toISOString(), at('2026-11-23T07:45')), true);
});

test('aviso agrupado con varios horarios', () => {
  const m = r.buildRoutinesMessage([routine(), dog()], at('2026-11-23T08:10'));
  assert.equal(m.items.length, 2);
  assert.match(m.title, /Te faltan 2 rutinas/);
  assert.match(m.body, /Perro \(1 de 2\) — antes de las 08:30 \(quedan 20 min\)/);
  assert.equal(m.priority, 5);
});

test('te la saltaste por horario, una sola vez', () => {
  const d = dog();
  assert.equal(r.missedItems([d], at('2026-11-23T08:29')).length, 0);
  const miss = r.missedItems([d], at('2026-11-23T08:31'));
  assert.equal(miss.length, 1);
  assert.match(r.buildMissedMessage(miss[0], at('2026-11-23T08:31')).title, /Te saltaste: Perro \(1 de 2\)/);
  assert.equal(r.missedItems([dog({ missedKeys: ['2026-11-23:s1'] })], at('2026-11-23T09:00')).length, 0);
  assert.equal(r.missedItems([dog({ createdAt: '2026-11-23T10:00:00' })], at('2026-11-23T10:05')).length, 0);
});

test('racha solo cuenta días con todos los horarios hechos', () => {
  const d = dog({ doneKeys: ['2026-11-21:s1', '2026-11-21:s2', '2026-11-22:s1', '2026-11-22:s2', '2026-11-23:s1'] });
  assert.equal(r.streak(d, at('2026-11-23T12:00')), 2); // hoy incompleto no rompe
  assert.equal(r.streak(d, at('2026-11-24T07:00')), 0); // ayer quedó incompleto
  assert.equal(r.doneOn(d, at('2026-11-22T12:00')), true);
});

test('estados de los horarios de hoy', () => {
  const st = r.slotsToday(dog({ doneKeys: ['2026-11-23:s1'] }), at('2026-11-23T12:00')).map((s) => s.state);
  assert.deepEqual(st, ['done', 'upcoming']);
});
