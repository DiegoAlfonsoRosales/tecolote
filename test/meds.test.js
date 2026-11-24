process.env.TZ = 'America/Mexico_City';
const test = require('node:test');
const assert = require('node:assert');
const md = require('../lib/meds');

const at = (s) => new Date(s);
const med = (o) => ({ id: 'm', name: 'Gotas', notes: '1 gota en cada ojo', everyHours: 12, firstTime: '09:30', startDate: '2026-11-24', days: 7, createdAt: '2026-11-24T08:00:00', takenKeys: [], notified: {}, paused: false, ...o });

test('genera las tomas cada 12 h por 7 días', () => {
  const d = md.doses(med());
  assert.equal(d.length, 14);
  assert.equal(md.doseKey(d[0]), '2026-11-24T09:30');
  assert.equal(md.doseKey(d[1]), '2026-11-24T21:30');
  assert.equal(md.doseKey(d[13]), '2026-11-30T21:30');
  assert.equal(md.timesLabel(med()), '09:30 y 21:30');
  assert.equal(md.timesLabel(med({ everyHours: 8, firstTime: '06:00' })), '06:00, 14:00 y 22:00');
});

test('aviso 10 min antes, luego cada 5 min, luego "no registraste"', () => {
  assert.equal(md.medAlert(med(), at('2026-11-24T09:19')), null);
  assert.equal(md.medAlert(med(), at('2026-11-24T09:20')).kind, 'pre');
  const preSent = med({ notified: { '2026-11-24T09:30': { pre: true } } });
  assert.equal(md.medAlert(preSent, at('2026-11-24T09:25')), null);
  assert.equal(md.medAlert(preSent, at('2026-11-24T09:30')).kind, 'due');
  const nagged = med({ notified: { '2026-11-24T09:30': { pre: true, lastNag: at('2026-11-24T09:30').toISOString() } } });
  assert.equal(md.medAlert(nagged, at('2026-11-24T09:33')), null);
  assert.equal(md.medAlert(nagged, at('2026-11-24T09:35')).kind, 'due');
  assert.equal(md.medAlert(nagged, at('2026-11-24T10:30')).kind, 'missed');
});

test('tomada = silencio; día y estado de las tomas', () => {
  const taken = med({ takenKeys: ['2026-11-24T09:30'] });
  assert.equal(md.medAlert(taken, at('2026-11-24T09:40')), null);
  const today = md.dosesToday(taken, at('2026-11-24T12:00'));
  assert.deepEqual(today.map((x) => [x.time, x.state, x.day]), [['09:30', 'taken', 1], ['21:30', 'upcoming', 1]]);
  assert.equal(md.nextDose(taken, at('2026-11-24T12:00')).time, '21:30');
});

test('suena aunque sea de madrugada (ignora el silencio)', () => {
  const night = med({ firstTime: '02:00', notified: { '2026-11-24T02:00': { pre: true } }, createdAt: '2026-11-23T20:00:00' });
  assert.equal(md.medAlert(night, at('2026-11-24T02:00')).kind, 'due');
});

test('termina solo al acabar el tratamiento', () => {
  assert.equal(md.isFinished(med(), at('2026-11-30T21:00')), false);
  assert.equal(md.isFinished(med(), at('2026-11-30T22:31')), true);
  assert.equal(md.medAlert(med(), at('2026-12-02T09:30')), null);
});

test('mensajes', () => {
  const m = md.buildMedMessage(med(), { kind: 'due', t: at('2026-11-25T21:30') }, at('2026-11-25T21:40'));
  assert.match(m.title, /Hora de tu medicamento: Gotas/);
  assert.match(m.body, /Toma de las 21:30 \(hace 10 min\) · Día 2 de 7/);
  assert.equal(m.priority, 5);
});
