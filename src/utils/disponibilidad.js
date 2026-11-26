// HU-3 · Reglas de DISPONIBILIDAD (las mismas de frontend/src/utils/disponibilidad.js,
// ahora del lado del servidor). Funciones puras: no leen la base ni conocen Express.
// El servicio les pasa los datos ya buscados, así la misma regla sirve para la
// búsqueda, el calendario semanal y los espacios similares.
//
// Fechas 'YYYY-MM-DD' y horas 'HH:mm' en hora de Lima.

const pad2 = (n) => String(n).padStart(2, '0');

/* ------------------------------- Catálogo --------------------------------- */

export const ETIQUETAS_TIPO = {
  sala: 'Sala de estudio grupal',
  laboratorio: 'Laboratorio de cómputo',
  cabina: 'Cabina de grabación',
  auditorio: 'Auditorio',
  sala_reuniones: 'Sala de reuniones',
};

/** Criterios del selector "Ordenar" (mockup 3.1). */
export const ORDENES_BUSQUEDA = [
  { value: 'proximidad', label: 'Proximidad' },
  { value: 'aforo', label: 'Aforo' },
  { value: 'sede', label: 'Sede' },
];

/** Estados de reserva que ocupan el bloque (una cancelada lo deja libre). */
export const ESTADOS_QUE_OCUPAN = ['confirmada', 'atendida', 'inasistencia'];

/** Estado de un bloque en el calendario (leyenda del mockup 3.4). */
export const ESTADOS_BLOQUE = {
  libre: 'libre',
  ocupado: 'ocupado',
  propia: 'propia',               // "Mi reserva"
  noDisponible: 'no_disponible',
};

/** Por qué un bloque está "No disponible". */
export const MOTIVOS_NO_DISPONIBLE = {
  espacio: 'espacio',   // el espacio está en mantenimiento o de baja
  cerrado: 'cerrado',   // fuera del horario de atención de ese día
  bloqueo: 'bloqueo',   // bloqueo por mantenimiento o evento (HU-5)
  pasado: 'pasado',     // el bloque ya empezó o ya terminó
};

/* -------------------------------- Fechas ---------------------------------- */

const DIAS_CORTOS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const DIAS_LARGOS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
const DIAS_POR_SEMANA = 6; // la semana de reservas va de lunes a sábado

/**
 * "Ahora" con la hora de Lima, aunque el servidor esté en otra zona horaria
 * (Vercel corre en UTC: sin esto, después de las 7 p. m. ya sería "mañana").
 * Devuelve un Date cuyos getHours(), getDate()… son los de Lima.
 */
export function ahoraLima(base = new Date()) {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Lima',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(base).map((p) => [p.type, p.value])
  );
  return new Date(partes.year, partes.month - 1, partes.day, partes.hour, partes.minute, partes.second);
}

/** Date → 'YYYY-MM-DD' */
export const aISO = (fecha) => `${fecha.getFullYear()}-${pad2(fecha.getMonth() + 1)}-${pad2(fecha.getDate())}`;

/** ¿Es un texto 'YYYY-MM-DD' con una fecha real? ('2026-02-30' → false) */
export const esFechaISO = (valor) =>
  typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor) && aISO(aFecha(valor)) === valor;

/** ¿Es una hora 'HH:mm'? (24:00 se acepta como fin del día) */
export const esHora = (valor) => /^(([01]\d|2[0-3]):[0-5]\d|24:00)$/.test(String(valor ?? ''));

/** ('2026-11-30', '10:00') → Date de ese momento */
export function aFecha(fechaISO, hora = '00:00') {
  const [y, m, d] = fechaISO.split('-').map(Number);
  const [hh, mm] = hora.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm);
}

export function sumarDias(fechaISO, dias) {
  const base = aFecha(fechaISO);
  return aISO(new Date(base.getFullYear(), base.getMonth(), base.getDate() + dias));
}

/** Las 6 fechas (lunes a sábado) de la semana de esa fecha. El domingo cuenta en la semana que termina. */
export function diasDeLaSemana(fechaISO) {
  const lunes = sumarDias(fechaISO, -((aFecha(fechaISO).getDay() + 6) % 7));
  return Array.from({ length: DIAS_POR_SEMANA }, (_, i) => sumarDias(lunes, i));
}

/** '2026-11-30' → 'Lun 30/11' */
export function etiquetaDia(fechaISO) {
  const fecha = aFecha(fechaISO);
  return `${DIAS_CORTOS[fecha.getDay()]} ${pad2(fecha.getDate())}/${pad2(fecha.getMonth() + 1)}`;
}

/** '2026-11-30' → '30/11/2026' */
export const formatearFecha = (fechaISO) => fechaISO.split('-').reverse().join('/');

/* ------------------------------- Horarios --------------------------------- */

/**
 * Horario general del campus (mockup 2.5). Se usa cuando el espacio no tiene filas
 * en horarios_atencion (la HU-2 aún no lo configuró). null = cerrado ese día.
 */
export const HORARIO_POR_DEFECTO = {
  domingo: null,
  lunes: { apertura: '07:00', cierre: '22:00' },
  martes: { apertura: '07:00', cierre: '22:00' },
  miercoles: { apertura: '07:00', cierre: '22:00' },
  jueves: { apertura: '07:00', cierre: '22:00' },
  viernes: { apertura: '07:00', cierre: '20:00' },
  sabado: { apertura: '08:00', cierre: '14:00' },
};

/** Texto comparable: sin tildes, en minúsculas y sin espacios sobrantes. */
export const normalizarTexto = (texto) =>
  String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/**
 * Horario de un espacio en una fecha: { apertura, cierre } o null si cierra.
 * `espacio.horario` son las filas de horarios_atencion: [{ dia, apertura, cierre, habilitado }].
 */
export function horarioDelDia(espacio, fechaISO) {
  const dia = DIAS_LARGOS[aFecha(fechaISO).getDay()];
  if (!espacio.horario?.length) return HORARIO_POR_DEFECTO[dia];

  const fila = espacio.horario.find((h) => normalizarTexto(h.dia) === dia);
  if (!fila || !fila.habilitado || !fila.apertura || !fila.cierre) return null;
  return { apertura: fila.apertura, cierre: fila.cierre };
}

/** ¿El bloque cae completo dentro de la franja 'HH:mm'–'HH:mm'? (sin franja = sí) */
export const bloqueEnFranja = (bloque, desde, hasta) =>
  (!desde || bloque.horaInicio >= desde) && (!hasta || bloque.horaFin <= hasta);

/** ¿Este bloqueo cubre ese día y ese bloque? (sin bloques = todo el día, como en la HU-5) */
export const bloqueoCubre = (bloqueo, fecha, bloqueId) =>
  fecha >= bloqueo.desde && fecha <= bloqueo.hasta &&
  (bloqueo.bloqueIds.length === 0 || bloqueo.bloqueIds.includes(bloqueId));

/* --------------------------- Estado de un bloque -------------------------- */

/**
 * Estado de UN bloque de un espacio en una fecha. El orden de las reglas importa:
 * una reserva pasada se sigue viendo como ocupada o propia.
 * @returns {{ estado: string, motivo: string|null, detalle: string|null }}
 */
export function evaluarBloque({ espacio, fecha, bloque, reserva, bloqueo, usuarioId, ahora }) {
  const noDisponible = (motivo, detalle = null) => ({ estado: ESTADOS_BLOQUE.noDisponible, motivo, detalle });

  if (espacio.estado !== 'disponible') return noDisponible(MOTIVOS_NO_DISPONIBLE.espacio);

  const horario = horarioDelDia(espacio, fecha);
  if (!horario || bloque.horaInicio < horario.apertura || bloque.horaFin > horario.cierre) {
    return noDisponible(MOTIVOS_NO_DISPONIBLE.cerrado);
  }

  if (bloqueo) return noDisponible(MOTIVOS_NO_DISPONIBLE.bloqueo, bloqueo.motivo ?? null);

  if (reserva) {
    const esPropia = usuarioId !== null && reserva.usuarioId === usuarioId;
    return {
      estado: esPropia ? ESTADOS_BLOQUE.propia : ESTADOS_BLOQUE.ocupado,
      motivo: null,
      detalle: esPropia ? reserva.codigo : null,
    };
  }

  // Misma regla que la HU-4: no se reserva un bloque que ya empezó.
  if (aFecha(fecha, bloque.horaInicio) <= ahora) return noDisponible(MOTIVOS_NO_DISPONIBLE.pasado);

  return { estado: ESTADOS_BLOQUE.libre, motivo: null, detalle: null };
}
