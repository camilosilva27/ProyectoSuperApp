/**
 * Promos bancarias "por ticket": % de descuento (o cashback) sobre el total de la
 * compra, condicionado a día de la semana + banco/tarjeta + (opcionalmente) canal.
 * A diferencia de promo-engine.js (promos por producto), esto no depende de qué
 * productos comprás — se calcula una vez sobre el subtotal ya armado por super.
 *
 * Cálculo de hoy: sin filtrar por canal (informativo). Cálculo multi-día: mismo cálculo
 * repetido para los próximos 7 días y separado por canal (online vs. físico), por super de
 * forma independiente — no busca alinear el mismo día entre supers, y no recalcula qué
 * producto va a cada super (eso ya está fijo). Ver CONTEXTO_TECNICO.md para el detalle
 * completo de fuentes por super y decisiones de diseño.
 *
 * Nota sobre canal en Vea: a diferencia de Carrefour/Chango Más (que traen flags
 * hyper/market/ecommerce/express/maxi explícitos), el feed de bankDiscount de Vea NO
 * tiene ningún campo de canal confiable. Probé el booleano `checkout` esperando que
 * fuera la señal (por analogía con "pago en el checkout online") y no correlaciona con
 * nada: es `false` en 38 de 40 promos vigentes sin relación con si el texto legal
 * menciona "online" o "presencial". Por eso NO se intenta inferir canal de Vea con
 * regex sobre texto libre (sería adivinar) — sus promos quedan con canales=null
 * (aplican a ambos canales por igual, ver promoAplicaEnCanal).
 *
 * No toca promo-engine.js ni buscar-promos.js más allá de agregar secciones al final.
 */

const fs   = require('fs');
const path = require('path');

// Hashes de las queries GraphQL persistidas de VTEX. Son específicos de la versión
// desplegada de cada app (valtech.carrefourar-bank-promotions / valtech.gdn-banks-promotions)
// y pueden romperse sin aviso si el super actualiza la app — ver detectarHashRoto() más abajo.
const CARREFOUR_HOST          = 'https://www.carrefour.com.ar';
const CARREFOUR_HASH_PROMOTIONS = 'e3aa1d96402d80dbca5c2c9dbcb7ff859970db0ccfdb64e583fb8a9b1bbff49e';
const CARREFOUR_HASH_BANKS      = 'a17d0a4ae5248a8007075eb0c871b327be760c90f8ef994193758e4914e68c33';
const CARREFOUR_HASH_CARDS      = 'b0268b02cfc0021bcd0d0373f54e590bb71111cbcef4dcc62bf381a3a0abfa15';

const CHANGOMAS_HOST          = 'https://www.masonline.com.ar';
const CHANGOMAS_HASH_PROMOS     = '1a071ebc5dc407a3f65e687b0f4c0a3b8d12a0c45d8d11370075c3b2a505251c';
const CHANGOMAS_HASH_BANKS      = '968d464317be357766de0e3beb313a55e0ebf7f45f2ef4a02c99fdf4ebca0876';
const CHANGOMAS_HASH_CARDS      = 'b3aa47c5a259fd0c6ea4b9d29d553170da26dfcead2be3acafa026b9b9084b3a';

// Día no es VTEX IO en esta parte del sitio (a diferencia de su catálogo de productos):
// las promos bancarias son un bloque de CMS server-renderizado, embebido como JSON crudo
// dentro de un <script> de la página — no hay endpoint GraphQL ni Master Data que consultar
// aparte. DIA_BLOQUE_MARCA es el ancla estable (id de bloque, no contenido de campaña) para
// encontrar ese <script> dentro del HTML — ver fetchDia().
const DIA_HOST         = 'https://diaonline.supermercadosdia.com.ar';
const DIA_PROMOS_PATH  = '/medios-de-pago-y-promociones';
const DIA_BLOQUE_MARCA = 'landing-medios-pago#props":{';

// Tarjetas/billeteras que el usuario pidió modelar (4.7) + las propias de cada super.
// Los valores son substrings normalizados (sin tildes, minúsculas) a buscar en el
// nombre de banco YA RESUELTO (no en el string crudo de Carrefour/Chango Más, que son
// UUIDs — ver resolverIdAnombre). Ojo: "Banco provincia de Neuquén" existe como entidad
// separada en el catálogo de Vea; como acá no hay ninguna entrada literal "Banco
// Provincia" en Vea, el alias simplemente no matchea nada ahí, lo cual es correcto.
const ALIAS_TARJETAS = {
  'Santander':       ['santander'],
  'MODO':            ['modo'],
  'Mercado Pago':    ['mercado pago'],
  'Cuenta DNI':      ['cuenta dni'],
  'Banco Provincia': ['banco provincia'],
  'Cencopay':        ['cencopay'],
  // Carrefour tiene varios beneficios propios distintos entre sí, que se investigaron a
  // fondo el 2026-09-04 (el usuario detectó en el super que el descuento real pagando solo
  // con DNI era menor al que la app mostraba bajo "Mi Carrefour" — antes todo se trataba
  // como una sola cosa). Confirmado en vivo (micarrefour.com.ar, carrefourbanco.com.ar y el
  // feed GraphQL real de Carrefour):
  // - 'Mi Carrefour': nivel Clásico, se identifica solo con el DNI en caja, sin tarjeta ni
  //   cuenta. Confirmado en el feed de bancos (GetBanks, id 442cdb4d-...): el único
  //   ticket-promo activo hoy bajo este id es "10% si sos parte de Mi Carrefour y
  //   beneficiario de Anses o mayor de 60 años" — no es un descuento general para cualquiera.
  // - 'Cuenta Digital Carrefour': billetera/cuenta digital de Carrefour Banco (Banco de
  //   Servicios Financieros) — a diferencia de Mi Carrefour, requiere abrir cuenta de
  //   verdad (no alcanza con el DNI). Es la que da los descuentos de súper que la página de
  //   beneficios de la Tarjeta Prepaga anuncia (10% sáb/dom, 15% viernes, 10% Express a
  //   diario): el texto legal de esa página dice "ABONANDO CON CUENTA DIGITAL", NO
  //   "abonando con tarjeta prepaga" — son cosas distintas aunque Carrefour las publicite
  //   juntas. Raw name confirmado en el feed: "Cuenta Digital" (GetBanks id ec75bbe7-...,
  //   también existe como GetCards). La tarjeta Prepaga física en sí, aparte de la Cuenta
  //   Digital, solo tiene un beneficio confirmado (5% en combustible AXION) y ninguno de
  //   súper — por eso no se modela como tarjeta separada.
  // - 'Tarjeta Carrefour Crédito': la tarjeta de crédito real emitida por Carrefour Banco.
  //   Confirmado en vivo en el feed de tarjetas (GetCards, id 9217c372-..., raw name
  //   "Tarjeta_Standard_Master_Carrefour") con varios ticket-promos activos hoy ("20% de
  //   descuento en un pago con tarjeta de crédito de Carrefour Banco", etc.) que antes se
  //   descartaban en silencio por no tener alias — se suman acá. También es la tarjeta que
  //   exige el teaser de producto "Tarjeta Carrefour X%" (RestrictionsBins por BIN — ver
  //   interpretarTeaserTarjetaPropia en promo-engine.js), que antes este archivo etiquetaba
  //   mal como "Mi Carrefour".
  'Mi Carrefour':               ['mi carrefour'],
  'Cuenta Digital Carrefour':   ['cuenta digital'],
  'Tarjeta Carrefour Crédito':  ['standard_master_carrefour', 'carrefour credito', 'mi carrefour credito'],
  'MasClub':         ['masclub'],
  'Galicia':         ['galicia'],
  'Galicia Modo':    ['galicia modo'],
  'Banco Macro':     ['banco macro'],
  'HSBC':            ['hsbc'],
  'BBVA':            ['bbva'],
  'ICBC':            ['icbc'],
  // Sumados 2026-08-26 al auditar el campo `icono` (no `descripcion`) de Coto — ver
  // ICONO_BANCO_COTO más abajo. Confirmados en vivo también en `banks[].name` del feed de
  // Vea/Jumbo/Disco (Cencosud): "Banco Comafi", "Tarjeta Naranja X", "Banco Ciudad",
  // "supervielle", "Banco Columbia", "Banco Patagonia", "Nacion"/"banco Nacion".
  'Comafi':          ['comafi'],
  'Naranja X':       ['naranja x'],
  'Credicoop':       ['credicoop'],
  'Banco Ciudad':    ['banco ciudad'],
  'Supervielle':     ['supervielle'],
  'Banco Columbia':  ['banco columbia'],
  'Banco Patagonia': ['banco patagonia'],
  'Banco Nación':    ['banco nacion', 'nacion'],
  // Tarjeta propia de Coto, sin nombre de banco detrás — no apareció en el texto de
  // ningún otro super al verificar, se deja el alias igual por si alguno la suma después.
  'TCI':             ['tci'],
};

// "Banco provincia de Neuquén" es una entidad distinta de Banco Provincia de Bs.As.
// (dueño de Cuenta DNI) pero matchea el substring "banco provincia" — confirmado como
// riesgo real en la investigación. Excluida a mano.
const EXCLUSIONES_ALIAS = {
  'Banco Provincia': ['neuquen'],
  // "Galicia Modo" exige pagar con la app MODO del banco, no solo tener la tarjeta —
  // es una promo distinta de 'Galicia' aunque el nombre crudo contenga el substring
  // "galicia" (decisión del usuario: tratarlas separadas, como ya pasa con MODO vs.
  // Mercado Pago).
  'Galicia': ['modo'],
  // Mismo caso que Galicia Modo: "Banco Patagonia 365" es un programa de fidelización
  // propio, no equivalente a tener cualquier tarjeta Patagonia — visto en el feed de Vea
  // como entidad separada de "Banco Patagonia" a secas.
  'Banco Patagonia': ['365'],
  // Mismo patrón que Galicia/Galicia Modo: si algún día aparece un raw name que combine
  // "mi carrefour" con "credito" (o "prepaga", aunque hoy no exista ese nivel como entidad
  // propia en el feed — ver nota arriba), no tiene que contarse como el nivel Clásico.
  'Mi Carrefour': ['prepaga', 'credito'],
};

const DIAS_SEMANA_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const CANAL_KEYS = ['hyper', 'market', 'ecommerce', 'express', 'maxi'];

// ─── Utils ────────────────────────────────────────────────────────────────────

function normalizar(str) {
  return (str || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function resolverCanonicosDesdeNombre(nombre) {
  const n = normalizar(nombre);
  return Object.keys(ALIAS_TARJETAS).filter(canon => {
    if (!ALIAS_TARJETAS[canon].some(alias => n.includes(alias))) return false;
    const exclusiones = EXCLUSIONES_ALIAS[canon] || [];
    return !exclusiones.some(ex => n.includes(ex));
  });
}

function extraerMonto(texto, patrones) {
  const t = normalizar(texto);
  for (const re of patrones) {
    const m = t.match(re);
    if (m) return parseInt(m[1].replace(/\./g, '').replace(/,\d+$/, ''), 10);
  }
  return null;
}

// Best-effort: si el regex no encuentra nada, tope/montoMinimo quedan en null (se trata
// como "sin tope conocido", no como "sin tope real" — ver 4.5, el texto legal completo
// siempre se muestra junto al número calculado para que se pueda verificar a ojo).
function extraerTope(texto) {
  return extraerMonto(texto, [/tope[^$]{0,40}\$\s?([\d.,]+)/, /reintegr[oa][^$]{0,40}\$\s?([\d.,]+)/]);
}

function extraerMontoMinimo(texto) {
  return extraerMonto(texto, [/compra minima[^$]{0,40}\$\s?([\d.,]+)/, /a partir de\s?\$\s?([\d.,]+)/]);
}

function diaISO(fecha) {
  // JS: 0=domingo...6=sábado. Convención del proyecto (igual que el campo `days` de Vea): 1=lunes...7=domingo.
  return ((fecha.getDay() + 6) % 7) + 1;
}

function fmt(n) {
  return Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function leerMisTarjetas() {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'mis-tarjetas.json'), 'utf8'));
    return data.tarjetas || [];
  } catch {
    return [];
  }
}

// ─── Fetch: Vea (Master Data) ──────────────────────────────────────────────────

// Vea mezcla financiación y descuento real de forma inconsistente en discount/discountText
// (confirmado contra las 42 promos vigentes hoy 2026-07-01): si discountText menciona
// "cuota" sin "%", es financiación pura (ej. Santander "3 cuotas sin interés" — se descarta
// siempre, sin importar la tarjeta, según 4.1). Si aparece un "%" (aunque también mencione
// cuotas, ej. "% y 3 cuotas sin interés"), el campo `discount` numérico es el % real.
function esFinanciacionVea(discountText) {
  const t = (discountText || '').toLowerCase();
  return t.includes('cuota') && !t.includes('%');
}

// Vea, Jumbo y Disco son la MISMA cuenta VTEX (ver AllPromos/core/fetchers.js) y este feed de
// Master Data es DE CUENTA COMPLETA, no de sitio — confirmado en vivo pegándole al mismo
// endpoint desde los 3 dominios: devuelve exactamente el mismo array de entradas. Cada entrada
// tiene un campo `websites` (ej. ["veaargentina"], ["discoargentina"], o listas con
// "jumboargentina"/"jumboargentinaio" mezclados, a veces repetidos) que indica a qué banner(s)
// aplica esa promo puntual — hay que filtrar por ese campo.
//
// BUG que había antes de agregar Jumbo/Disco (2026-08-21): esta función tomaba TODAS las
// entradas del feed sin mirar `websites` — un usuario de Vea podía ver una promo bancaria que
// en realidad era exclusiva de Disco o Jumbo (o viceversa). Se corrige acá agregando el filtro.
//
// Ojo con Jumbo: el feed usa DOS tags para Jumbo ("jumboargentina" y "jumboargentinaio").
// Investigado en detalle (2026-08-21): NO es una distinción online/física — hay una promo real
// ("Jumbo Mas Personal", 20% con texto legal "Exclusivo Canal ONLINE") tagueada SOLO
// "jumboargentina" (sin "io"), lo que descarta esa hipótesis. Lo más probable, por cómo se
// repiten ambos tags en la misma entrada junto a listas largas de "veaargentina"/
// "discoargentina" (una ocurrencia por sucursal física alcanzada, no un tag deduplicado), es
// que sean dos identificadores de sucursal/sistema coexistentes para el banner Jumbo (viejo vs.
// nuevo código de tienda), no dos sitios distintos. Se usan los DOS como válidos para Jumbo
// (unión, no intersección) — coincide con la evidencia encontrada, no es una opción "por las
// dudas": con solo "io" se habría perdido la promo de "Jumbo Mas Personal" del ejemplo arriba.
const WEBSITE_TAGS_POR_SUPER = {
  Vea: ['veaargentina'],
  Jumbo: ['jumboargentina', 'jumboargentinaio'],
  Disco: ['discoargentina'],
};

async function fetchCencosud(superNombre) {
  try {
    const res = await fetch('https://www.vea.com.ar/api/dataentities/JN/documents/bankDiscount?_fields=value,id&an=jumboargentina');
    if (!res.ok) return { promos: [], error: 'fetch_failed' };
    const arr = JSON.parse((await res.json()).value);
    const tags = WEBSITE_TAGS_POR_SUPER[superNombre];

    const promos = [];
    for (const e of arr) {
      if (!(e.websites || []).some(w => tags.includes(w))) continue;
      if (esFinanciacionVea(e.discountText)) continue;
      const descuentoPct = Number(e.discount) / 100;
      if (!(descuentoPct > 0)) continue;

      const nombresBanco = (e.banks || []).map(b => b.name);
      const canonicosPosibles = [...new Set(nombresBanco.flatMap(resolverCanonicosDesdeNombre))];
      if (!canonicosPosibles.length) continue;

      const texto = `${e.info || ''} ${e.legals || ''}`;
      promos.push({
        canonicosPosibles,
        super: superNombre,
        dias: (e.days || []).map(Number),
        canales: null, // el feed no expone flags de canal, a diferencia de Carrefour/Chango Más
        descuentoPct,
        tope: extraerTope(texto),
        montoMinimo: extraerMontoMinimo(texto),
        vigenciaDesde: new Date(Number(e.dateStart) * 1000),
        vigenciaHasta: new Date(Number(e.dateEnd) * 1000),
        textoLegal: e.legals || e.info || '',
      });
    }
    return { promos, error: null };
  } catch {
    return { promos: [], error: 'fetch_failed' };
  }
}

async function fetchVea() { return fetchCencosud('Vea'); }
async function fetchJumbo() { return fetchCencosud('Jumbo'); }
async function fetchDisco() { return fetchCencosud('Disco'); }

// ─── Fetch: Carrefour / Chango Más (GraphQL persistido, mismo patrón) ─────────

async function fetchGraphQL(host, operationName, hash, variablesObj) {
  try {
    const extensions = { persistedQuery: { version: 1, sha256Hash: hash } };
    if (variablesObj) extensions.variables = Buffer.from(JSON.stringify(variablesObj)).toString('base64');
    const url = `${host}/_v/public/graphql/v1?operationName=${operationName}&extensions=${encodeURIComponent(JSON.stringify(extensions))}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    const data = await res.json();
    if (data.errors) {
      const msg = data.errors[0]?.message || '';
      // Confirmado en vivo: un hash inválido responde 200 con este mensaje, no un error HTTP.
      return { error: /PersistedQueryNotFound/i.test(msg) ? 'hash_roto' : 'fetch_failed' };
    }
    return { documents: data.data?.documents || [] };
  } catch {
    return { error: 'fetch_failed' };
  }
}

function camposAObjeto(doc) {
  return Object.fromEntries(doc.fields.map(f => [f.key, f.value === 'null' ? null : f.value]));
}

function diasDesdeBooleanos(o) {
  return DIAS_SEMANA_KEYS.map((k, i) => (o[k] === 'true' ? i + 1 : null)).filter(Boolean);
}

function canalesDesdeBooleanos(o) {
  const activos = CANAL_KEYS.filter(k => o[k] === 'true');
  return activos.length ? activos : null; // ninguno explícitamente true -> desconocido, no filtra en Fase 1
}

/** Común a Carrefour y Chango Más: misma forma de API, distinto account/hashes. */
async function fetchTicketBancoVTEX({ host, hashPromos, hashBanks, hashCards, operationPromos, account, isMasClubField }) {
  const ahoraISO = new Date().toISOString();
  const where = `active=true AND (active_from < '${ahoraISO}') AND (active_to > '${ahoraISO}')`;

  const [promosRes, banksRes, cardsRes] = await Promise.all([
    fetchGraphQL(host, operationPromos, hashPromos, { where, account }),
    fetchGraphQL(host, 'GetBanks', hashBanks, null),
    fetchGraphQL(host, 'GetCards', hashCards, null),
  ]);
  for (const r of [promosRes, banksRes, cardsRes]) {
    if (r.error) return { promos: [], error: r.error };
  }

  const nombrePorId = new Map();
  for (const doc of [...banksRes.documents, ...cardsRes.documents]) {
    const o = camposAObjeto(doc);
    nombrePorId.set(o.id, o.name);
  }

  const promos = [];
  for (const doc of promosRes.documents) {
    const o = camposAObjeto(doc);
    if (!o.discount_percentage) continue; // financiación (cuotas): confirmado, siempre viene null
    const descuentoPct = Number(o.discount_percentage) / 100;
    if (!(descuentoPct > 0)) continue;

    const nombreBanco = nombrePorId.get(o.idBank) || nombrePorId.get(o.idCard);
    const canonicosPosibles = nombreBanco ? resolverCanonicosDesdeNombre(nombreBanco) : [];
    if (isMasClubField && o[isMasClubField] === 'true' && !canonicosPosibles.includes('MasClub')) {
      canonicosPosibles.push('MasClub');
    }
    if (!canonicosPosibles.length) continue;

    const textoLegal = o.sub_title || o.legal || '';
    const textoParaMontos = `${o.sub_title || ''} ${o.legal || ''}`;
    promos.push({
      canonicosPosibles,
      super: host === CARREFOUR_HOST ? 'Carrefour' : 'Chango Más',
      dias: diasDesdeBooleanos(o),
      canales: canalesDesdeBooleanos(o),
      descuentoPct,
      tope: extraerTope(textoParaMontos),
      montoMinimo: extraerMontoMinimo(textoParaMontos),
      vigenciaDesde: new Date(o.active_from),
      vigenciaHasta: new Date(o.active_to),
      textoLegal,
    });
  }
  return { promos, error: null };
}

async function fetchCarrefour() {
  return fetchTicketBancoVTEX({
    host: CARREFOUR_HOST,
    hashPromos: CARREFOUR_HASH_PROMOTIONS,
    hashBanks: CARREFOUR_HASH_BANKS,
    hashCards: CARREFOUR_HASH_CARDS,
    operationPromos: 'GetPromotions',
    account: 'carrefourar',
  });
}

async function fetchChangoMas() {
  return fetchTicketBancoVTEX({
    host: CHANGOMAS_HOST,
    hashPromos: CHANGOMAS_HASH_PROMOS,
    hashBanks: CHANGOMAS_HASH_BANKS,
    hashCards: CHANGOMAS_HASH_CARDS,
    operationPromos: 'GetPromos',
    account: 'masonlineprod',
    isMasClubField: 'isMasClub',
  });
}

// ─── Fetch: Día (bloque de CMS embebido en el HTML, sin API estructurada) ─────

// A diferencia de Vea (campo `discount`) y Carrefour/Chango Más (`discount_percentage`),
// el bloque de CMS de Día NO tiene ningún campo numérico de % — solo texto legal libre
// (`terms`). Se decidió (2026-08-13) parsearlo con regex en vez de dejar Día sin cubrir,
// con una regla dura para no adivinar: si ninguno de estos patrones matchea, o si matchean
// valores de % DISTINTOS entre sí en el mismo texto (pasa con tarjetas que agrupan varios
// niveles en un solo `terms`, ej. "Sidecreer Verde/Platinum/Black" con 10/20/25% mezclados),
// la promo se descarta sin promo — mismo criterio que ya usa el proyecto para no inferir
// canal en Vea con regex (ver nota arriba, "sería adivinar").
const PATRONES_PCT_DIA = [
  /(\d+(?:[.,]\d+)?)\s*%\s*(?:\([^)]*\)\s*)?de\s+(?:reintegro|descuento|ahorro)/g,
  /bonificacion\s+del\s+(\d+(?:[.,]\d+)?)\s*%/g,
  /consiste\s+en\s+(?:un\s+)?(\d+(?:[.,]\d+)?)\s*%/g,
  /otorgar[a]\s+(?:un\s+)?(\d+(?:[.,]\d+)?)\s*%/g,
];

function extraerDescuentoPctDia(terms) {
  const t = normalizar(terms);
  const valores = new Set();
  for (const patron of PATRONES_PCT_DIA) {
    for (const m of t.matchAll(patron)) valores.add(Number(m[1].replace(',', '.')));
  }
  return valores.size === 1 ? [...valores][0] / 100 : null;
}

/** Extrae el primer objeto JSON balanceado que arranca en `texto[inicio]` (debe ser '{'). */
function extraerBloqueBalanceado(texto, inicio) {
  let profundidad = 0, dentroDeString = false, escapando = false;
  for (let i = inicio; i < texto.length; i++) {
    const c = texto[i];
    if (escapando) { escapando = false; continue; }
    if (c === '\\') { escapando = true; continue; }
    if (c === '"') { dentroDeString = !dentroDeString; continue; }
    if (dentroDeString) continue;
    if (c === '{') profundidad++;
    else if (c === '}') {
      profundidad--;
      if (profundidad === 0) return texto.slice(inicio, i + 1);
    }
  }
  return null;
}

function diasDesdeCardDia(daysToShow) {
  if (!daysToShow) return [];
  return DIAS_SEMANA_KEYS.map((k, i) => (daysToShow[k] === true ? i + 1 : null)).filter(Boolean);
}

// availableOn: {online, store} son booleanos reales (no strings como en Carrefour/Chango
// Más) — se traducen al mismo vocabulario que usa promoAplicaEnCanal ('ecommerce' para
// online; cualquier tag != 'ecommerce' vale para físico, se usa 'tienda').
function canalesDesdeCardDia(availableOn) {
  if (!availableOn) return null;
  const canales = [];
  if (availableOn.online) canales.push('ecommerce');
  if (availableOn.store) canales.push('tienda');
  return canales.length ? canales : null;
}

// extraerTope() genérico busca "reintegro/tope...$X", pero el legal de Día y Coto tiene dos
// formas concretas de hacer que eso adivine mal (confirmado en vivo, 2026-08-13):
//   1. Ejemplos ilustrativos tipo "SI REALIZA UNA COMPRA DE $30.000 RECIBIRÁ UN REINTEGRO DE
//      $3.000" — el regex genérico confunde ese monto de ejemplo con el tope real, incluso
//      cuando el mismo texto dice explícitamente "SIN TOPE DE REINTEGRO" (caso real: Cuenta
//      DNI en Día). La negación explícita es un dato más confiable que el regex, gana siempre.
//   2. Texto que describe DOS topes distintos para segmentos/carteras distintas sin decir
//      cuál aplica (caso real: promo de Comafi en Coto, "cartera general tope $13.000, para
//      Segmento Único tope $18.000") — no hay forma de saber cuál corresponde sin adivinar,
//      así que se descarta en vez de elegir uno.
function extraerTopeTextoLibre(texto) {
  const t = normalizar(texto);
  if (/\bsin\s+(?:tope|limite)\b/.test(t)) return null;
  const valores = new Set();
  for (const m of t.matchAll(/(?:tope|limite)[^$]{0,40}\$\s?([\d.,]+)/g)) {
    valores.add(parseInt(m[1].replace(/\./g, '').replace(/,\d+$/, ''), 10));
  }
  return valores.size === 1 ? [...valores][0] : null;
}

async function fetchDia() {
  try {
    const res = await fetch(`${DIA_HOST}${DIA_PROMOS_PATH}`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return { promos: [], error: 'fetch_failed' };
    const html = await res.text();

    // Si esta marca desaparece, Día cambió la estructura del bloque de CMS — hay que
    // volver a inspeccionar el sitio con el navegador, igual que con un hash de GraphQL roto.
    const idxBloque = html.indexOf(DIA_BLOQUE_MARCA);
    if (idxBloque === -1) return { promos: [], error: 'hash_roto' };
    const idxProps = html.indexOf('"props":{', idxBloque);
    if (idxProps === -1) return { promos: [], error: 'hash_roto' };
    const bloque = extraerBloqueBalanceado(html, idxProps + '"props":'.length);
    if (!bloque) return { promos: [], error: 'hash_roto' };

    let cards;
    try {
      cards = JSON.parse(bloque).cards;
    } catch {
      return { promos: [], error: 'hash_roto' };
    }
    if (!Array.isArray(cards)) return { promos: [], error: 'hash_roto' };

    const promos = [];
    for (const card of cards) {
      if (card.active === false) continue;
      const descuentoPct = extraerDescuentoPctDia(card.terms || '');
      if (!(descuentoPct > 0)) continue;

      const nombresBanco = (card.associatedBanks || []).map(b => b.__editorItemTitle).filter(Boolean);
      const canonicosPosibles = [...new Set(nombresBanco.flatMap(resolverCanonicosDesdeNombre))];
      if (!canonicosPosibles.length) continue;

      promos.push({
        canonicosPosibles,
        super: 'Día',
        dias: diasDesdeCardDia(card.daysToShow),
        canales: canalesDesdeCardDia(card.availableOn),
        descuentoPct,
        tope: extraerTopeTextoLibre(card.terms || ''),
        montoMinimo: extraerMontoMinimo(card.terms || ''),
        // Día, a diferencia de Vea/Carrefour/Chango Más, no expone fechas de vigencia
        // estructuradas — solo el booleano `active` (ya filtrado arriba). Se usa un rango
        // amplio para que promosAplicablesHoy/mejoresDiasTicket no la descarten por fecha;
        // el único control de vigencia real es que `active` se vuelva a consultar en cada fetch.
        vigenciaDesde: new Date(0),
        vigenciaHasta: new Date('2099-12-31'),
        textoLegal: card.terms || '',
      });
    }
    return { promos, error: null };
  } catch {
    return { promos: [], error: 'fetch_failed' };
  }
}

// ─── Fetch: Coto (REST propio del backend ATG, sin cookie/sesión) ────────────

// A diferencia de Vea/Carrefour/Chango Más/Día, Coto no es VTEX — corre sobre un backend
// ATG (Oracle Commerce) propio. Encontrado en vivo (2026-08-13) navegando /descuentos: el
// XHR que arma esa página pega a este endpoint REST, público, sin cookie de sesión
// (confirmado con curl sin cookies, mismo tamaño de respuesta que con navegador).
// A diferencia de Día, el % SÍ viene en un campo limpio (`textoDescuento`, ej. "20% DE
// DESCUENTO") y el día también (`dias[].descripcion`) — solo el tope sigue siendo texto
// libre (`observacion`), igual que Día.
const COTO_PROMOS_URL = 'https://www.coto.com.ar/rest/model/atg/actors/cProfileActor/getPromocionesMulticanal?enviroment=ag&pushSite=CotoDigital';

// `dias[].id` de Coto es un id interno (1=domingo...7=sábado, confirmado en vivo) que NO
// coincide con la convención ISO del proyecto (1=lunes...7=domingo) — se mapea por nombre
// en vez de por id para no depender de ese esquema numérico no documentado.
const DIA_ISO_POR_NOMBRE = {
  lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6, domingo: 7,
};

function diasDesdeCoto(diasArr) {
  return (diasArr || [])
    .map(d => DIA_ISO_POR_NOMBRE[normalizar(d.descripcion)])
    .filter(Boolean);
}

// `textoDescuento` mezcla descuentos reales ("20% DE DESCUENTO") con financiación ("18
// CUOTAS SIN INTERÉS", que se ignora siempre, ver 4.1) y al menos un caso de campaña con
// typo/formato no numérico ("30 OFF PROMO VISA DÉBITO", sin "%") — exigir el patrón exacto
// "N% DE DESCUENTO" es información perdida en ese caso puntual, pero evita adivinar qué
// significa un formato que no se repite en ningún otro lado del feed.
function extraerDescuentoPctCoto(textoDescuento) {
  const m = normalizar(textoDescuento || '').match(/^(\d+(?:[.,]\d+)?)\s*%\s*de\s+descuento$/);
  return m ? Number(m[1].replace(',', '.')) / 100 : null;
}

// `p.icono` (nombre de archivo del logo, ej. "logo_comafi.png") SÍ identifica el banco de
// forma confiable en Coto, a diferencia de `p.descripcion` — confirmado en vivo el
// 2026-08-26: la mayoría de las promos de "cuotas sin interés" (y varias de descuento
// directo) tienen `descripcion` genérica ("cuotas sin interés con tarjetas de crédito Visa,
// Mastercard y American express"), sin mencionar el banco en ningún lado del texto, aunque
// el ícono sí lo identifica. Sin este mapeo, esas promos quedaban descartadas en silencio
// (`canonicosPosibles` vacío) — incluso para bancos que YA estaban en ALIAS_TARJETAS
// (Banco Macro, Galicia, BBVA, ICBC, MODO, Mercado Pago). Deliberadamente NO se mapean los
// íconos de redes de tarjeta genéricas (Visa/Mastercard/Amex/Cabal/tarjeta de crédito
// genérica) ni de programas que no son "tener una tarjeta propia" (comunidad Coto,
// ciudadanía porteña, beneficios ANSES, jubilados y pensionados) — mismo criterio que ya
// se usa para no incluir Visa/Mastercard sueltos en ALIAS_TARJETAS.
const ICONO_BANCO_COTO = {
  'logo_comafi.png':        'Comafi',
  'logo_naranjax2.png':     'Naranja X',
  'logo_credicoop.png':     'Credicoop',
  'logo_ciudad1.png':       'Banco Ciudad',
  'logo_supervielle2.png':  'Supervielle',
  'logo_columbia_1.png':    'Banco Columbia',
  'logo_patagonia2.png':    'Banco Patagonia',
  'logo_nacion_d.png':      'Banco Nación',
  'logo_tci.png':           'TCI',
  'logo_macro_bma3.png':    'Banco Macro',
  'logo_galicia.png':       'Galicia',
  'bbva2.png':               'BBVA',
  'logo_icbc_1.png':        'ICBC',
  'logo_modo.png':          'MODO',
  'logo_mercadopago.png':          'Mercado Pago',
  'logo_mercadopago_3cuotas.png':  'Mercado Pago',
  'logo_mp2cuotas.png':            'Mercado Pago',
};

async function fetchCoto() {
  try {
    const res = await fetch(COTO_PROMOS_URL, { headers: { Accept: 'application/json' } });
    if (!res.ok) return { promos: [], error: 'fetch_failed' };
    const data = await res.json();
    const raiz = data?.result;
    if (!raiz || !Array.isArray(raiz.promocionesDigitales) || !Array.isArray(raiz.promocionesSucursalesFisicas)) {
      return { promos: [], error: 'hash_roto' };
    }

    const promos = [];
    for (const p of [...raiz.promocionesDigitales, ...raiz.promocionesSucursalesFisicas]) {
      const descuentoPct = extraerDescuentoPctCoto(p.textoDescuento);
      if (!(descuentoPct > 0)) continue;

      // `descripcion` es una oración corta ("En un pago con tarjeta de crédito Mercado
      // Pago..."), no un catálogo de nombres propios como en los otros supers — más
      // parecido a lo que hacemos con el `terms` de Día que a un campo `banks[].name`. El
      // banco numérico (`p.banco`) no sirve para identificar la tarjeta: muchas promos sin
      // relación entre sí comparten `banco: 0` como bolsa genérica. `p.icono` sí identifica
      // el banco de forma confiable (ver ICONO_BANCO_COTO) — se combinan las dos fuentes
      // porque ninguna cubre todos los casos por sí sola (ej. Naranja X sale por texto,
      // Comafi solo por ícono).
      const desdeTexto = resolverCanonicosDesdeNombre(p.descripcion || '');
      const desdeIcono = ICONO_BANCO_COTO[p.icono];
      const canonicosPosibles = desdeIcono && !desdeTexto.includes(desdeIcono)
        ? [...desdeTexto, desdeIcono]
        : desdeTexto;
      if (!canonicosPosibles.length) continue;

      promos.push({
        canonicosPosibles,
        super: 'Coto',
        dias: diasDesdeCoto(p.dias),
        canales: [p.isDigital ? 'ecommerce' : 'tienda'],
        descuentoPct,
        tope: extraerTopeTextoLibre(p.observacion || ''),
        montoMinimo: extraerMontoMinimo(p.observacion || ''),
        // Coto tampoco expone fechas de vigencia estructuradas (vigenciaDesde/vigenciaHasta
        // vienen siempre null en el feed real) — mismo criterio que Día: rango amplio, la
        // vigencia real es "está en la respuesta de este fetch en vivo".
        vigenciaDesde: new Date(0),
        vigenciaHasta: new Date('2099-12-31'),
        textoLegal: p.observacion || p.descripcion || '',
      });
    }
    return { promos, error: null };
  } catch {
    return { promos: [], error: 'fetch_failed' };
  }
}

// ─── Funciones puras de cálculo (testeables sin red) ──────────────────────────

/** Filtra por día de la semana + ventana de vigencia. No filtra por canal (Fase 1, decisión confirmada). */
function promosAplicablesHoy(promosNormalizadas, { fecha = new Date() } = {}) {
  const dia = diaISO(fecha);
  return promosNormalizadas.filter(p =>
    p.dias.includes(dia) && fecha >= p.vigenciaDesde && fecha <= p.vigenciaHasta
  );
}

/** De las promos aplicables, la de mayor ahorro real sobre `subtotal` (aplicando tope y monto mínimo). */
function mejorPromoTicket(promosAplicables, subtotal) {
  let mejor = null;
  for (const promo of promosAplicables) {
    if (promo.montoMinimo != null && subtotal < promo.montoMinimo) continue;
    let descuento = subtotal * promo.descuentoPct;
    if (promo.tope != null) descuento = Math.min(descuento, promo.tope);
    if (descuento <= 0) continue;
    if (!mejor || descuento > mejor.descuento) mejor = { promo, descuento, totalConDescuento: subtotal - descuento };
  }
  return mejor;
}

// ─── Fase 2: multi-día (7 días) y canal (online/físico), por super independiente ──

/**
 * ¿Esta promo aplica en el canal dado? `canales` desconocido (null, caso de TODAS las
 * promos de Vea y las de Carrefour/Chango Más sin ningún flag en true) -> aplica en
 * ambos canales por igual (no se excluye por falta de dato, mismo criterio que Fase 1).
 */
function promoAplicaEnCanal(promo, canal) {
  if (!promo.canales) return true;
  if (canal === 'online') return promo.canales.includes('ecommerce');
  return promo.canales.some(c => c !== 'ecommerce'); // 'fisico': cualquier formato de local
}

/** true si esta promo bancaria NO se puede usar en un local físico (exige compra online). */
function promoBancariaRequiereOnline(promo) {
  return !promoAplicaEnCanal(promo, 'fisico');
}

/**
 * Repite promosAplicablesHoy + mejorPromoTicket para cada uno de los próximos `dias`
 * días (incluyendo `desde`), opcionalmente restringido a un canal. Devuelve un array
 * `[{ fecha, mejor }]` (uno por día, `mejor` puede ser null) para poder testear o
 * inspeccionar cada día por separado antes de elegir el mejor con elegirMejorDia().
 */
function mejoresDiasTicket(promosNormalizadas, subtotal, { desde = new Date(), dias = 7, canal = null } = {}) {
  const resultados = [];
  for (let i = 0; i < dias; i++) {
    const fecha = new Date(desde.getTime() + i * 86400000);
    let aplicables = promosAplicablesHoy(promosNormalizadas, { fecha });
    if (canal) aplicables = aplicables.filter(p => promoAplicaEnCanal(p, canal));
    resultados.push({ fecha, mejor: mejorPromoTicket(aplicables, subtotal) });
  }
  return resultados;
}

/** El día de mayor ahorro de una lista de mejoresDiasTicket(). null si ninguno tiene promo. */
function elegirMejorDia(diasCalculados) {
  return diasCalculados.reduce((best, dia) => {
    const ahorro = dia.mejor ? dia.mejor.descuento : 0;
    const mejorAhorro = best && best.mejor ? best.mejor.descuento : -1;
    return ahorro > mejorAhorro ? dia : best;
  }, null);
}

// ─── Orquestador ────────────────────────────────────────────────────────────────

/**
 * Igual que obtenerPromosBancarias() pero SIN filtrar por mis-tarjetas.json — esa lectura
 * es estado local de la CLI (una persona, un archivo); no tiene sentido en un backend
 * multiusuario, donde cada usuario de la app tiene sus propias tarjetas del lado del
 * cliente (ver carrito.tarjetas en app/src/carrito.tsx). Pensada para "Mis descuentos" en
 * la app (backend/src/routes/misDescuentos.js): necesita ver TODAS las promos conocidas
 * para poder mostrar, tarjeta por tarjeta, qué desbloquea — incluso de las que el usuario
 * todavía no marcó como propias.
 * @returns { vea, carr, changomas, dia, coto, jumbo, disco: {promos,error} }
 */
async function obtenerTodasLasPromosBancarias() {
  const [vea, carr, changomas, dia, coto, jumbo, disco] = await Promise.all([
    fetchVea().catch(() => ({ promos: [], error: 'fetch_failed' })),
    fetchCarrefour().catch(() => ({ promos: [], error: 'fetch_failed' })),
    fetchChangoMas().catch(() => ({ promos: [], error: 'fetch_failed' })),
    fetchDia().catch(() => ({ promos: [], error: 'fetch_failed' })),
    fetchCoto().catch(() => ({ promos: [], error: 'fetch_failed' })),
    fetchJumbo().catch(() => ({ promos: [], error: 'fetch_failed' })),
    fetchDisco().catch(() => ({ promos: [], error: 'fetch_failed' })),
  ]);
  return { vea, carr, changomas, dia, coto, jumbo, disco };
}

/**
 * Recorta el resultado de obtenerTodasLasPromosBancarias()/fetchX() a las promos que
 * aplican a `tarjetas` (nombres canónicos, ver ALIAS_TARJETAS). Nivel de módulo (no closure)
 * para que el backend HTTP pueda filtrar por las tarjetas de CADA usuario sobre un mismo
 * cache crudo, sin tener que volver a pedir nada en vivo — ver promosBancariasCache.js.
 * @returns mismas keys que `datosPorSuper` (hoy: vea, carr, changomas, dia, coto, jumbo, disco), cada una {promos,error}
 */
function filtrarPromosBancariasPorTarjetas(datosPorSuper, tarjetas) {
  const filtrarPorTarjetasPropias = resultado => {
    if (resultado.error) return resultado;
    const promos = resultado.promos
      .filter(p => p.canonicosPosibles.some(c => tarjetas.includes(c)))
      .map(p => ({ ...p, bancoCanonico: p.canonicosPosibles.find(c => tarjetas.includes(c)) }));
    return { promos, error: null };
  };
  // Genérico sobre las keys que trae datosPorSuper (en vez de listarlas a mano) para que un
  // super nuevo no se quede afuera en silencio si se agrega a obtenerTodasLasPromosBancarias()
  // pero se olvida acá — ya pasó una vez con Jumbo/Disco (2026-08-21).
  return Object.fromEntries(
    Object.entries(datosPorSuper).map(([key, resultado]) => [key, filtrarPorTarjetasPropias(resultado)])
  );
}

/**
 * Trae y normaliza las promos bancarias de los supers cubiertos, ya filtradas por las
 * tarjetas propias del usuario (mis-tarjetas.json). No filtra por día ni canal (eso es
 * promosAplicablesHoy, que se llama al momento de mostrar, no acá).
 * @returns { vea, carr, changomas, dia, coto: {promos,error} }
 */
async function obtenerPromosBancarias() {
  const misTarjetas = leerMisTarjetas();
  const datosPorSuper = await obtenerTodasLasPromosBancarias();
  return filtrarPromosBancariasPorTarjetas(datosPorSuper, misTarjetas);
}

// ─── Display ──────────────────────────────────────────────────────────────────

/** Común a las dos secciones de abajo: imprime el aviso de error si corresponde. @returns true si imprimió (el caller debe hacer continue). */
function imprimirAvisoErrorSiCorresponde(s, datos) {
  if (datos.error === 'hash_roto') {
    console.log(`  ⚠️  ${s.nombre}: la consulta de promos bancarias dejó de funcionar (la fuente cambió de forma: hash de GraphQL o bloque de CMS desactualizado) — hay que recapturarla con el navegador`);
    return true;
  }
  if (datos.error) {
    console.log(`  ⚠️  ${s.nombre}: no se pudo consultar promos bancarias (error de red)`);
    return true;
  }
  return false;
}

/**
 * Imprime la sección de promos bancarias al final del comparativo (individual o lista).
 * `supermercados` es el array SUPERMERCADOS ya existente en buscar-promos.js (key/nombre/tag),
 * pasado desde afuera para no duplicarlo ni acoplar este módulo a ese archivo.
 * `subtotalesPorSuper` es { vea: number, carr: number, changomas: number } — en modo individual
 * es el total de ese único producto en cada super; en modo lista, el total del carrito.
 */
function imprimirSeccionBancaria(supermercados, datosPorSuper, subtotalesPorSuper, fecha = new Date()) {
  console.log('\n' + '='.repeat(60));
  console.log('💳 PROMOS BANCARIAS DE HOY (con tus tarjetas):\n');

  for (const s of supermercados) {
    const datos = datosPorSuper[s.key];
    const subtotal = subtotalesPorSuper[s.key];
    if (!datos || subtotal == null) continue;
    if (imprimirAvisoErrorSiCorresponde(s, datos)) continue;

    const aplicables = promosAplicablesHoy(datos.promos, { fecha });
    const mejor = mejorPromoTicket(aplicables, subtotal);
    if (!mejor) {
      console.log(`  ${s.tag} ${s.nombre}: sin promo bancaria aplicable hoy`);
      continue;
    }

    const { promo, descuento } = mejor;
    const canalTxt = promo.canales ? `, canal: ${promo.canales.join('/')}` : '';
    console.log(`  ${s.tag} ${s.nombre}: -$${fmt(descuento)} pagando con ${promo.bancoCanonico} (${Math.round(promo.descuentoPct * 100)}% de descuento${canalTxt})`);
    if (promo.textoLegal) {
      const extracto = promo.textoLegal.length > 160 ? promo.textoLegal.slice(0, 160) + '…' : promo.textoLegal;
      console.log(`       "${extracto}"`);
    }
  }
  console.log();
}

const NOMBRES_DIA = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

function formatearFecha(fecha, hoy) {
  const nombre = NOMBRES_DIA[diaISO(fecha) - 1];
  const corta = `${String(fecha.getDate()).padStart(2, '0')}/${String(fecha.getMonth() + 1).padStart(2, '0')}`;
  const esHoy = fecha.toDateString() === hoy.toDateString();
  return `${esHoy ? 'hoy ' : ''}${nombre} ${corta}`;
}

function describirMejorDia(dia, hoy) {
  if (!dia || !dia.mejor) return 'sin promo bancaria aplicable en los próximos 7 días';
  const { promo, descuento } = dia.mejor;
  return `${formatearFecha(dia.fecha, hoy)} con ${promo.bancoCanonico} (${Math.round(promo.descuentoPct * 100)}% de descuento) → ahorrás $${fmt(descuento)}`;
}

/**
 * Fase 2 (4.3 + 4.4): para cada super, de forma independiente, cuál es el mejor día de
 * los próximos 7 (incluyendo hoy) para cada canal (online / en el local), sobre el
 * subtotal ya fijo de ese super. No busca alinear el mismo día entre supers ni
 * recalcula qué producto va a cada super — eso ya está decidido (ver 4.3).
 *
 * `canalForzadoPorSuper` (opcional): { [key]: 'online' } cuando ALGÚN ítem ya asignado a
 * ese super tiene una promo de producto exclusiva online (🌐) — en ese caso ir al local
 * haría perder ese descuento (que casi siempre es mayor que la promo bancaria), así que
 * no tiene sentido comparar contra "en el local" como si fuera una alternativa real.
 */
function imprimirMejorDiaPorSuper(supermercados, datosPorSuper, subtotalesPorSuper, hoy = new Date(), canalForzadoPorSuper = {}) {
  console.log('\n' + '='.repeat(60));
  console.log('📅 MEJOR DÍA PARA COMPRAR (próximos 7 días, con tus tarjetas):\n');

  for (const s of supermercados) {
    const datos = datosPorSuper[s.key];
    const subtotal = subtotalesPorSuper[s.key];
    if (!datos || subtotal == null) continue;
    console.log(`  ${s.tag} ${s.nombre}:`);
    if (imprimirAvisoErrorSiCorresponde(s, datos)) { console.log(); continue; }

    if (canalForzadoPorSuper[s.key] === 'online') {
      console.log('       🌐 Algún ítem de esta compra tiene descuento exclusivo online — no se evalúa comprar en el local.');
      const mejorOnline = elegirMejorDia(mejoresDiasTicket(datos.promos, subtotal, { desde: hoy, canal: 'online' }));
      console.log(`       🌐 Online: ${describirMejorDia(mejorOnline, hoy)}`);
      console.log();
      continue;
    }

    const mejorOnline = elegirMejorDia(mejoresDiasTicket(datos.promos, subtotal, { desde: hoy, canal: 'online' }));
    const mejorFisico  = elegirMejorDia(mejoresDiasTicket(datos.promos, subtotal, { desde: hoy, canal: 'fisico' }));
    console.log(`       🌐 Online:      ${describirMejorDia(mejorOnline, hoy)}`);
    console.log(`       🏬 En el local: ${describirMejorDia(mejorFisico, hoy)}`);

    const ahorroOnline = mejorOnline?.mejor?.descuento || 0;
    const ahorroFisico = mejorFisico?.mejor?.descuento || 0;
    if (Math.abs(ahorroOnline - ahorroFisico) > 0.01) {
      console.log(`       → conviene más ${ahorroOnline > ahorroFisico ? 'online' : 'en el local'}`);
    }
    console.log();
  }
}

// ─── Síntesis final: un solo total combinando promo por producto + mejor tarjeta/día ──

/**
 * La mejor oportunidad bancaria posible para `subtotal`, sea online o físico (el que dé
 * más ahorro). A diferencia de imprimirMejorDiaPorSuper (que muestra las dos alternativas
 * por separado a propósito, 4.4), esto es para el total combinado: ahí no importan las
 * dos alternativas, solo la mejor.
 *
 * `canalForzado`: si se pasa 'online', ni se evalúa 'fisico' — se usa cuando algún ítem
 * de esta compra ya tiene una promo de producto exclusiva online, así que ir al local no
 * es una alternativa real (perdés ese descuento, casi siempre mayor que el bancario).
 */
function mejorOportunidadTicket(promosNormalizadas, subtotal, { desde = new Date(), dias = 7, canalForzado = null } = {}) {
  const online = elegirMejorDia(mejoresDiasTicket(promosNormalizadas, subtotal, { desde, dias, canal: 'online' }));
  if (canalForzado === 'online') return online?.mejor ? { ...online, canal: 'online' } : null;

  const fisico = elegirMejorDia(mejoresDiasTicket(promosNormalizadas, subtotal, { desde, dias, canal: 'fisico' }));
  const ahorroOnline = online?.mejor?.descuento || 0;
  const ahorroFisico = fisico?.mejor?.descuento || 0;
  if (ahorroOnline === 0 && ahorroFisico === 0) return null;
  return ahorroOnline >= ahorroFisico ? { ...online, canal: 'online' } : { ...fisico, canal: 'fisico' };
}

/**
 * Combina, por super, el subtotal YA fijado por las promos por producto (`subtotalPorSuper`
 * — en modo lista, solo lo que se le asignó a ese super en el plan mixto, NUNCA el
 * hipotético "todo ahí"; en modo individual, el precio de ese único ítem) con la mejor
 * oportunidad bancaria de los próximos 7 días. No suma ni elige entre supers — eso lo
 * decide el caller según el modo (lista: se suman todos, porque comprás en los 3 a la vez;
 * individual: se elige el mínimo, porque un solo ítem se compra en un solo lugar).
 *
 * `canalForzadoPorSuper`: ver nota de mejorOportunidadTicket.
 */
function calcularPlanFinal(supermercados, datosPorSuper, subtotalPorSuper, canalForzadoPorSuper = {}, hoy = new Date()) {
  const porSuper = [];
  for (const s of supermercados) {
    const subtotal = subtotalPorSuper[s.key];
    if (!subtotal) continue;
    const datos = datosPorSuper[s.key];
    const errorBanco = datos?.error || null;
    const canalForzado = canalForzadoPorSuper[s.key] || null;
    const oportunidad = (datos && !errorBanco) ? mejorOportunidadTicket(datos.promos, subtotal, { desde: hoy, canalForzado }) : null;
    const ahorro = oportunidad ? oportunidad.mejor.descuento : 0;
    porSuper.push({ ...s, subtotal, oportunidad, ahorro, totalConBanco: subtotal - ahorro, errorBanco, canalForzado });
  }
  return porSuper;
}

function describirOportunidad(p, hoy) {
  if (p.errorBanco === 'hash_roto') return '⚠️  promo bancaria no disponible (la fuente cambió de forma: hash de GraphQL o bloque de CMS desactualizado)';
  if (p.errorBanco) return '⚠️  no se pudo consultar la promo bancaria (error de red)';
  if (!p.oportunidad) return 'sin promo bancaria aplicable en los próximos 7 días';
  const { fecha, mejor, canal } = p.oportunidad;
  const canalTxt = canal === 'online' ? 'online' : 'en el local';
  return `pagando con ${mejor.promo.bancoCanonico} ${canalTxt} el ${formatearFecha(fecha, hoy)} (${Math.round(mejor.promo.descuentoPct * 100)}%) → -$${fmt(mejor.descuento)}`;
}

/** Modo individual: un solo ítem se compra en un solo lugar — se muestran los 3 supers como alternativas y se recomienda el más barato, no se suman. */
function imprimirPlanFinalIndividual(porSuper, hoy = new Date()) {
  if (porSuper.length < 2) return; // sin alternativa real para comparar
  console.log('\n' + '='.repeat(60));
  console.log('🧾 PLAN FINAL (mejor combinación de super + tarjeta + día):\n');

  const medallas = ['🥇', '🥈', '🥉'];
  [...porSuper].sort((a, b) => a.totalConBanco - b.totalConBanco).forEach((p, i) => {
    console.log(`  ${medallas[i] || '  '} ${p.nombre}: $${fmt(p.totalConBanco)}  (ítem $${fmt(p.subtotal)}, ${describirOportunidad(p, hoy)})`);
  });
  console.log();
}

// ─── Re-optimización ítem→super según el día (modo lista) ────────────────────
//
// El ahorro bancario tiene tope (cap en $) → no crece indefinidamente al sumar más
// productos a un super → la decisión de qué producto va a cada super NO se puede
// resolver producto por producto de forma aislada (depende de cuánto ya se acumuló
// ahí). Es un problema de asignación con costo cóncavo por super, en general
// NP-difícil de resolver exacto. Se resuelve con una heurística iterativa: reasignar
// cada ítem al super de menor "precio efectivo" (precio × (1-%), SIN aplicar el tope
// en este paso — aproximación deliberada) y repetir hasta que se estabilice. El tope
// sí se aplica correctamente al calcular el total REAL de la asignación resultante.
// Red de seguridad: si el resultado no mejora sobre no reasignar nada, se descarta y
// se usa la asignación de hoy — nunca puede recomendar algo peor que lo ya existente.

/** superKey más barata para `item` dado el % de descuento vigente en cada super (sin tope). */
function elegirSuperMasBarato(item, oportunidadesPorSuper = {}) {
  let mejor = null;
  for (const [superKey, precio] of Object.entries(item.preciosPorSuper)) {
    if (precio == null) continue;
    const pct = oportunidadesPorSuper[superKey]?.mejor?.promo?.descuentoPct || 0;
    const efectivo = precio * (1 - pct);
    if (!mejor || efectivo < mejor.efectivo) mejor = { superKey, efectivo };
  }
  return mejor ? mejor.superKey : null;
}

function calcularSubtotalesDesdeAsignacion(items, asignacion, supermercados) {
  const subtotales = Object.fromEntries(supermercados.map(s => [s.key, 0]));
  items.forEach((item, i) => {
    const superKey = asignacion[i];
    if (superKey) subtotales[superKey] += item.preciosPorSuper[superKey];
  });
  return subtotales;
}

/** true si ALGÚN ítem asignado a ese super (en esta asignación) exige canal online. */
function calcularCanalForzadoDesdeAsignacion(items, asignacion, supermercados) {
  const forzado = Object.fromEntries(supermercados.map(s => [s.key, null]));
  items.forEach((item, i) => {
    const superKey = asignacion[i];
    if (superKey && item.esOnlineExclusivoPorSuper[superKey]) forzado[superKey] = 'online';
  });
  return forzado;
}

function mismaAsignacion(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * items: [{ id, preciosPorSuper: {vea,carr,changomas} (null si no está ahí),
 *           esOnlineExclusivoPorSuper: {...} }]
 * Devuelve { asignacion, subtotales, canalForzado, oportunidades, erroresPorSuper,
 *            total, totalSinReasignar, mejoro }.
 */
function reoptimizarAsignacion(items, datosPorSuper, supermercados, { hoy = new Date(), maxIteraciones = 4 } = {}) {
  const superKeys = supermercados.map(s => s.key);

  function calcularResultado(asignacion) {
    const subtotales = calcularSubtotalesDesdeAsignacion(items, asignacion, supermercados);
    const canalForzado = calcularCanalForzadoDesdeAsignacion(items, asignacion, supermercados);
    const oportunidades = {};
    const erroresPorSuper = {};
    let total = 0;
    for (const key of superKeys) {
      const subtotal = subtotales[key];
      const datos = datosPorSuper[key];
      erroresPorSuper[key] = datos?.error || null;
      const oportunidad = (subtotal && datos && !datos.error)
        ? mejorOportunidadTicket(datos.promos, subtotal, { desde: hoy, canalForzado: canalForzado[key] })
        : null;
      oportunidades[key] = oportunidad;
      total += subtotal - (oportunidad ? oportunidad.mejor.descuento : 0);
    }
    return { subtotales, canalForzado, oportunidades, erroresPorSuper, total };
  }

  const asignacionHoy = items.map(item => elegirSuperMasBarato(item, {}));
  const resultadoHoy = calcularResultado(asignacionHoy);

  let asignacion = asignacionHoy;
  for (let i = 0; i < maxIteraciones; i++) {
    const { oportunidades } = calcularResultado(asignacion);
    const nuevaAsignacion = items.map((item, idx) => elegirSuperMasBarato(item, oportunidades) || asignacion[idx]);
    if (mismaAsignacion(nuevaAsignacion, asignacion)) break;
    asignacion = nuevaAsignacion;
  }
  const resultadoReasignado = calcularResultado(asignacion);

  const mejoro = resultadoReasignado.total < resultadoHoy.total - 0.01; // margen para no oscilar por redondeo
  const final = mejoro ? { asignacion, ...resultadoReasignado } : { asignacion: asignacionHoy, ...resultadoHoy };

  return { ...final, mejoro, totalSinReasignar: resultadoHoy.total };
}

/**
 * Reemplaza el contenido de "🧾 PLAN FINAL" en modo lista: puede reasignar productos
 * a un super distinto del que se ve en el Resumen Final de arriba, si eso aprovecha
 * mejor una promo bancaria. `items`/`resultado` vienen de reoptimizarAsignacion().
 * `totalOptimoSinBanco` es la "Compra óptima" ya calculada por mostrarResumenFinal
 * (sin ninguna promo bancaria) — solo se usa para el desglose en cascada del pie.
 */
function imprimirPlanFinalReoptimizado(supermercados, items, resultado, totalOptimoSinBanco, hoy = new Date()) {
  if (!items.length) return;
  console.log('\n' + '='.repeat(60));
  console.log('🧾 PLAN FINAL (producto + super + la mejor tarjeta/día — puede mover productos de super para aprovechar mejor las promos bancarias):\n');

  const { asignacion, subtotales, canalForzado, oportunidades, erroresPorSuper, total, mejoro, totalSinReasignar } = resultado;

  for (const s of supermercados) {
    const subtotal = subtotales[s.key];
    if (!subtotal) continue;
    console.log(`  ${s.tag} ${s.nombre}: $${fmt(subtotal)}`);

    const asignadosAqui = items.filter((_, i) => asignacion[i] === s.key);
    const soloOnline = asignadosAqui.filter(it => it.esOnlineExclusivoPorSuper[s.key]).map(it => it.id);
    const indistinto = asignadosAqui.filter(it => !it.esOnlineExclusivoPorSuper[s.key]).map(it => it.id);
    if (soloOnline.length) console.log(`       🌐 Comprar online (descuento exclusivo web): ${soloOnline.join(', ')}`);
    if (indistinto.length) {
      const etiqueta = soloOnline.length ? '🏬 Podés comprar en el local (mismo precio)' : 'Ítems';
      console.log(`       ${etiqueta}: ${indistinto.join(', ')}`);
    }

    const datosFicticio = { oportunidad: oportunidades[s.key], errorBanco: erroresPorSuper[s.key], canalForzado: canalForzado[s.key] };
    console.log(`       ${describirOportunidad(datosFicticio, hoy)}`);
    const ahorro = oportunidades[s.key] ? oportunidades[s.key].mejor.descuento : 0;
    console.log(`       Total en ${s.nombre}: $${fmt(subtotal - ahorro)}\n`);
  }

  console.log('─'.repeat(60));
  console.log(`  Sin tarjetas ni reasignar (compra óptima de hoy): $${fmt(totalOptimoSinBanco)}`);
  console.log(`  Con tarjetas, sin mover productos de super:        $${fmt(totalSinReasignar)}   (-$${fmt(totalOptimoSinBanco - totalSinReasignar)} por tarjetas)`);
  console.log(`  🏆 Con tarjetas Y reasignando productos:            $${fmt(total)}   (-$${fmt(totalSinReasignar - total)} extra por reasignar)`);
  if (!mejoro) {
    console.log('\n  (La reasignación no encontró una mejora sobre la asignación de hoy — se mantiene igual.)');
  }
  console.log();
}

module.exports = {
  obtenerPromosBancarias,
  obtenerTodasLasPromosBancarias,
  filtrarPromosBancariasPorTarjetas,
  // Nombres canónicos de tarjeta que el resto del sistema puede reusar en vez de duplicar
  // esta lista (ya duplicada una vez en app/src/carrito.tsx como TARJETAS_DISPONIBLES).
  TARJETAS_CONOCIDAS: Object.keys(ALIAS_TARJETAS),
  promosAplicablesHoy,
  mejorPromoTicket,
  imprimirSeccionBancaria,
  // Fase 2:
  promoAplicaEnCanal,
  promoBancariaRequiereOnline,
  mejoresDiasTicket,
  elegirMejorDia,
  imprimirMejorDiaPorSuper,
  // Síntesis final:
  mejorOportunidadTicket,
  calcularPlanFinal,
  imprimirPlanFinalIndividual,
  // Re-optimización ítem→super según el día (Fase 4):
  elegirSuperMasBarato,
  reoptimizarAsignacion,
  imprimirPlanFinalReoptimizado,
  // Fase 3 (promos por producto condicionadas a tarjeta propia) reusa esto para no
  // duplicar la lectura de mis-tarjetas.json:
  leerMisTarjetas,
  // exportado para poder testear sin red:
  resolverCanonicosDesdeNombre,
};

// ─── Auto-test manual (sin red) ────────────────────────────────────────────────
// node promos-bancarias.js
if (require.main === module) {
  const hoy = new Date();
  const promosFake = [
    {
      canonicosPosibles: ['MODO'], bancoCanonico: 'MODO', super: 'Vea',
      dias: [diaISO(hoy)], canales: null, descuentoPct: 0.2, tope: 5000, montoMinimo: null,
      vigenciaDesde: new Date(hoy.getTime() - 86400000), vigenciaHasta: new Date(hoy.getTime() + 86400000),
      textoLegal: 'Promo de prueba MODO 20% tope $5000',
    },
    {
      canonicosPosibles: ['Cencopay'], bancoCanonico: 'Cencopay', super: 'Vea',
      dias: [diaISO(hoy) + 10], canales: null, descuentoPct: 0.5, tope: null, montoMinimo: null, // día que nunca matchea
      vigenciaDesde: new Date(hoy.getTime() - 86400000), vigenciaHasta: new Date(hoy.getTime() + 86400000),
      textoLegal: 'No debería aparecer (día no vigente hoy)',
    },
  ];
  const aplicables = promosAplicablesHoy(promosFake, { fecha: hoy });
  console.log('Aplicables hoy (esperado: 1):', aplicables.length);
  const mejor = mejorPromoTicket(aplicables, 20000);
  console.log('Mejor promo sobre $20000 (esperado: ahorro $4000 = tope $5000 antes de tope, tope aplica primero):', mejor);
  console.log('Alias "Banco Provincia - Cuenta DNI" (esperado: ambos):', resolverCanonicosDesdeNombre('Banco Provincia - Cuenta DNI'));
  console.log('Alias "Banco provincia de Neuquén" (esperado: [] — excluido a mano, no es la misma entidad):', resolverCanonicosDesdeNombre('Banco provincia de Neuquén'));

  // --- Fase 2: multi-día + canal ---
  const en3dias = new Date(hoy.getTime() + 3 * 86400000);
  const en5dias = new Date(hoy.getTime() + 5 * 86400000);
  const promosFase2 = [
    {
      canonicosPosibles: ['Mercado Pago'], bancoCanonico: 'Mercado Pago', super: 'Carrefour',
      dias: [diaISO(en3dias)], canales: ['ecommerce'], descuentoPct: 0.15, tope: null, montoMinimo: null,
      vigenciaDesde: new Date(hoy.getTime() - 86400000), vigenciaHasta: new Date(hoy.getTime() + 10 * 86400000),
      textoLegal: 'Solo online, en 3 días',
    },
    {
      canonicosPosibles: ['Cuenta DNI'], bancoCanonico: 'Cuenta DNI', super: 'Carrefour',
      dias: [diaISO(en5dias)], canales: ['hyper', 'market'], descuentoPct: 0.1, tope: 3000, montoMinimo: null,
      vigenciaDesde: new Date(hoy.getTime() - 86400000), vigenciaHasta: new Date(hoy.getTime() + 10 * 86400000),
      textoLegal: 'Solo en el local, en 5 días',
    },
  ];
  const mejorOnline = elegirMejorDia(mejoresDiasTicket(promosFase2, 30000, { desde: hoy, canal: 'online' }));
  console.log('Mejor día online (esperado: en 3 días, Mercado Pago):', mejorOnline.fecha.toDateString(), '|', mejorOnline.mejor?.promo.bancoCanonico);
  const mejorFisico = elegirMejorDia(mejoresDiasTicket(promosFase2, 30000, { desde: hoy, canal: 'fisico' }));
  console.log('Mejor día físico (esperado: en 5 días, Cuenta DNI):', mejorFisico.fecha.toDateString(), '|', mejorFisico.mejor?.promo.bancoCanonico);
  console.log('promoAplicaEnCanal ecommerce-only en canal fisico (esperado false):', promoAplicaEnCanal(promosFase2[0], 'fisico'));
  console.log('promoAplicaEnCanal canales=null (Vea) en online y fisico (esperado true, true):', promoAplicaEnCanal(promosFake[0], 'online'), promoAplicaEnCanal(promosFake[0], 'fisico'));

  // --- Fase 4: re-optimización ítem→super ---
  // Vea sin promo bancaria; Carrefour con 20% sin tope hoy. Por precio solo, item1 va a
  // Vea (1000<1200) y item2 a Carrefour (900<1000) — pero al considerar el 20% de
  // Carrefour, convine mover TAMBIÉN item1 ahí (1200*0.8=960 < 1000): $1720 -> $1680.
  const supersFake = [{ key: 'vea' }, { key: 'carr' }, { key: 'changomas' }];
  const promoCarr20 = {
    canonicosPosibles: ['MODO'], bancoCanonico: 'MODO', super: 'Carrefour',
    dias: [diaISO(hoy)], canales: null, descuentoPct: 0.2, tope: null, montoMinimo: null,
    vigenciaDesde: new Date(hoy.getTime() - 86400000), vigenciaHasta: new Date(hoy.getTime() + 86400000),
    textoLegal: 'Prueba: 20% sin tope',
  };
  const datosFase4 = {
    vea: { promos: [], error: null },
    carr: { promos: [promoCarr20], error: null },
    changomas: { promos: [], error: null },
  };
  const itemsFase4 = [
    { id: 'item1', preciosPorSuper: { vea: 1000, carr: 1200, changomas: null }, esOnlineExclusivoPorSuper: {} },
    { id: 'item2', preciosPorSuper: { vea: 1000, carr: 900, changomas: null }, esOnlineExclusivoPorSuper: {} },
  ];
  const resultadoFase4 = reoptimizarAsignacion(itemsFase4, datosFase4, supersFake, { hoy });
  console.log('Reasignación (esperado: ambos a carr, mejoro=true, totalSinReasignar=1720, total=1680):',
    resultadoFase4.asignacion, '| mejoro:', resultadoFase4.mejoro,
    '| sinReasignar:', resultadoFase4.totalSinReasignar, '| total:', resultadoFase4.total);
  console.log('Invariante (total <= totalSinReasignar, nunca empeora):', resultadoFase4.total <= resultadoFase4.totalSinReasignar);
}
