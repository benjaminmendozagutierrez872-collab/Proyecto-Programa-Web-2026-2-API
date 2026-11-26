import express from 'express';
import controller from '../controllers/disponibilidad.controller.js';

// HU-3 · Solo lectura (GET): la disponibilidad se calcula, no se guarda.
const router = express.Router();

router.get('/opciones', controller.opciones);                  // GET /disponibilidad/opciones
router.get('/espacios', controller.buscar);                    // GET /disponibilidad/espacios?sedeId=1&tipo=sala&aforo=6&dia=…
router.get('/espacios/:id/semana', controller.semana);         // GET /disponibilidad/espacios/1/semana?semana=…&usuarioId=1
router.get('/espacios/:id/similares', controller.similares);   // GET /disponibilidad/espacios/1/similares?semana=…&limite=3

export default router;
