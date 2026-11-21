# 🦉 Tecolote

Pendientes con recordatorios **insistentes** por [ntfy](https://ntfy.sh): te avisa antes de la fecha límite, el mismo día y después de que se vence, hasta que lo marcas como completado.

## Cada cuánto avisa

| Cuándo | Frecuencia | Prioridad ntfy |
|---|---|---|
| Más de 3 días antes | 1 vez al día (desde las 9 am) | baja |
| 3 días antes | cada 4 h | normal |
| 2 días antes | cada 3 h | normal |
| 1 día antes | cada 2 h | normal |
| El mismo día | cada hora | alta |
| Ya vencido | cada hora | urgente |

- Silencio de **12 am a 6 am**.
- Sin hora, el pendiente vence al terminar el día.
- Cada notificación trae dos botones: **✅ Completada** y **😴 En 1 hora**.

## Instalar en la Raspberry Pi

```bash
cd ~
git clone https://github.com/DiegoAlfonsoRosales/tecolote.git
cd tecolote
cp .env.example .env
nano .env          # pon tu contraseña y tu tema de ntfy
docker compose up -d --build
```

Revisa que funcione con `curl localhost:8088/health`.

Después, en Cloudflare Zero Trust, agrega al túnel una ruta pública con `tecolote.theowlsec.com` apuntando a `http://192.168.100.167:8088`.

### Actualizar

```bash
cd ~/tecolote && git pull && docker compose up -d --build
```

### Respaldo

Los datos viven en `~/tecolote/data/tasks.json`.

## Desarrollo

Sin dependencias, solo Node.js 22+:

```bash
APP_PASSWORD=prueba NTFY_TOPIC=mi-tema node server.js
npm test
```
