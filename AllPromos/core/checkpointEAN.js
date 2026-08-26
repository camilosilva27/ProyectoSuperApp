/**
 * Checkpoint genérico para los completar-*-por-ean.js. Estos scripts tardan 20-40 minutos y
 * ya se cortaron solos dos veces en la misma sesión (sin error visible — probablemente algo a
 * nivel de sesión/máquina, no de los scripts) sin haber llegado a escribir nada (solo escriben
 * al final) — cada corte hacía perder todo el progreso y arrancar de cero. Esto guarda el
 * avance cada 50 EAN procesados para poder retomar en vez de repetir.
 */
const fs = require('fs');

function rutaCheckpoint(nombre) {
  return `./.checkpoint-${nombre}.json`;
}

function cargarCheckpoint(nombre, candidatosEsperados) {
  const ruta = rutaCheckpoint(nombre);
  try {
    const datos = JSON.parse(fs.readFileSync(ruta, 'utf8'));
    // Si la lista de candidatos cambió (otro catálogo se actualizó mientras tanto), el
    // checkpoint queda invalidado — mejor arrancar de nuevo que retomar sobre datos que ya no
    // corresponden al mismo conjunto de EAN a probar.
    if (datos.totalCandidatos !== candidatosEsperados) return null;
    return datos;
  } catch {
    return null;
  }
}

function guardarCheckpoint(nombre, { totalCandidatos, procesados, encontrados, negativos }) {
  fs.writeFileSync(rutaCheckpoint(nombre), JSON.stringify({ totalCandidatos, procesados, encontrados, negativos }));
}

function borrarCheckpoint(nombre) {
  try { fs.unlinkSync(rutaCheckpoint(nombre)); } catch { /* no existía, no pasa nada */ }
}

module.exports = { cargarCheckpoint, guardarCheckpoint, borrarCheckpoint };
