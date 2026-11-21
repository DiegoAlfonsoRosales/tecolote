# Cambios

Versiones: **X.0** cambios de estructura · **x.Y** cambios sencillos · **x.x.Z** cambios mínimos.

## v1.2.2
- Íconos SVG propios en lugar de emojis en la interfaz: ahora se ven en compus sin fuente de emojis (ej. Fedora).

## v1.2.1
- Cache busting: los archivos estáticos llevan una huella de su contenido (`app.js?v=…`) y el HTML nunca se guarda en caché. Cada actualización se ve de inmediato, sin purgar Cloudflare.

## v1.2.0
- Rutinas: tareas que se repiten ciertos días a una hora (todos los días, lunes a viernes o días a elegir).
- Avisan a su hora y cada 30 min hasta marcarlas; al día siguiente empiezan de cero.
- Botón ✅ Hecho en la notificación, sección "Rutinas de hoy", pestaña Rutinas, racha 🔥 de días seguidos y opción de pausar.

## v1.1.0
- Vista para compu: dos columnas (Vencidos y Hoy | Próximos) y formulario fijo en un panel lateral.
- Atajos de teclado: `N` nuevo pendiente, `Enter` guardar, `Esc` cancelar edición.
- La versión se muestra en ⚙️ Ajustes.

## v1.0.0
- Primera versión: pendientes con fecha y hora opcional, recordatorios escalonados por ntfy, silencio de 12 am a 6 am, botones ✅ Completada y 😴 En 1 hora, login con sesión que no expira.
