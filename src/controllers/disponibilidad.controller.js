// HU-3 · Controlador de disponibilidad: recibe la petición, llama al servicio y responde.
// Si el servicio lanza un error con status (400, 404), responderError lo devuelve
// con ese código y su `message`.
import service from '../services/disponibilidad.service.js'
import { responderError } from '../utils/errores.js'

const opciones = async (req, resp) => {
  try {
    const respuesta = await service.opciones();
    return resp.status(200).json(respuesta);
  } catch (error) {
    return responderError(error, resp);
  }
}

const buscar = async (req, resp) => {
  try {
    const respuesta = await service.buscar(req.query);
    return resp.status(200).json(respuesta);
  } catch (error) {
    return responderError(error, resp);
  }
}

const semana = async (req, resp) => {
  try {
    const respuesta = await service.semana(req.params.id, req.query);
    return resp.status(200).json(respuesta);
  } catch (error) {
    return responderError(error, resp);
  }
}

const similares = async (req, resp) => {
  try {
    const respuesta = await service.similares(req.params.id, req.query);
    return resp.status(200).json(respuesta);
  } catch (error) {
    return responderError(error, resp);
  }
}

const controller = { opciones, buscar, semana, similares }

export default controller;
