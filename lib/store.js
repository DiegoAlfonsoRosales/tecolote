// Almacenamiento simple en un archivo JSON (un solo usuario, pocos datos).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'tasks.json');
    fs.mkdirSync(dir, { recursive: true });
    this.tasks = [];
    if (fs.existsSync(this.file)) {
      this.tasks = JSON.parse(fs.readFileSync(this.file, 'utf8')).tasks || [];
    }
  }

  save() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ tasks: this.tasks }, null, 2));
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

  /** Clave secreta persistente (firma de sesión y de botones de ntfy). */
  secret() {
    if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
    const f = path.join(this.dir, 'secret');
    if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
    return fs.readFileSync(f, 'utf8').trim();
  }
}

module.exports = { Store };
