# Cambios

Versiones: **X.0** cambios de estructura · **x.Y** cambios sencillos · **x.x.Z** cambios mínimos.

## v2.3.0
- **Medicinas a horas fijas**: ej. metformina en desayuno y cena (08:00 y 20:00). Agrega las horas que quieras.
- Opción **"Sin fecha de fin"** para tratamientos permanentes.
- El margen de 1 h para "No registraste tu toma" se mantiene.

## v2.2.0
- **Medicinas** (pestaña nueva): nombre, cada cuántas horas, primera toma y por cuántos días. Tecolote calcula las tomas, muestra "Día X de N" y termina solo.
- Avisos estrictos: 10 min antes, a la hora prioridad máxima cada 5 min hasta marcar "💊 Tomada", y "No registraste tu toma" si pasa 1 h. Suenan aunque sea de noche.
- Sección "Medicinas de hoy" en Pendientes y tomas en el calendario .ics.

## v2.1.0
- **Rutinas con varios horarios**: cada horario tiene "recuérdame desde" y "hasta (límite)". Ej. perro 07:00→08:30 y 20:00→22:00. Entre horarios no hay avisos.
- Cada horario se marca por separado (en la app y con su botón ✅ en la notificación) y avisa por separado si te lo saltas. La racha cuenta los días con todos los horarios hechos.
- Las rutinas existentes se convierten solas a un horario (desde las 7:00 hasta su hora límite).

## v2.0.2
- Tocar la notificación ya no abre Tecolote: abre ntfy, que es lo que calla la alerta insistente de prioridad máxima.
- Nuevo botón "🦉 Abrir Tecolote" en cada aviso. El aviso de rutinas muestra hasta 2 botones ✅ (ntfy permite 3 en total).

## v2.0.1
- Las rutinas se recuerdan desde las 7:00 (hora de despertar, ajustable con `WAKE_HOUR`).

## v2.0.0
- **Rutinas con hora límite**: se recuerdan desde las 6:00 hasta su hora límite. Si pasa sin marcarla, llega "⚠️ Te saltaste…" y la racha se rompe.
- **Un solo aviso para todas las rutinas pendientes**, con un botón ✅ por rutina (hasta 3), cada 15 min.
- **Pendientes más insistentes**: el mismo día cada 15 min hasta la hora límite (prioridad máxima); vencidos cada 30 min.
- **Los avisos ya no se apilan**: cada aviso nuevo reemplaza al anterior (ntfy 2.16+), y al completar se quita del cel.
- **Respaldo sin internet**: calendario `.ics` secreto para la app ICSx⁵, con alarmas que suenan sin datos.

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
