// HU-3 · Consultas de disponibilidad (como ordenes.repository.js de la clase 18).
// La HU-3 solo LEE: espacios (HU-2), bloques horarios y reservas (HU-4) y bloqueos (HU-5).
// Hereda de RepositoryBase y reemplaza o agrega los métodos que necesitan include.
import { Op } from 'sequelize'
import {
  Sede, Espacio, Equipamiento, HorarioAtencion,
  BloqueHorario, Reserva, Bloqueo, BloqueoBloque
} from '../models/relaciones.js'
import RepositoryBase from './RepositoryBase.js'
import { ESTADOS_QUE_OCUPAN } from '../utils/disponibilidad.js'

const repository = new RepositoryBase(Espacio);

/** Sede, equipamiento y horario del espacio (los `as` son los de relaciones.js). */
const includeEspacio = [
  { model: Sede, attributes: ['id', 'nombre'] },
  { model: Equipamiento, as: 'equipamiento', attributes: ['id', 'nombre', 'cantidad'] },
  { model: HorarioAtencion, as: 'horario', attributes: ['id', 'dia', 'apertura', 'cierre', 'habilitado'] }
];

/** Si llegan ids de espacios, filtra por ellos; si no, trae todos. */
const filtroEspacios = (espacioIds) => (espacioIds ? { espacioId: espacioIds } : {});

/** REEMPLAZA findAll: espacios con sus hijas. Con soloDisponibles, los que están 'disponible'. */
repository.findAll = async ({ soloDisponibles = false } = {}) => {
  try {
    return await Espacio.findAll({
      where: soloDisponibles ? { estado: 'disponible' } : {},
      include: includeEspacio,
      order: [['codigo', 'ASC']]
    });
  } catch (error) {
    console.log(error);
    return null;
  }
}

/** REEMPLAZA findOne para traer también la sede, el equipamiento y el horario. */
repository.findOne = async (id) => {
  try {
    return await Espacio.findOne({
      where: { id: id },
      include: includeEspacio
    });
  } catch (error) {
    console.log(error);
    return null;
  }
}

/** Sedes para el filtro de la búsqueda. */
repository.findSedes = async () => {
  try {
    return await Sede.findAll({ attributes: ['id', 'nombre'], order: [['nombre', 'ASC']] });
  } catch (error) {
    console.log(error);
    return null;
  }
}

/** Bloques horarios del día, del más temprano al más tarde. */
repository.findBloques = async () => {
  try {
    return await BloqueHorario.findAll({
      attributes: ['id', 'horaInicio', 'horaFin'],
      order: [['horaInicio', 'ASC']]
    });
  } catch (error) {
    console.log(error);
    return null;
  }
}

/** Reservas que ocupan su bloque (confirmada, atendida, inasistencia) entre dos fechas. */
repository.findReservasQueOcupan = async ({ desde, hasta, espacioIds }) => {
  try {
    return await Reserva.findAll({
      where: {
        estado: ESTADOS_QUE_OCUPAN,
        fecha: { [Op.between]: [desde, hasta] },
        ...filtroEspacios(espacioIds)
      },
      attributes: ['id', 'codigo', 'espacioId', 'bloqueId', 'usuarioId', 'fecha', 'estado']
    });
  } catch (error) {
    console.log(error);
    return null;
  }
}

/** Bloqueos cuyas fechas se cruzan con [desde, hasta], con sus bloques (sin filas = todo el día). */
repository.findBloqueos = async ({ desde, hasta, espacioIds }) => {
  try {
    return await Bloqueo.findAll({
      where: {
        desde: { [Op.lte]: hasta },
        hasta: { [Op.gte]: desde },
        ...filtroEspacios(espacioIds)
      },
      attributes: ['id', 'espacioId', 'desde', 'hasta', 'motivo'],
      include: [{ model: BloqueoBloque, as: 'bloques', attributes: ['id', 'bloqueId'] }]
    });
  } catch (error) {
    console.log(error);
    return null;
  }
}

export default repository;
