// Envío de notificaciones a ntfy (por defecto ntfy.sh público).
const SERVER = (process.env.NTFY_SERVER || 'https://ntfy.sh').replace(/\/$/, '');
const TOPIC = process.env.NTFY_TOPIC;
const TOKEN = process.env.NTFY_TOKEN; // opcional, por si algún día usas un servidor con login

async function publish({ title, body, tags, priority, click, actions }) {
  if (!TOPIC) throw new Error('Falta NTFY_TOPIC en el archivo .env');
  const headers = { 'Content-Type': 'application/json' };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  const res = await fetch(SERVER, {
    method: 'POST',
    headers,
    body: JSON.stringify({ topic: TOPIC, title, message: body, tags, priority, click, actions }),
  });
  if (!res.ok) throw new Error(`ntfy respondió ${res.status}: ${await res.text()}`);
}

module.exports = { publish, TOPIC, SERVER };
