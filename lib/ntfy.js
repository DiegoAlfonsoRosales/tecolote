// Envío de notificaciones a ntfy (por defecto ntfy.sh público).
// v2.0: cada aviso lleva un "sequence_id" (ntfy 2.16+). Un aviso nuevo con el mismo id
// REEMPLAZA al anterior en el cel en vez de apilarse, y clear() lo quita al completar.
const SERVER = (process.env.NTFY_SERVER || 'https://ntfy.sh').replace(/\/$/, '');
const TOPIC = process.env.NTFY_TOPIC;
const TOKEN = process.env.NTFY_TOKEN; // opcional, por si algún día usas un servidor con login

function headers(extra = {}) {
  const h = { ...extra };
  if (TOKEN) h.Authorization = `Bearer ${TOKEN}`;
  return h;
}

/** ntfy solo acepta letras, números, - y _ (máx. 64) en el sequence id. */
const cleanSeq = (id) => String(id).replace(/[^-_A-Za-z0-9]/g, '').slice(0, 64);

async function publish({ title, body, tags, priority, click, actions, sequenceId }) {
  if (!TOPIC) throw new Error('Falta NTFY_TOPIC en el archivo .env');
  const msg = { topic: TOPIC, title, message: body, tags, priority, click, actions };
  if (sequenceId) msg.sequence_id = cleanSeq(sequenceId);
  const res = await fetch(SERVER, {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(msg),
  });
  if (!res.ok) throw new Error(`ntfy respondió ${res.status}: ${await res.text()}`);
}

/** Quita del cel la notificación con ese sequence id (por ejemplo, al completar). */
async function clear(sequenceId) {
  if (!TOPIC || !sequenceId) return;
  try {
    await fetch(`${SERVER}/${TOPIC}/${cleanSeq(sequenceId)}/clear`, { method: 'PUT', headers: headers() });
  } catch (err) {
    console.error(`[error ntfy clear] ${err.message}`);
  }
}

module.exports = { publish, clear, TOPIC, SERVER };
