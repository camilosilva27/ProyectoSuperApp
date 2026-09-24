/**
 * Fecha "de calendario" en hora argentina, independiente de la zona horaria del proceso.
 *
 * Por qué existe (auditoría 2026-09-24): el backend corre en una VM en UTC, y `Date#getDay()`
 * / `getDate()` / `getMonth()` usan la zona del proceso. Entre las 21:00 y las 24:00 hora
 * argentina (UTC-3) en UTC ya es el día siguiente → se aplicaban las promos bancarias del día
 * siguiente (ej. el martes a las 22hs se mostraba la promo del miércoles). Argentina no tiene
 * horario de verano desde 2009, pero se usa Intl con la zona IANA igual para no hardcodear el
 * -3 (Node trae ICU completo desde la v13, así que no hace falta ninguna dependencia).
 */
const ZONA_AR = 'America/Argentina/Buenos_Aires';

const formateador = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONA_AR,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
});

const DIA_SEMANA_ISO = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** { anio, mes (1-12), dia (1-31), diaSemanaISO (1=lunes...7=domingo) } en hora argentina. */
function partesFechaArgentina(fecha = new Date()) {
  const partes = Object.fromEntries(formateador.formatToParts(fecha).map(p => [p.type, p.value]));
  return {
    anio: Number(partes.year),
    mes: Number(partes.month),
    dia: Number(partes.day),
    diaSemanaISO: DIA_SEMANA_ISO[partes.weekday],
  };
}

/** Día de la semana ISO (1=lunes...7=domingo) en hora argentina. */
function diaSemanaISOArgentina(fecha = new Date()) {
  return partesFechaArgentina(fecha).diaSemanaISO;
}

/** "AAAA-MM-DD" en hora argentina — sirve para comparar "mismo día" o contra fechas sin hora. */
function fechaISOArgentina(fecha = new Date()) {
  const { anio, mes, dia } = partesFechaArgentina(fecha);
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

module.exports = { ZONA_AR, partesFechaArgentina, diaSemanaISOArgentina, fechaISOArgentina };
