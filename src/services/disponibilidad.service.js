// HU-3 · Reglas de DISPONIBILIDAD Y BÚSQUEDA (las mismas de
// frontend/src/services/availabilityService.js, ahora del lado del servidor).
// El controlador solo recibe y responde; aquí se valida y se calcula.
//
// Las respuestas tienen la MISMA forma que en la primera entrega, así los
// componentes de React no cambian: solo cambia de dónde salen los datos.
import repository from '../repositories/disponibilidad.repository.js'
import { crearError } from '../utils/errores.js'
import {
  ETIQUETAS_TIPO, ORDENES_BUSQUEDA, ESTADOS_QUE_OCUPAN, ESTADOS_BLOQUE,
  ahoraLima, aISO, esFechaISO, esHora, sumarDias, diasDeLaSemana, etiquetaDia, formatearFecha,
  normalizarTexto, bloqueEnFranja, bloqueoCubre, evaluarBloque
} from '../utils/disponibilidad.js'

const AFORO_MAX = 1000;
const LIMITE_SIMILARES_MAX = 10;

/* ------------------------------ Validación -------------------------------- */
/* Todo lo que llega por la URL se revisa aquí: no se confía en el frontend.  */

/** ?tipo=a&tipo=b llega como arreglo; ?tipo=a como texto; "a,b" también se acepta. */
const aLista = (valor) =>
  (Array.isArray(valor) ? valor : String(valor ?? '').split(','))
    .map((v) => String(v).trim())
    .filter(Boolean);

const texto = (valor) => (typeof valor === 'string' && valor.trim() ? valor.trim() : undefined);

/** Número entero opcional: undefined si no llegó, NaN si llegó mal. */
const entero = (valor) => (texto(valor) === undefined ? undefined : Number(valor));
const esEnteroEntre = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;

function validarFecha(valor, campo, hoy, errores) {
  const fecha = texto(valor) ?? hoy;
  if (!esFechaISO(fecha)) errores[campo] = 'Usa una fecha válida (AAAA-MM-DD).';
  return fecha;
}

function validarFranja({ desde, hasta }, errores) {
  const inicio = texto(desde);
  const fin = texto(hasta);
  if (inicio && !esHora(inicio)) errores.desde = 'Usa el formato HH:mm.';
  if (fin && !esHora(fin)) errores.hasta = 'Usa el formato HH:mm.';
  if (inicio && fin && !errores.desde && !errores.hasta && inicio >= fin) {
    errores.hasta = 'La hora de fin debe ser posterior a la hora de inicio.';
  }
  return { desde: inicio, hasta: fin };
}

function validarUsuario(valor, errores) {
  const id = entero(valor);
  if (id !== undefined && !esEnteroEntre(id, 1, Number.MAX_SAFE_INTEGER)) errores.usuarioId = 'Usuario inválido.';
  return id ?? null;
}

function lanzarSiHayErrores(errores, mensaje) {
  if (Object.keys(errores).length > 0) throw crearError(400, mensaje, { code: 'VALIDACION', campos: errores });
}

/** GET /disponibilidad/espacios?sedeId&tipo&aforo&equipo&dia&desde&hasta&orden&usuarioId */
function validarBusqueda(query, hoy) {
  const errores = {};

  const sedeId = entero(query.sedeId);
  if (sedeId !== undefined && !esEnteroEntre(sedeId, 1, Number.MAX_SAFE_INTEGER)) errores.sedeId = 'Sede inválida.';

  const tipos = aLista(query.tipo);
  const desconocidos = tipos.filter((tipo) => !ETIQUETAS_TIPO[tipo]);
  if (desconocidos.length) errores.tipo = `Tipo de espacio desconocido: ${desconocidos.join(', ')}.`;

  const aforoMin = entero(query.aforo) ?? 0;
  if (!esEnteroEntre(aforoMin, 0, AFORO_MAX)) {
    errores.aforo = `El aforo mínimo debe ser un número entero entre 0 y ${AFORO_MAX}.`;
  }

  const orden = texto(query.orden) ?? 'proximidad';
  if (!ORDENES_BUSQUEDA.some((o) => o.value === orden)) errores.orden = 'El orden debe ser proximidad, aforo o sede.';

  const fecha = validarFecha(query.dia, 'dia', hoy, errores);
  const franja = validarFranja(query, errores);
  const usuarioId = validarUsuario(query.usuarioId, errores);

  lanzarSiHayErrores(errores, 'Revisa los filtros de la búsqueda.');
  return { sedeId: sedeId ?? null, tipos, aforoMin, equipamiento: aLista(query.equipo), fecha, ...franja, orden, usuarioId };
}

/** GET /disponibilidad/espacios/:id/semana y /similares ?semana&desde&hasta(&limite)(&usuarioId) */
function validarConsultaSemana(id, query, hoy, { conLimite = false } = {}) {
  const errores = {};

  const espacioId = Number(id);
  if (!esEnteroEntre(espacioId, 1, Number.MAX_SAFE_INTEGER)) errores.espacioId = 'Espacio inválido.';

  const fecha = validarFecha(query.semana, 'semana', hoy, errores);
  const franja = validarFranja(query, errores);
  const usuarioId = validarUsuario(query.usuarioId, errores);

  const limite = entero(query.limite) ?? 3;
  if (conLimite && !esEnteroEntre(limite, 1, LIMITE_SIMILARES_MAX)) {
    errores.limite = `El límite debe ser un número entero entre 1 y ${LIMITE_SIMILARES_MAX}.`;
  }

  lanzarSiHayErrores(errores, 'Revisa los datos de la consulta.');
  return { espacioId, fecha, ...franja, usuarioId, limite };
}

/* ------------------------------ Vistas ------------------------------------ */
/* Arman el JSON que recibe el frontend (sin los objetos de Sequelize).      */

function aVistaEspacio(espacio) {
  return {
    id: espacio.id,
    codigo: espacio.codigo,
    nombre: espacio.nombre,
    tipo: espacio.tipo,
    tipoLabel: ETIQUETAS_TIPO[espacio.tipo] ?? espacio.tipo,
    sedeId: espacio.sedeId,
    sedeLabel: espacio.sede?.nombre ?? '',
    pabellon: espacio.pabellon ?? espacio.ubicacion ?? '',
    piso: espacio.piso ?? null,
    ubicacion: espacio.ubicacion ?? espacio.pabellon ?? '',
    capacidad: espacio.capacidad,
    descripcion: '',
    equipamiento: (espacio.equipamiento ?? []).map((e) => ({ nombre: e.nombre, cantidad: e.cantidad })),
    foto: espacio.foto ?? null,
    estado: espacio.estado,
  };
}

/** Lo que necesitan las reglas para evaluar un bloque (horario incluido). */
const aEspacioRegla = (espacio) => ({
  id: espacio.id,
  estado: espacio.estado,
  horario: (espacio.horario ?? []).map((h) => ({
    dia: h.dia, apertura: h.apertura, cierre: h.cierre, habilitado: h.habilitado
  })),
});

const aVistaBloque = (bloque) => ({
  id: bloque.id,
  horaInicio: bloque.horaInicio,
  horaFin: bloque.horaFin,
  etiqueta: `${bloque.horaInicio} – ${bloque.horaFin}`,
});

/* ------------------------------ Lecturas ---------------------------------- */
/* El repositorio devuelve null si falla la consulta (patrón de la clase).    */

function exigir(resultado, mensaje) {
  if (!resultado) throw crearError(500, mensaje);
  return resultado;
}

/* ------------------------------- Servicio --------------------------------- */
/* Se crea con el repositorio y un reloj para poder probarlo con datos en     */
/* memoria; el que usa la API es el de abajo (export default).                */

export function crearServicio(repo, reloj = () => ahoraLima()) {

  async function leerEspacio(espacioId) {
    const espacio = await repo.findOne(espacioId);
    if (!espacio) throw crearError(404, 'El espacio que buscas no existe o fue retirado del catálogo.', { code: 'NO_ENCONTRADO' });
    return espacio;
  }

  async function leerBloques(desde, hasta) {
    const bloques = exigir(await repo.findBloques(), 'No se pudieron leer los bloques horarios.');
    return bloques
      .map(aVistaBloque)
      .sort((a, b) => a.horaInicio.localeCompare(b.horaInicio))
      .filter((bloque) => bloqueEnFranja(bloque, desde, hasta));
  }

  /** Reservas y bloqueos del rango, indexados para encontrar rápido el de cada celda. */
  async function leerOcupacion({ desde, hasta, espacioIds }) {
    const [reservas, bloqueos] = await Promise.all([
      repo.findReservasQueOcupan({ desde, hasta, espacioIds }),
      repo.findBloqueos({ desde, hasta, espacioIds }),
    ]);
    exigir(reservas, 'No se pudieron leer las reservas.');
    exigir(bloqueos, 'No se pudieron leer los bloqueos.');

    const reservaPorCelda = new Map();
    reservas
      .filter((r) => ESTADOS_QUE_OCUPAN.includes(r.estado))
      .forEach((r) => reservaPorCelda.set(`${r.espacioId}|${r.fecha}|${r.bloqueId}`, r));

    const bloqueosPorEspacio = new Map();
    bloqueos.forEach((b) => {
      const lista = bloqueosPorEspacio.get(b.espacioId) ?? [];
      lista.push({ desde: b.desde, hasta: b.hasta, motivo: b.motivo, bloqueIds: (b.bloques ?? []).map((f) => f.bloqueId) });
      bloqueosPorEspacio.set(b.espacioId, lista);
    });

    return { reservaPorCelda, bloqueosPorEspacio };
  }

  /** Estado de cada bloque de un espacio en un día. */
  function calcularDia(espacio, fecha, bloques, ocupacion, { usuarioId = null, ahora }) {
    const regla = aEspacioRegla(espacio);
    const bloqueos = ocupacion.bloqueosPorEspacio.get(espacio.id) ?? [];
    return bloques.map((bloque) => ({
      fecha,
      bloqueId: bloque.id,
      ...evaluarBloque({
        espacio: regla,
        fecha,
        bloque,
        reserva: ocupacion.reservaPorCelda.get(`${espacio.id}|${fecha}|${bloque.id}`) ?? null,
        bloqueo: bloqueos.find((b) => bloqueoCubre(b, fecha, bloque.id)) ?? null,
        usuarioId,
        ahora,
      }),
    }));
  }

  /** GET /disponibilidad/opciones → valores del panel de filtros (mockup 3.1). */
  async function opciones() {
    const [sedes, espacios] = await Promise.all([repo.findSedes(), repo.findAll({ soloDisponibles: true })]);
    exigir(sedes, 'No se pudieron leer las sedes.');
    exigir(espacios, 'No se pudieron leer los espacios.');

    const tipos = [...new Set(espacios.map((e) => e.tipo))];
    const equipos = new Map(); // nombre sin tildes → nombre visible
    espacios.forEach((e) => (e.equipamiento ?? []).forEach((item) => {
      const clave = normalizarTexto(item.nombre);
      if (!equipos.has(clave)) equipos.set(clave, item.nombre);
    }));

    return {
      sedes: sedes.map((s) => ({ value: s.id, label: s.nombre })),
      tipos: tipos.map((value) => ({ value, label: ETIQUETAS_TIPO[value] ?? value })),
      equipamiento: [...equipos.values()]
        .sort((a, b) => a.localeCompare(b, 'es'))
        .map((nombre) => ({ value: nombre, label: nombre })),
      ordenes: ORDENES_BUSQUEDA,
    };
  }

  /** GET /disponibilidad/espacios → espacios con al menos un bloque libre ese día (mockups 3.1 y 3.2). */
  async function buscar(query) {
    const ahora = reloj();
    const filtros = validarBusqueda(query, aISO(ahora));
    const { fecha, desde, hasta } = filtros;

    const [espacios, bloques, ocupacion] = await Promise.all([
      repo.findAll({ soloDisponibles: true }),
      leerBloques(desde, hasta),
      leerOcupacion({ desde: fecha, hasta: fecha }),
    ]);
    exigir(espacios, 'No se pudieron leer los espacios.');

    const cumpleFiltros = (vista) => {
      if (filtros.sedeId && vista.sedeId !== filtros.sedeId) return false;
      if (filtros.tipos.length && !filtros.tipos.includes(vista.tipo)) return false;
      if (filtros.aforoMin && vista.capacidad < filtros.aforoMin) return false;
      const tiene = new Set(vista.equipamiento.map((item) => normalizarTexto(item.nombre)));
      return filtros.equipamiento.every((nombre) => tiene.has(normalizarTexto(nombre)));
    };

    const porCodigo = (a, b) => a.codigo.localeCompare(b.codigo, 'es');
    const comparar = {
      // El siguiente bloque libre más temprano primero; empate → menor aforo.
      proximidad: (a, b) => a.proximoLibre.horaInicio.localeCompare(b.proximoLibre.horaInicio) || a.capacidad - b.capacidad || porCodigo(a, b),
      aforo: (a, b) => a.capacidad - b.capacidad || porCodigo(a, b),
      sede: (a, b) => a.sedeLabel.localeCompare(b.sedeLabel, 'es') || porCodigo(a, b),
    }[filtros.orden];

    const resultados = espacios
      .map((espacio) => ({ espacio, vista: aVistaEspacio(espacio) }))
      .filter(({ vista }) => cumpleFiltros(vista))
      .map(({ espacio, vista }) => {
        const libres = calcularDia(espacio, fecha, bloques, ocupacion, { usuarioId: filtros.usuarioId, ahora })
          .filter((celda) => celda.estado === ESTADOS_BLOQUE.libre);
        const primero = libres.length ? bloques.find((b) => b.id === libres[0].bloqueId) : null;
        return {
          ...vista,
          bloquesLibres: libres.length,
          proximoLibre: primero ? { bloqueId: primero.id, horaInicio: primero.horaInicio } : null,
        };
      })
      .filter((resultado) => resultado.proximoLibre)
      .sort(comparar);

    return { resultados, total: resultados.length, fecha };
  }

  /** GET /disponibilidad/espacios/:id/semana → calendario semanal (mockups 3.4, 3.5 y 3.6). */
  async function semana(id, query) {
    const ahora = reloj();
    const { espacioId, fecha, desde, hasta, usuarioId } = validarConsultaSemana(id, query, aISO(ahora));
    const espacio = await leerEspacio(espacioId);
    const dias = diasDeLaSemana(fecha);

    const [bloques, ocupacion] = await Promise.all([
      leerBloques(desde, hasta),
      leerOcupacion({ desde: dias[0], hasta: dias[dias.length - 1], espacioIds: [espacio.id] }),
    ]);
    const columnas = dias.map((dia) => calcularDia(espacio, dia, bloques, ocupacion, { usuarioId, ahora }));

    // De columnas (día → bloques) a filas (bloque → días), que es como se dibuja la grilla.
    const filas = bloques.map((bloque, i) => ({ bloque, celdas: columnas.map((columna) => columna[i]) }));

    const resumen = Object.fromEntries(Object.values(ESTADOS_BLOQUE).map((estado) => [estado, 0]));
    columnas.flat().forEach((celda) => { resumen[celda.estado] += 1; });
    const hoy = aISO(ahora);

    return {
      espacio: aVistaEspacio(espacio),
      semana: {
        desde: dias[0],
        hasta: dias[dias.length - 1],
        rangoTexto: `${formatearFecha(dias[0])} al ${formatearFecha(dias[dias.length - 1])}`,
        anterior: sumarDias(dias[0], -7),
        siguiente: sumarDias(dias[0], 7),
        dias: dias.map((dia) => ({ fecha: dia, etiqueta: etiquetaDia(dia), esHoy: dia === hoy })),
      },
      bloques,
      filas,
      resumen,
      franja: desde || hasta ? { desde: desde ?? null, hasta: hasta ?? null } : null,
      // 3.6: ningún bloque libre en el rango consultado.
      sinDisponibilidad: resumen.libre === 0,
      // 3.5: hay bloques en horario y todos están tomados por reservas.
      semanaCompleta: resumen.libre === 0 && resumen.ocupado + resumen.propia > 0,
    };
  }

  /** GET /disponibilidad/espacios/:id/similares → parecidos con bloques libres esa semana (3.5 y 3.6). */
  async function similares(id, query) {
    const ahora = reloj();
    const { espacioId, fecha, desde, hasta, limite } = validarConsultaSemana(id, query, aISO(ahora), { conLimite: true });
    const origen = await leerEspacio(espacioId);
    const dias = diasDeLaSemana(fecha);

    const [espacios, bloques, ocupacion] = await Promise.all([
      repo.findAll({ soloDisponibles: true }),
      leerBloques(desde, hasta),
      leerOcupacion({ desde: dias[0], hasta: dias[dias.length - 1] }),
    ]);
    exigir(espacios, 'No se pudieron leer los espacios.');

    return espacios
      .filter((e) => e.id !== origen.id)
      .map((espacio) => ({
        ...aVistaEspacio(espacio),
        mismoTipo: espacio.tipo === origen.tipo,
        bloquesLibres: dias
          .flatMap((dia) => calcularDia(espacio, dia, bloques, ocupacion, { ahora }))
          .filter((celda) => celda.estado === ESTADOS_BLOQUE.libre).length,
      }))
      .filter((e) => e.bloquesLibres > 0)
      .sort((a, b) =>
        Number(b.mismoTipo) - Number(a.mismoTipo) ||
        Math.abs(a.capacidad - origen.capacidad) - Math.abs(b.capacidad - origen.capacidad))
      .slice(0, limite);
  }

  return { opciones, buscar, semana, similares };
}

const service = crearServicio(repository);

export default service;
