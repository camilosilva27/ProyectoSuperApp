/**
 * Código postal guardado del usuario, solo para La Anónima (ver core/laanonima-zona.js —
 * el CP es un gate binario de cobertura, no selecciona precio). Mismo patrón que
 * mis-tarjetas.json/leerMisTarjetas() en promos-bancarias.js: archivo JSON local, no
 * versionado (agregado a .gitignore), lectura defensiva.
 *
 * `null` (archivo ausente) significa "todavía no se preguntó nunca" — la CLI debe preguntar.
 * `{ codigoPostal: null, coberturaConfirmada: false }` (archivo presente con valores vacíos)
 * significa "ya se preguntó, el usuario omitió o no tiene cobertura" — no volver a preguntar.
 */

const fs = require('fs');
const path = require('path');

const ARCHIVO = path.join(__dirname, 'mi-codigo-postal.json');

function leerMiCodigoPostal() {
  try {
    return JSON.parse(fs.readFileSync(ARCHIVO, 'utf8'));
  } catch {
    return null;
  }
}

function guardarMiCodigoPostal({ codigoPostal, coberturaConfirmada }) {
  fs.writeFileSync(ARCHIVO, JSON.stringify({ codigoPostal, coberturaConfirmada }, null, 2));
}

module.exports = { leerMiCodigoPostal, guardarMiCodigoPostal };
