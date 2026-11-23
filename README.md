# 🦉 Tecolote

Versión actual en [`CHANGELOG.md`](CHANGELOG.md).

Pendientes con recordatorios **insistentes** por [ntfy](https://ntfy.sh): te avisa antes de la fecha límite, el mismo día y después de que se vence, hasta que lo marcas como completado.

## Cada cuánto avisa

| Cuándo | Frecuencia | Prioridad ntfy |
|---|---|---|
| Más de 3 días antes | 1 vez al día (desde las 9 am) | normal |
| 3, 2 y 1 día antes | cada 4, 3 y 2 h | alta |
| El mismo día | cada 15 min hasta la hora límite | máxima |
| Ya vencido | cada 30 min | máxima |
| Rutinas | un solo aviso desde las 7:00 (`WAKE_HOUR`), cada 15 min hasta su hora límite | alta (máxima a 30 min del límite) |
| Rutina no hecha a tiempo | 1 aviso de "te la saltaste" | alta |

- Silencio de **12 am a 6 am**. Sin hora, el pendiente vence al terminar el día.
- Los avisos de un mismo pendiente **se reemplazan** en vez de apilarse (requiere ntfy 2.16+ en el cel) y se quitan al completarlo.
- Botones en la notificación: **✅ Completada** / **😴 En 1 hora** en pendientes, y **✅ <rutina>** en el aviso de rutinas.
- Para que suene hasta que la toques: en ntfy, activa "Mantener alertas para la máxima prioridad".
- Ajustable en `.env`: `REMIND_EVERY` (15), `OVERDUE_EVERY` (30), `QUIET_START` (0), `QUIET_END` (6).

## Respaldo sin internet

En ⚙️ Ajustes está el enlace secreto del calendario (`/cal/….ics`). Pégalo en la app **ICSx⁵** y tus pendientes y rutinas pasan al calendario del cel con alarmas que suenan aunque no haya datos.

## Instalar en la Raspberry Pi

```bash
cd ~
git clone https://github.com/DiegoAlfonsoRosales/tecolote.git
cd tecolote
cp .env.example .env
nano .env          # pon tu contraseña y tu tema de ntfy
docker compose up -d --build
```

Revisa que funcione con `curl localhost:8089/health`.

Después, en Cloudflare Zero Trust, agrega al túnel una ruta pública con `tecolote.theowlsec.com` apuntando a `http://192.168.100.167:8089`.

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
