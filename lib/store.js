// Almacenamiento simple en un archivo JSON (un solo usuario, pocos datos).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { normalizeRoutine } = require('./reminders');

class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'tasks.json');
    fs.mkdirSync(dir, { recursive: true });
    this.tasks = [];
    this.routines = [];
    this.meta = {};
    this.meds = [];
    if (fs.existsSync(this.file)) {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.tasks = data.tasks || [];
      this.routines = (data.routines || []).map(normalizeRoutine);
      this.meta = data.meta || {};
      this.meds = data.meds || [];
    }
  }

  save() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ tasks: this.tasks, routines: this.routines, meds: this.meds, meta: this.meta }, null, 2));
    fs.renameSync(tmp, this.file); // escritura atómica
  }

  all() {
    return this.tasks;
  }

  get(id) {
    return this.tasks.find((t) => t.id === id);
  }

  create(data) {
    const now = new Date().toISOString();
    const task = {
      id: crypto.randomUUID(),
      title: data.title,
      notes: data.notes || '',
      dueDate: data.dueDate,
      dueTime: data.dueTime || null,
      createdAt: now,
      completedAt: null,
      lastNotifiedAt: null,
      notifyCount: 0,
      snoozedUntil: null,
    };
    this.tasks.push(task);
    this.save();
    return task;
  }

  update(id, patch) {
    const task = this.get(id);
    if (!task) return null;
    Object.assign(task, patch);
    this.save();
    return task;
  }

  remove(id) {
    const before = this.tasks.length;
    this.tasks = this.tasks.filter((t) => t.id !== id);
    if (this.tasks.length !== before) this.save();
    return this.tasks.length !== before;
  }

  setMeta(patch) {
    Object.assign(this.meta, patch);
    this.save();
  }

  // ---------- Rutinas ----------
  getRoutine(id) {
    return this.routines.find((r) => r.id === id);
  }

  createRoutine(data) {
    const routine = {
      id: crypto.randomUUID(),
      title: data.title,
      notes: data.notes || '',
      slots: data.slots,
      days: data.days,
      paused: false,
      createdAt: new Date().toISOString(),
      doneKeys: [],
      missedKeys: [],
    };
    this.routines.push(routine);
    this.save();
    return routine;
  }

  updateRoutine(id, patch) {
    const r = this.getRoutine(id);
    if (!r) return null;
    Object.assign(r, patch);
    if (r.doneKeys.length > 2000) r.doneKeys = r.doneKeys.slice(-2000);
    if (r.missedKeys.length > 500) r.missedKeys = r.missedKeys.slice(-500);
    this.save();
    return r;
  }

  removeRoutine(id) {
    const before = this.routines.length;
    this.routines = this.routines.filter((r) => r.id !== id);
    if (this.routines.length !== before) this.save();
    return this.routines.length !== before;
  }

  // ---------- Medicamentos (v2.2) ----------
  getMed(id) {
    return this.meds.find((m) => m.id === id);
  }

  createMed(data) {
    const med = { id: crypto.randomUUID(), ...data, paused: false, createdAt: new Date().toISOString(), takenKeys: [], notified: {} };
    this.meds.push(med);
    this.save();
    return med;
  }

  updateMed(id, patch) {
    const m = this.getMed(id);
    if (!m) return null;
    Object.assign(m, patch);
    this.save();
    return m;
  }

  removeMed(id) {
    const before = this.meds.length;
    this.meds = this.meds.filter((m) => m.id !== id);
    if (this.meds.length !== before) this.save();
    return this.meds.length !== before;
  }

  /** Clave secreta persistente (firma de sesión y de botones de ntfy). */
  secret() {
    if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
    const f = path.join(this.dir, 'secret');
    if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
    return fs.readFileSync(f, 'utf8').trim();
  }
}

module.exports = { Store };
