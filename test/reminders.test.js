process.env.TZ = 'America/Mexico_City';
const test = require('node:test');
const assert = require('node:assert');
const r = require('../lib/reminders');

const at = (s) => new Date(s); // hora local
const task = (o) => ({ title: 'Pagar luz', notes: '', dueDate: '2026-12-10', dueTime: null, completedAt: null, lastNotifiedAt: null, notifyCount: 0, ...o });
const H = r.HOUR;

test('etapas según los días que faltan', () => {
  const t = task();
  assert.equal(r.stage(t, at('2026-12-01T10:00')).name, 'far');
  assert.equal(r.stage(t, at('2026-12-07T10:00')).interval, 4 * H);
  assert.equal(r.stage(t, at('2026-12-08T10:00')).interval, 3 * H);
  assert.equal(r.stage(t, at('2026-12-09T10:00')).interval, 2 * H);
  assert.equal(r.stage(t, at('2026-12-10T10:00')).name, 'today');
  assert.equal(r.stage(t, at('2026-12-11T00:30')).name, 'overdue');
});

test('con hora límite, vence a esa hora', () => {
  const t = task({ dueTime: '15:00' });
  assert.equal(r.stage(t, at('2026-12-10T14:59')).name, 'today');
  assert.equal(r.stage(t, at('2026-12-10T15:01')).name, 'overdue');
});

test('respeta el intervalo', () => {
  const now = at('2026-12-09T12:00'); // 1 día antes: cada 2 h
  assert.equal(r.shouldNotify(task({ lastNotifiedAt: at('2026-12-09T11:00').toISOString() }), now), false);
  assert.equal(r.shouldNotify(task({ lastNotifiedAt: at('2026-12-09T10:00').toISOString() }), now), true);
  assert.equal(r.shouldNotify(task(), now), true);
});

test('silencio de 12 am a 6 am', () => {
  const t = task({ dueDate: '2026-12-01' });
  assert.equal(r.shouldNotify(t, at('2026-12-05T03:00')), false);
  assert.equal(r.shouldNotify(t, at('2026-12-05T05:59')), false);
  assert.equal(r.shouldNotify(t, at('2026-12-05T06:00')), true);
  assert.equal(r.shouldNotify(t, at('2026-12-05T23:30')), true);
});

test('pendientes lejanos: 1 aviso al día desde las 9', () => {
  const t = task();
  assert.equal(r.shouldNotify(t, at('2026-12-01T08:00')), false);
  assert.equal(r.shouldNotify(t, at('2026-12-01T09:00')), true);
  const sent = task({ lastNotifiedAt: at('2026-12-01T09:00').toISOString() });
  assert.equal(r.shouldNotify(sent, at('2026-12-01T20:00')), false);
  assert.equal(r.shouldNotify(sent, at('2026-12-02T09:01')), true);
});

test('completados y pospuestos no avisan', () => {
  const now = at('2026-12-12T10:00');
  assert.equal(r.shouldNotify(task({ completedAt: now.toISOString() }), now), false);
  assert.equal(r.shouldNotify(task({ snoozedUntil: at('2026-12-12T10:30').toISOString() }), now), false);
});

test('avisa en cuanto se vence aunque no haya pasado el intervalo', () => {
  const t = task({ dueTime: '15:00', lastNotifiedAt: at('2026-12-10T14:40').toISOString() });
  assert.equal(r.shouldNotify(t, at('2026-12-10T15:01')), true);
});

test('mensajes', () => {
  const m = r.buildMessage(task(), at('2026-12-12T10:00'));
  assert.match(m.title, /Pagar luz/);
  assert.match(m.body, /Venció hace 1 día/);
  assert.equal(m.priority, 5);
  assert.match(r.buildMessage(task(), at('2026-12-09T10:00')).title, /Mañana/);
});
