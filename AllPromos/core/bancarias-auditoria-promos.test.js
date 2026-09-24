/**
 * Tests de la auditoría de promos bancarias "por ticket" del 2026-09-24 (promos-bancarias.js +
 * la parte bancaria de backend/src/routes/comparar.js). Todos los textos y entradas son REALES,
 * recortados de los feeds de ese día (Cencosud bankDiscount, GraphQL de Carrefour/Chango Más,
 * getPromocionesMulticanal de Coto) — ver "Promos bancarias por ticket" en
 * .claude/docs/CONTEXTO_TECNICO.md.
 *
 * Sin red: fetch se mockea reemplazando globalThis.fetch.
 *
 * Correr con: node --test AllPromos/core/bancarias-auditoria-promos.test.js
 */

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const pb = require('../promos-bancarias');
const { partesFechaArgentina } = require('./fechaArgentina');
const { calcularResumenFinal } = require('./comparador');
const { _test: compararTest } = require('../../backend/src/routes/comparar');

const fetchOriginal = globalThis.fetch;
afterEach(() => { globalThis.fetch = fetchOriginal; });

// ─── Fixtures reales (recortadas) ─────────────────────────────────────────────
const CENCOSUD = {
  "hipotecario": {
    "banks": [
      {
        "name": "Banco Hipotecario"
      }
    ],
    "websites": [
      "discoargentina",
      "jumboargentina",
      "jumboargentinaio"
    ],
    "days": [
      "2"
    ],
    "discount": "25.00",
    "discountText": "",
    "dateStart": "1733022060",
    "dateEnd": "1790823540",
    "info": "VÁLIDO PRESENCIAL | TODOS LOS MARTES DESDE EL 01/01/2026 HASTA EL 30/09/2026 25% de descuento con tarjeta de debito– Desde App Hipotecario o App Modo. TOPES DE REINTERO: PARA TODOS LOS CLIENTES: $15.000 (POR EL CLIENTE, DURANTE EL MES).",
    "legals": "PUBLICIDAD CARTERA CONSUMO. PROMOCIÓN VÁLIDA EN LA REPÚBLICA ARGENTINA LOS MARTES EN SUCURSALES DESDE EL 01/01/2026 HASTA EL 30/09/2026, AMBOS INCLUSIVE, BENEFICIO EXCLUSIVO PAGANDO CON TARJETA DE DÉBITO VISA EMITIDA POR BANCO HIPOTECARIO SA QUE NO REGISTREN MORA, MEDIANTE LA MODALIDAD DE PAGO CON “QR” A TRAVÉS DE “MODO” DESDE APP BH O APP MODO. SE OTORGARÁ UN DESCUENTO VÍA REINTEGRO DEL 25% CON TOPE MENSUAL POR CLIENTE (CONSIDERANDO LA SUMA DE LOS CONSUMOS REALIZADOS POR EL CLIENTE DURANTE EL M"
  },
  "cencopay18": {
    "banks": [
      {
        "name": "CencoPay"
      }
    ],
    "websites": [
      "veaargentina",
      "discoargentina",
      "jumboargentinaio",
      "jumboargentina"
    ],
    "days": [
      "4"
    ],
    "discount": "18.00",
    "discountText": "CSI o 15% y 12CSI",
    "dateStart": "1738378740",
    "dateEnd": "1790823600",
    "info": "18 CSI Ó 12 CSI Y 15% EN UN PAGO EN COMPRAS REALIZADAS CON TARJETA DE CRÉDITO FÍSICA CENCOPAY. SOLO LOS DÍAS JUEVES EN LOS LOCALES HABILITADOS Y SITIOS WEB. EXCLUYE PEQUEÑOS ELECTROS Y CALEFACCIÓN.",
    "legals": "PARA MÁS INFORMACIÓN Y CONDICIONES O LIMITACIONES APLICABLES, CONSULTE EN CENCOPAY.AR PROMOCIONES VÁLIDAS PARA COMPRAS REALIZADAS LOS JUEVES DEL 01/07/2026 AL 30/09/2026 EN LA REPÚBLICA ARGENTINA CON TARJETA DE CRÉDITO FÍSICA CENCOPAY. NO ACUMULABLES CON OTRAS PROMOCIONES Y/O DESCUENTOS. ESTAS PROMOCIONES NO APLICAN PARA CLIENTES EN MORA O INHABILITADOS, TAMPOCO APLICA PARA PAG"
  },
  "modoMin": {
    "banks": [
      {
        "name": "MODO"
      }
    ],
    "websites": [
      "veaargentina"
    ],
    "days": [
      "5"
    ],
    "discount": "20.00",
    "discountText": "%",
    "dateStart": "1782874800",
    "dateEnd": "1790823600",
    "info": "Válido para pagos efectuados mediante la billetera MODO con tarjetas de débito adheridas o con tarjetas de crédito adheridas en 1 (una) cuota. El beneficio es acumulable con otras promociones vigentes que apliquen pagando con MODO. Se otorgará un reintegro conforme las condiciones de cada entidad financiera adherida, con un tope máximo de reintegro de $25.000 por banco, por usuario y por mes calendario, para compras iguales o superiores a $100.000. El tope de reintegro es único y compartido con canal de venta, por lo que las compras efectuadas por cualquier modalidad acumularán para el mismo límite máximo de beneficio mensual. Las promociones con MODO no se encuentran disponibles para compra",
    "legals": "Promoción válida en la República Argentina los días viernes, del 01/07/2026 al 30/09/2026 inclusive, para compras realizadas en comercios adheridos participantes, tanto en modalidad presencial como online. Válido para pagos efectuados mediante la billetera MODO con tarjetas de débito adheridas o con tarjetas de crédito adheridas en 1 (una) cuota. El beneficio es acumulable con otras promociones vigentes que apliquen pagando con MODO. Se otorgará un reintegro conforme las condiciones de cada entidad financiera adherida, con un tope máximo de reintegro de $25.000 por banco, por usuario y por mes calendario, para compras iguales o superiores a $100.000. La promoción aplica exclusivamente a usua"
  },
  "comodoro": {
    "banks": [
      {
        "name": "CencoPay"
      }
    ],
    "websites": [
      "jumboargentina",
      "jumboargentinaio"
    ],
    "days": [
      "2"
    ],
    "discount": "25.00",
    "discountText": "",
    "dateStart": "1767236400",
    "dateEnd": "1790823600",
    "info": "PROMOCIÓN VÁLIDA EN EL LOCAL DE JUMBO COMODORO, OBTENIENDO UN 25% DE DESCUENTO EN COMESTIBLES, BEBIDAS Y PRODUCTOS FRESCOS. NO INCLUYE ELECTRODOMÉSTICOS, RODADOS, LIBRERÍA, CARNES, LECHES, MAYORISTAS DE FIAMBRERÍA, PRODUCTOS DE MARCAS PROPIAS (C&CO, HOME CARE, FAMILY CARE, PET FUN, JUMBO Y VEA), PRODUCTOS INCLUIDOS EN LOS LISTADOS DE PRECIOS CONVENIENTES, NI BODEGAS (LA RURAL, ",
    "legals": "PARA MÁS INFORMACIÓN Y CONDICIONES O LIMITACIONES APLICABLES, CONSULTE EN CENCOPAY.AR PROMOCIONES VÁLIDAS PARA COMPRAS REALIZADAS SOLO LOS DÍAS MARTES DEL 01/01/2026 AL 30/09/2026 EN LA REPÚBLICA ARGENTINA CON TARJETA DE CRÉDITO FÍSICA CENCOPAY. NO ACUMULABLES CON OTRAS PROMOCIONES Y/O DESCUENTOS. ESTAS PROMOCIONES NO APLICAN PARA CLIENTES EN MORA O INHABILITADOS. TAMPOCO APLIC"
  },
  "patagonia40": {
    "banks": [
      {
        "name": "Banco Patagonia"
      }
    ],
    "websites": [
      "discoargentina",
      "jumboargentina",
      "jumboargentinaio"
    ],
    "days": [
      "6"
    ],
    "discount": "30.00",
    "discountText": "",
    "dateStart": "1782874800",
    "dateEnd": "1793502000",
    "info": "PROMOCIÓN VÁLIDA EN LA REPÚBLICA ARGENTINA LOS VIERNES DESDE EL 01/07/2026 AL 31/10/2026 EN LAS COMPRAS PRESENCIALES. TOPE 40.000 POR VIGENCIA DE LA PROMOCION. ",
    "legals": "CARTERA DE CONSUMO Y COMERCIAL – PROMOCIÓN VÁLIDA EN LA REPÚBLICA ARGENTINA LOS VIERNES DESDE EL 01/07/2026 AL 31/10/2026 EN LAS COMPRAS PRESENCIALES EN DISCO Y JUMBO. RECIBIRÁ UN 30% DE DESCUENTO CON LAS TARJETAS DE CRÉDITO AMERICAN EXPRESS DE BANCO PATAGONIA. TOPE 40.000 POR VIGENCIA DE LA PROMOCION. LOS REINTEGROS CORRESPONDIENTES A LAS COMPRAS EFECTUADAS CON LAS TARJETAS DE"
  },
  "cencopay40": {
    "banks": [
      {
        "name": "CencoPay Cuenta"
      }
    ],
    "websites": [
      "jumboargentina",
      "veaargentina",
      "discoargentina",
      "jumboargentinaio"
    ],
    "days": [
      "5",
      "6"
    ],
    "discount": "40.00",
    "discountText": "%",
    "dateStart": "1785553200",
    "dateEnd": "1790823600",
    "info": "TOPE DE REINTEGRO $15.000 (QUINCE MIL PESOS ARGENTINOS) POR DÍA. NO INCLUYE ELECTRODOMÉSTICOS. EXCLUSIVO PARA VENTAS PRESENCIALES. EL DESCUENTO SE EFECTIVIZARÁ EN EL CHECK OUT O LÍNEA DE CAJAS. ESTA PROMOCIÓN NO APLICA PARA COMPRAS REALIZADAS EN LOS LOCALES \"VEA EXPRESS Y DISCO EXPRESS\".",
    "legals": "PARA MÁS INFORMACIÓN Y CONDICIONES O LIMITACIONES APLICABLES, CONSULTE EN CENCOPAY.AR PROMOCIONES VÁLIDAS PARA COMPRAS REALIZADAS LOS VIERNES, SÁBADOS Y DOMINGOS DESDE EL 01/08/2026 AL 30/09/2026 EN LOS LOCALES HABILITADOS, OBTENIENDO UN 40% DE DESCUENTO EN GALLETITAS, CERVEZAS, CHOCOLATE Y GOLOSINAS, CONSERVAS DE VERDURAS, LEGUMBRES Y FRUTAS. TOPE DE REINTEGRO $15.000 (QUINCE MIL PESOS ARGENTINOS) POR DÍA. NO INCLUYE ELECTRODOMÉSTICOS. EXCLUSIVO PARA VENTAS PRESENCIALES. EL DESCUENTO SE EFECTIVIZARÁ EN EL CHECK OUT O LÍNEA DE CAJAS. ESTA PROMOCIÓN NO APLICA PARA COMPRAS REALIZADAS EN LOS LOCA"
  }
};
const VTEX = {
  "carr": {
    "promos": [
      {
        "id": "110bec67-2e8a-4e40-84ca-3302e0e42ff8",
        "title": "20% de descuento en un pago con tarjeta de crédito de Carrefour Banco",
        "sub_title": "Tope de devolución $10.000",
        "legal": "DESCUENTO EXCLUSIVO ABONANDO CON TARJETA DE CRÉDITO MASTERCARD DE CARREFOUR BANCO. VÁLIDO TODOS LOS JUEVES DE SEPTIEMBRE 2026 PARA LAS COMPRAS ONLINE EN CARREFOUR.COM.AR Y EN LA APP DE CARREFOUR. APLICABLE TANTO A COMPRAS CON ENTREGA INMEDIATA COMO A COMPRAS CON ENTREGA PROGRAMADA. NO VÁLIDO EN LAS ",
        "discount_percentage": "20",
        "idBank": "null",
        "idCard": "9217c372-7dad-11eb-82ac-0e9340244943",
        "monday": "false",
        "tuesday": "false",
        "wednesday": "false",
        "thursday": "true",
        "friday": "false",
        "saturday": "false",
        "sunday": "false",
        "hyper": "false",
        "market": "false",
        "ecommerce": "true",
        "express": "false",
        "maxi": "false",
        "active_from": "2026-09-01T00:00:00+00:00",
        "active_to": "2026-10-01T00:00:00+00:00"
      },
      {
        "id": "23af46b4-aad8-4ab6-9716-29bda4307a1b",
        "title": "10% Ahorro en tu compra con Mercado Pago. Sin tope! Exclusivo con dinero en cuenta",
        "sub_title": "VALIDO EXCLUSIVAMENTE PARA SUCURSALES FISICAS. PROMOCIÓN NO ACUMULABLE CON OTRAS PROMOCIONES Y/O FOLLETOS VIGENTES. NO INCLUYE CARNICERÍA, HUEVOS DE GALLINA, ELECTROS, BAZAR, TEXTIL, OFERTÓN POR BULTO, PACK FAMILIAR NI PRECIO SÚPER BAJO TODOS LOS DÍAS.",
        "legal": "BENEFICIO VÁLIDO EXCLUSIVAMENTE EN LA REPÚBLICA ARGENTINA, HASTA EL 30/09/2026. PARA PAGOS REALIZADOS A TRAVÉS DEL SERVICIO DE PROCESAMIENTO DE PAGOS DE MERCADO PAGO OPERADO POR MERCADOLIBRE S.R.L. “MERCADO PAGO” A TRAVÉS DEL ESCANEO DEL CÓDIGO QR CON LA APP DE MERCADO PAGO LA “APP”, ELIGIENDO COMO ",
        "discount_percentage": "10",
        "idBank": "b16eed64-2df2-11ec-82ac-12aeae09a3ef",
        "idCard": "null",
        "monday": "false",
        "tuesday": "false",
        "wednesday": "false",
        "thursday": "false",
        "friday": "true",
        "saturday": "false",
        "sunday": "false",
        "hyper": "false",
        "market": "false",
        "ecommerce": "false",
        "express": "false",
        "maxi": "true",
        "active_from": "2026-09-01T00:00:00+00:00",
        "active_to": "2026-10-01T00:00:00+00:00"
      },
      {
        "id": "0c2f0d65-47c0-4a7a-9a3d-def6ed32ecbe",
        "title": "15% de descuento con Club La Nación. ¡Sin Tope!",
        "sub_title": "No incluye electro ni carnicería",
        "legal": "PROMOCIÓN VÁLIDA TODOS LOS LUNES HASTA EL 30/09/2026, PRESENTANDO DNI DEL TITULAR DE CLUB LA NACIÓN EN LÍNEA DE CAJAS. VÁLIDO EN TIENDAS “HIPERMERCADOS CARREFOUR”, “CARREFOUR MARKET” Y “CARREFOUR EXPRESS” DE TODO EL PAÍS Y EN CARREFOUR.COM.AR. NO VÁLIDO EN CARREFOUR MAXI. EL DESCUENTO SE HARÁ EFECTI",
        "discount_percentage": "15",
        "idBank": "6ff8cef9-c027-4f5f-bce6-dedf36c6a3be",
        "idCard": "null",
        "monday": "true",
        "tuesday": "false",
        "wednesday": "false",
        "thursday": "false",
        "friday": "false",
        "saturday": "false",
        "sunday": "false",
        "hyper": "true",
        "market": "true",
        "ecommerce": "true",
        "express": "true",
        "maxi": "false",
        "active_from": "2026-09-01T00:00:00+00:00",
        "active_to": "2026-10-01T00:00:00+00:00"
      },
      {
        "id": "35d30d5f-567a-11f0-b37f-c2cb70a90ede",
        "title": "10% de descuento en tu compra con Cuenta DNI ¡Sin Tope!. Y si sos jubilado, tenes 5% de descuento adicional.",
        "sub_title": "Mínimo de compra $15.000. Promoción acumulable. Si sos jubilado tope de $5.000. Ver exclusiones en el legal",
        "legal": "PROMOCIÓN VÁLIDA TODOS LOS MIÉRCOLES HASTA EL 30/09/2026 INCLUSIVE. PARA COMPRAS REALIZADAS A TRAVÉS DE LA FUNCIONALIDAD \"PAGO CLAVE DNI\" Y/O QR DE LA APLICACIÓN CUENTA DNI EN TODAS LAS TIENDAS HIPERMERCADOS CARREFOUR, CARREFOUR MARKET Y CARREFOUR EXPRESS. LA NÓMINA DE ADHERIDOS SE PODRÁ CONSULTAR E",
        "discount_percentage": "10",
        "idBank": "8153eb03-198c-4e73-b5a1-07ac54c4e42e",
        "idCard": "null",
        "monday": "false",
        "tuesday": "false",
        "wednesday": "true",
        "thursday": "false",
        "friday": "false",
        "saturday": "false",
        "sunday": "false",
        "hyper": "true",
        "market": "true",
        "ecommerce": "false",
        "express": "true",
        "maxi": "false",
        "active_from": "2025-09-01T00:00:00+00:00",
        "active_to": "2026-10-01T00:00:00+00:00"
      },
      {
        "id": "804da576-8555-478d-b33b-b82663eab002",
        "title": "10% de descuento en tu compra con Cuenta DNI ¡Sin Tope!. Y si sos jubilado, tenes 5% de descuento adicional.",
        "sub_title": "No acumulable con otras promociones y/o folletos vigentes. Ver exclusiones en el legal.",
        "legal": "PROMOCIÓN VÁLIDA TODOS LOS MIÉRCOLES HASTA EL 30/09/2026 INCLUSIVE. PARA COMPRAS REALIZADAS A TRAVÉS DE LA FUNCIONALIDAD \"PAGO CLAVE DNI\" Y/O QR DE LA APLICACIÓN CUENTA DNI EN TODAS LAS TIENDAS CARREFOUR MAXI. LA NÓMINA DE ADHERIDOS SE PODRÁ CONSULTAR EN WWW.BANCOPROVINCIA.COM.AR. BONIFICACIÓN DEL 1",
        "discount_percentage": "10",
        "idBank": "8153eb03-198c-4e73-b5a1-07ac54c4e42e",
        "idCard": "null",
        "monday": "false",
        "tuesday": "false",
        "wednesday": "true",
        "thursday": "false",
        "friday": "false",
        "saturday": "false",
        "sunday": "false",
        "hyper": "false",
        "market": "false",
        "ecommerce": "false",
        "express": "false",
        "maxi": "true",
        "active_from": "2026-09-01T00:00:00+00:00",
        "active_to": "2026-10-01T00:00:00+00:00"
      }
    ],
    "bancos": [
      {
        "id": "9217c372-7dad-11eb-82ac-0e9340244943",
        "name": "Tarjeta_Standard_Master_Carrefour"
      },
      {
        "id": "b16eed64-2df2-11ec-82ac-12aeae09a3ef",
        "name": "Mercado Pago"
      },
      {
        "id": "6ff8cef9-c027-4f5f-bce6-dedf36c6a3be",
        "name": "Club La Nación"
      },
      {
        "id": "8153eb03-198c-4e73-b5a1-07ac54c4e42e",
        "name": "Cuenta Dni"
      }
    ]
  },
  "cm": {
    "promos": [
      {
        "id": "248970a3-8b2a-11ef-b37f-e25d0cbe8412",
        "title": "Presencial y online ¡SIN TOPE!",
        "sub_title": "Promoción exclusiva para socios de masclub. No acumulable con otras promociones. Consulta detalles y legales en Masclub.com.ar (MC)*",
        "legal": "Promoción exclusiva para todos los socios de MâsClub. Válida del 01/04/2026 al 31/12/2026 únicamente para compras realizadas los días Miércoles y Jueves. No acumulable con otras promociones. Sin tope de descuento. Exclusivo para consumidores finales. EXCLUIDOS-NO INCLUYE: CARNICERIA, GRANJA, Elabora",
        "discount_percentage": "15",
        "idBank": "8fab960f-8b29-11ef-b37f-98380ffd16cd",
        "idCard": "null",
        "monday": "false",
        "tuesday": "false",
        "wednesday": "true",
        "thursday": "true",
        "friday": "false",
        "saturday": "false",
        "sunday": "false",
        "hyper": "null",
        "market": "false",
        "ecommerce": "false",
        "express": "true",
        "maxi": "null",
        "isMasClub": "true",
        "active_from": "2025-12-25T00:00:00+00:00",
        "active_to": "2026-12-31T00:00:00+00:00"
      },
      {
        "id": "30730e09-4eae-4d96-a0c4-2c77aea0109e",
        "title": "Desde APP MODO o APP de bancos aheridos",
        "sub_title": "Pagando con tarjetas de crédito y/o débito. No aplica para pagos con transferencia (PCT)  Tope: $25.000 mensual por banco. Mínimo de compra: $75.000. (MD-29)*",
        "legal": "PROMOCIÓN VÁLIDA EN LA REPÚBLICA ARGENTINA EL DIA MARTES 29 DE SEPTIEMBRE DE 2026. EXCLUSIVO PARA COMPRAS REALIZADAS TANTO EN CANAL PRESENCIAL COMO ONLINE, ABONADAS A TRAVÉS DE MODO CON TARJETAS EMITIDAS POR BANCOS ADHERIDOS. BENEFICIO: 20% DE REINTEGRO PARA COMPRAS IGUALES O SUPERIORES A $75.000, C",
        "discount_percentage": "20",
        "idBank": "6bbbedf1-ab40-11ee-8452-127334bd7427",
        "idCard": "null",
        "monday": "true",
        "tuesday": "false",
        "wednesday": "false",
        "thursday": "false",
        "friday": "false",
        "saturday": "false",
        "sunday": "false",
        "hyper": "null",
        "market": "false",
        "ecommerce": "false",
        "express": "true",
        "maxi": "null",
        "isMasClub": "false",
        "active_from": "2026-09-08T00:00:00+00:00",
        "active_to": "2026-09-30T00:00:00+00:00"
      },
      {
        "id": "9d8a5923-8bc8-460d-8ec8-ac6fdef55f7b",
        "title": "Plan Turbo - Con Crédito NaranjaX o débito Visa",
        "sub_title": "Tope: $9.500 semanal. (NX2)",
        "legal": "Promoción válida los días martes de mes de Septiembre 2026, o hasta agotar un stock total de 80.000 reintegros, lo que ocurra primero. El beneficio consiste en un reintegro (cashback) para las compras realizadas con Tarjeta de Crédito NaranjaX y Tarjeta de Débito Visa NaranjaX en todos los comercios",
        "discount_percentage": "25",
        "idBank": "9a9c3703-2fe8-11ee-83ab-0ecaeb3d03b5",
        "idCard": "null",
        "monday": "false",
        "tuesday": "true",
        "wednesday": "false",
        "thursday": "false",
        "friday": "false",
        "saturday": "false",
        "sunday": "false",
        "hyper": "null",
        "market": "false",
        "ecommerce": "false",
        "express": "true",
        "maxi": "null",
        "isMasClub": "false",
        "active_from": "2025-10-01T00:00:00+00:00",
        "active_to": "2026-10-01T00:00:00+00:00"
      },
      {
        "id": "40dae831-a44b-4a23-b175-3e248fffe947",
        "title": "Con tarjetas de crédito y débito",
        "sub_title": "Tope: $10.000 semanal. (IC3)*",
        "legal": "CARTERA DE CONSUMO. PROMOCIÓN VÁLIDA EN LA REPÚBLICA ARGENTINA PARA LOS DÍAS JUEVES DESDE EL 01/07/2026 HASTA EL 31/12/2026 (1) 20% DE AHORRO CON TARJETAS DE CRÉDITO VISA Y MASTERCARD ICBC EN UN SOLO PAGO Y TARJETAS ICBC VISA DÉBITO. PAGANDO A TRAVÉS MODO O SU INTEGRACIÓN EN ICBC MOBILE BANKING, CON",
        "discount_percentage": "20",
        "idBank": "06fc4208-78d8-11ee-83ab-0a1649dfa6b1",
        "idCard": "null",
        "monday": "false",
        "tuesday": "false",
        "wednesday": "false",
        "thursday": "true",
        "friday": "false",
        "saturday": "false",
        "sunday": "false",
        "hyper": "null",
        "market": "false",
        "ecommerce": "false",
        "express": "true",
        "maxi": "null",
        "isMasClub": "false",
        "active_from": "2026-01-01T00:00:00+00:00",
        "active_to": "2026-10-01T00:00:00+00:00"
      },
      {
        "id": "bec58c33-1a9c-4a38-8197-845c2f33deb5",
        "title": "Débito Visa Y Crédito Visa y MasterCard",
        "sub_title": "Tope: $12.000 semanal para Comafi Ahorro, Global, y/o Classic, Premium y/o Platinum.                   Tope: $15.000 semanal para Comafi Unico Black. (CMF)",
        "legal": "LEGAL SEGMENTO: AHORRO, GLOBAL Y CLASSIC | PREMIUM Y PLATINUM. CARTERA DE CONSUMO. PROMOCIÓN VÁLIDA LOS MARTES DESDE EL 01/08/26 HASTA EL 31/10/26 ABONANDO CON TARJETAS DE CRÉDITO VISA Y MASTERCARD, VISA DÉBITO EMITIDAS POR BANCO COMAFI PERTENECIENTES A TITULARES DE SERVICIOS DE CUENTA COMAFI AHORRO",
        "discount_percentage": "20",
        "idBank": "a234c39c-7f5a-11ef-b37f-f2e65af65faa",
        "idCard": "null",
        "monday": "false",
        "tuesday": "true",
        "wednesday": "false",
        "thursday": "false",
        "friday": "false",
        "saturday": "false",
        "sunday": "false",
        "hyper": "null",
        "market": "false",
        "ecommerce": "false",
        "express": "true",
        "maxi": "null",
        "isMasClub": "false",
        "active_from": "2026-02-01T00:00:00+00:00",
        "active_to": "2026-10-01T00:00:00+00:00"
      }
    ],
    "bancos": [
      {
        "id": "8fab960f-8b29-11ef-b37f-98380ffd16cd",
        "name": "MasClub"
      },
      {
        "id": "6bbbedf1-ab40-11ee-8452-127334bd7427",
        "name": "Modo"
      },
      {
        "id": "9a9c3703-2fe8-11ee-83ab-0ecaeb3d03b5",
        "name": "NaranjaX"
      },
      {
        "id": "06fc4208-78d8-11ee-83ab-0a1649dfa6b1",
        "name": "ICBC Modo"
      },
      {
        "id": "a234c39c-7f5a-11ef-b37f-f2e65af65faa",
        "name": "Banco_Comafi_MODO"
      }
    ]
  }
};
const COTO = {
  "promocionesDigitales": [
    {
      "descripcion": "En un pago con tarjetas crédito y débito Visa",
      "icono": "logo_comafi.png",
      "textoDescuento": "30% DE DESCUENTO",
      "dias": [
        {
          "descripcion": "Martes"
        }
      ],
      "isDigital": true,
      "observacion": "Cartera general con tope de reintegro $ 15.000 por transacción, para Segmento Unico tope de reintegro $ 25.000 por transacción. Aplican exclusiones. Ver legales."
    },
    {
      "descripcion": "En un pago con tarjetas de crédito Cabal  y Débito Cabal",
      "icono": "logo_credicoop.png",
      "textoDescuento": "30% DE DESCUENTO",
      "dias": [
        {
          "descripcion": "Lunes"
        }
      ],
      "isDigital": true,
      "observacion": "Válido únicamente los lunes 07/09, 14/09 y 28/09 Aplican exclusiones. Tope de Reintegro $15000 semanal por usuario.Ver legales."
    },
    {
      "descripcion": "En un pago con tarjetas de crédito Visa, Mastercard y Cabal",
      "icono": "logo_ciudad1.png",
      "textoDescuento": "25% DE DESCUENTO",
      "dias": [
        {
          "descripcion": "Lunes"
        }
      ],
      "isDigital": true,
      "observacion": "Tope $30.000. En compras en un pago. Aplica en los productos sin oferta, aplican excluidos, ver legales."
    }
  ],
  "promocionesSucursalesFisicas": [
    {
      "descripcion": "Exclusivo en sucursales. Pagando con MODO desde la app de Supervielle con tarjetas de débito y crédito del banco",
      "icono": "logo_supervielle2.png",
      "textoDescuento": "25% DE DESCUENTO",
      "dias": [
        {
          "descripcion": "Martes"
        }
      ],
      "isDigital": false,
      "observacion": "No acumula con promo Modo martes. Sin tope. En compras presenciales en un pago. Aplica en los productos sin oferta, aplican excluidos, ver legales."
    },
    {
      "descripcion": "Exclusivo en sucursales. Pagando con QR desde la app de tu banco o app MODO",
      "icono": "logo_modo.png",
      "textoDescuento": "20% DE DESCUENTO",
      "dias": [
        {
          "descripcion": "Martes"
        }
      ],
      "isDigital": false,
      "observacion": "Sin tope. En compras presenciales en un pago. Aplica en los productos sin oferta, aplican excluidos, ver legales."
    },
    {
      "descripcion": "Exclusivo en sucursales. Pagando con MODO desde la app de Comafi con tarjetas de débito y crédito del banco",
      "icono": "logo_comafi.png",
      "textoDescuento": "30% DE DESCUENTO",
      "dias": [
        {
          "descripcion": "Martes"
        }
      ],
      "isDigital": false,
      "observacion": "No acumula con promo Modo martes. Sin tope. En compras presenciales en un pago. Aplica en los productos sin oferta, aplican excluidos, ver legales."
    },
    {
      "descripcion": "Exclusivo en sucursales. Abonando con tarjetas de débito y crédito cabal Credicoop exclusivo desde APP BANCA CREDICOOP con MODO",
      "icono": "logo_credicoop.png",
      "textoDescuento": "30% DE DESCUENTO",
      "dias": [
        {
          "descripcion": "Lunes"
        }
      ],
      "isDigital": false,
      "observacion": "Válido únicamente los lunes 07/09, 14/09 y 28/09. Tope de reintegro unificado: $15.000 por usuario por semana. Aplican exclusiones. Ver legal"
    },
    {
      "descripcion": "Exclusivo en sucursales. Pagando con MODO desde la app de Ciudad con tarjetas de crédito del banco",
      "icono": "logo_ciudad1.png",
      "textoDescuento": "25% DE DESCUENTO",
      "dias": [
        {
          "descripcion": "Lunes"
        }
      ],
      "isDigital": false,
      "observacion": "Aplica exclusiones. Ver legales. Tope de Reintegro $30.000 por transacción."
    }
  ]
};

const respuesta = body => ({ ok: true, json: async () => body, text: async () => JSON.stringify(body) });
const aDocs = objetos => ({ data: { documents: objetos.map(o => ({ fields: Object.entries(o).map(([key, value]) => ({ key, value })) })) } });

function mockCencosud(entradas) {
  globalThis.fetch = async () => respuesta({ value: JSON.stringify(entradas) });
}
function mockVTEX({ promos, bancos }) {
  globalThis.fetch = async url => {
    if (String(url).includes('GetBanks')) return respuesta(aDocs(bancos));
    if (String(url).includes('GetCards')) return respuesta(aDocs([]));
    return respuesta(aDocs(promos));
  };
}
function mockCoto() {
  globalThis.fetch = async () => respuesta({ result: COTO });
}

const VIGENCIA = { vigenciaDesde: new Date('2020-01-01'), vigenciaHasta: new Date('2099-01-01') };
const TODOS_LOS_DIAS = [1, 2, 3, 4, 5, 6, 7];

// ─── 1. Monto mínimo ─────────────────────────────────────────────────────────
describe('1. monto mínimo', () => {
  const casos = [
    ['Pagando con tarjetas de crédito y/o débito. No aplica para pagos con transferencia (PCT) Tope: $25.000 mensual por banco. Mínimo de compra: $75.000. (MD-29)*', 75000],
    ['Tope: $20.000 por cliente por mes. Mínmo de compra $30.000. Promoción exlusiva en las tiendas de MASGO.', 30000],
    ['20% DE AHORRO EN COMPRAS IGUALES O SUPERIORES A $75.000 PAGANDO CON MODO', 75000],
    ['Tope de reintegro $25.000 por banco, por usuario y por mes calendario, para compras iguales o superiores a $100.000. La promoción aplica exclusivamente', 100000],
    ['Tope de reintegro $5.000 por transacción y $15.000 por banco para compras mayor o iguales a $40.000. Aplica únicamente a aquellos usuarios', 40000],
    ['Exclusivo con dinero en cuenta. Mínimo de compra $15.000. Ver exclusiones en el legal', 15000],
    ['Mínimo de compra $15.000. Promoción acumulable. Si sos jubilado tope de $5.000.', 15000],
    ['monto mayor o igual a $35.000', 35000],
    ['por compras superiores a $100.000', 100000],
    ['18 Y 24 CUOTAS SIN INTERÉS EN TELEVISORES Y LÍNEA BLANCA SIN MÍNIMO DE COMPRA . PARA MÁS INFORMACIÓN', null],
  ];
  for (const [texto, esperado] of casos) {
    test(`"${texto.slice(0, 60)}…" → ${esperado}`, () => assert.equal(pb.extraerMontoMinimo(texto), esperado));
  }

  test('Chango Más: MODO lunes queda con mínimo $75.000 al pasar por el fetch', async () => {
    mockVTEX(VTEX.cm);
    const { promos } = await pb.fetchChangoMas();
    const modo = promos.find(p => p.canonicosPosibles.join() === 'MODO');
    assert.equal(modo.montoMinimo, 75000);
    assert.equal(pb.mejorPromoTicket([modo], 70000), null, 'no aplica por debajo del mínimo');
  });
});

// ─── 2. Topes ────────────────────────────────────────────────────────────────
describe('2. topes', () => {
  test('(a) Coto Comafi 30% online martes: dos topes (general/Segmento Único) → el MENOR, nunca "sin tope"', async () => {
    const obs = 'Cartera general con tope de reintegro $ 15.000 por transacción, para Segmento Unico tope de reintegro $ 25.000 por transacción. Aplican exclusiones. Ver legales.';
    assert.equal(pb.extraerTopeTextoLibre(obs), 15000);
    mockCoto();
    const { promos } = await pb.fetchCoto();
    const comafi = promos.find(p => p.canonicosPosibles.join() === 'Comafi');
    assert.equal(comafi.tope, 15000);
  });

  test('(a) Chango Más Comafi MODO: "Tope: $12.000 ... Tope: $15.000 para Unico Black" → 12.000', () => {
    assert.equal(pb.topeDePromo('Tope: $12.000 semanal para Comafi Ahorro, Global, y/o Classic, Premium y/o Platinum. Tope: $15.000 semanal para Comafi Unico Black.', ''), 12000);
  });

  test('(b) tope sin "$": "TOPE 40.000 POR VIGENCIA" (Patagonia en Cencosud)', async () => {
    assert.equal(pb.extraerTope('EN LAS COMPRAS PRESENCIALES. TOPE 40.000 POR VIGENCIA DE LA PROMOCION.'), 40000);
    mockCencosud([CENCOSUD.patagonia40]);
    const { promos } = await pb.fetchJumbo();
    assert.equal(promos[0].tope, 40000);
  });

  test('(b) sin "$" no confunde un teléfono ni un monto mal escrito', () => {
    assert.equal(pb.extraerTope('Tope por cliente: consultá al 0810-777-8888'), null);
    // typo real (BBVA en Cencosud): "$10.00" no es $1.000
    assert.equal(pb.extraerTope('tope de devolución $5.000 por usuario. adicional con un tope de devolución de $10.00 por usuario'), 5000);
  });

  test('(c) Cuenta DNI 10% miércoles (Carrefour): "¡Sin Tope!" + tope de jubilados → null', async () => {
    const sub = 'Mínimo de compra $15.000. Promoción acumulable. Si sos jubilado tope de $5.000. Ver exclusiones en el legal';
    const legal = 'BONIFICACIÓN DEL 10%. SIN TOPE DE REINTEGRO. QUIEN REALICE UNA COMPRA DE $30.000. RECIBIRÁ UN REINTEGRO DE $3.000.';
    assert.equal(pb.topeDePromo(sub, `${sub} ${legal}`), null);
    mockVTEX(VTEX.carr);
    const { promos } = await pb.fetchCarrefour();
    const dni = promos.find(p => p.canonicosPosibles.includes('Cuenta DNI'));
    assert.equal(dni.tope, null);
    assert.equal(dni.montoMinimo, 15000);
  });

  test('el subtítulo manda sobre el legal (Patagonia Singular $15.000 vs. $10.000 de otros productos)', () => {
    assert.equal(pb.topeDePromo('Tope: $15.000 mensual. (P3)*', 'Tope: $15.000 mensual. TOPE POR CUENTA Y POR MES $10.000.'), 15000);
  });
});

// ─── 3. MODO + banco ─────────────────────────────────────────────────────────
describe('3. MODO + banco exige las dos tarjetas', () => {
  const casos = [
    ['ICBC Modo', ['ICBC', 'MODO'], true],
    ['Banco Credicoop MODO', ['Credicoop', 'MODO'], true],
    ['Hipotecario_Modo', ['Banco Hipotecario', 'MODO'], true],
    ['Banco_Comafi_MODO', ['Comafi', 'MODO'], true],
    ['Modo', ['MODO'], false],
    ['MODO', ['MODO'], false],
    ['Galicia Modo', ['Galicia Modo'], false],
    ['Galicia', ['Galicia'], false],
  ];
  for (const [nombre, canonicos, todas] of casos) {
    test(`"${nombre}" → ${canonicos.join(' + ')}${todas ? ' (todas)' : ''}`, () => {
      assert.deepEqual(pb.resolverTarjetasPromo([nombre]), { canonicosPosibles: canonicos, requiereTodas: todas });
    });
  }
  test('"Yoy_MODO" (banco sin canónico) se descarta en vez de quedar como MODO genérico', () => {
    assert.deepEqual(pb.resolverTarjetasPromo(['Yoy_MODO']).canonicosPosibles, []);
  });

  test('Chango Más: con solo MODO NO se recibe ICBC Modo ni Comafi MODO; con las dos sí', async () => {
    mockVTEX(VTEX.cm);
    const datos = { changomas: await pb.fetchChangoMas() };
    const soloModo = pb.filtrarPromosBancariasPorTarjetas(datos, ['MODO']).changomas.promos;
    assert.ok(soloModo.every(p => !p.requiereTodas), 'ninguna promo de MODO+banco para quien tiene solo MODO');
    assert.ok(soloModo.some(p => p.canonicosPosibles.join() === 'MODO'), 'la de MODO genérico sí');

    const conIcbc = pb.filtrarPromosBancariasPorTarjetas(datos, ['MODO', 'ICBC']).changomas.promos;
    const icbc = conIcbc.find(p => p.requiereTodas);
    assert.deepEqual(icbc.canonicosPosibles, ['ICBC', 'MODO']);
    assert.equal(icbc.bancoCanonico, 'ICBC (MODO)');

    const soloIcbc = pb.filtrarPromosBancariasPorTarjetas(datos, ['ICBC']).changomas.promos;
    assert.equal(soloIcbc.length, 0, 'solo la tarjeta ICBC sin MODO tampoco alcanza');
  });

  test('Coto: "Pagando con MODO desde la app de Comafi/Ciudad/Supervielle" y Credicoop con MODO', async () => {
    mockCoto();
    const { promos } = await pb.fetchCoto();
    const fisicas = promos.filter(p => p.canales[0] === 'tienda');
    const porBanco = Object.fromEntries(fisicas.map(p => [p.canonicosPosibles[0], p]));
    for (const banco of ['Comafi', 'Supervielle', 'Banco Ciudad', 'Credicoop']) {
      assert.deepEqual(porBanco[banco].canonicosPosibles, [banco, 'MODO'], banco);
      assert.equal(porBanco[banco].requiereTodas, true, banco);
    }
    assert.equal(porBanco.MODO.requiereTodas, false, 'MODO martes genérico sigue siendo de cualquier MODO');
  });

  test('"Galicia Modo" sigue andando para quien marca "Galicia Modo" (y ya no para quien tiene solo MODO)', () => {
    const promo = { ...pb.resolverTarjetasPromo(['Galicia Modo']), dias: TODOS_LOS_DIAS, ...VIGENCIA, descuentoPct: 0.1 };
    const datos = { vea: { promos: [promo], error: null } };
    assert.equal(pb.filtrarPromosBancariasPorTarjetas(datos, ['Galicia Modo']).vea.promos[0].bancoCanonico, 'Galicia Modo');
    assert.equal(pb.filtrarPromosBancariasPorTarjetas(datos, ['MODO']).vea.promos.length, 0);
  });
});

// ─── 4. Alias ────────────────────────────────────────────────────────────────
describe('4. alias', () => {
  test('"NaranjaX" (Chango Más, sin espacio) → Naranja X', () => {
    assert.deepEqual(pb.resolverCanonicosDesdeNombre('NaranjaX'), ['Naranja X']);
  });
  test('"Club La Nación" (Carrefour) ya no es Banco Nación; "Banco Nación BNA" sí', () => {
    assert.deepEqual(pb.resolverCanonicosDesdeNombre('Club La Nación'), []);
    assert.deepEqual(pb.resolverCanonicosDesdeNombre('Banco Nación BNA'), ['Banco Nación']);
  });
  test('Banco Hipotecario (Cencosud, 25% martes tope $15.000) ya no se descarta', async () => {
    assert.deepEqual(pb.resolverCanonicosDesdeNombre('Banco Hipotecario'), ['Banco Hipotecario']);
    assert.ok(pb.TARJETAS_CONOCIDAS.includes('Banco Hipotecario'));
    mockCencosud([CENCOSUD.hipotecario]);
    const { promos } = await pb.fetchJumbo();
    assert.equal(promos.length, 1);
    assert.equal(promos[0].tope, 15000);
    assert.deepEqual(promos[0].dias, [2]);
  });
  test('"Patagonia" a secas (Carrefour) sigue sin alias (decisión pendiente por niveles)', () => {
    assert.deepEqual(pb.resolverCanonicosDesdeNombre('Patagonia'), []);
  });
  test('Carrefour: Club La Nación no aparece como promo de Banco Nación', async () => {
    mockVTEX(VTEX.carr);
    const { promos } = await pb.fetchCarrefour();
    assert.ok(!promos.some(p => p.canonicosPosibles.includes('Banco Nación')));
  });
});

// ─── 5. Canal ────────────────────────────────────────────────────────────────
describe('5. canal', () => {
  test('(a) Chango Más `express` = presencial Y online (MasClub 15% "Presencial y online")', async () => {
    mockVTEX(VTEX.cm);
    const { promos } = await pb.fetchChangoMas();
    const masclub = promos.find(p => p.canonicosPosibles.includes('MasClub'));
    assert.ok(pb.promoAplicaEnCanal(masclub, 'online'));
    assert.ok(pb.promoAplicaEnCanal(masclub, 'fisico'));
  });

  test('(b) Carrefour: promo que solo tiene `maxi` se descarta (MP 10% viernes, Cuenta DNI miércoles Maxi)', async () => {
    mockVTEX(VTEX.carr);
    const { promos } = await pb.fetchCarrefour();
    assert.ok(!promos.some(p => p.canonicosPosibles.includes('Mercado Pago') && p.descuentoPct === 0.1), 'MP 10% (solo Maxi)');
    const dni = promos.filter(p => p.canonicosPosibles.includes('Cuenta DNI'));
    assert.equal(dni.length, 1, 'queda solo la de hiper/market/express');
    assert.ok(!dni[0].canales.includes('maxi'));
  });

  test('(c) Tarjeta Carrefour Crédito 20% jueves (solo online) → requiereOnlinePorSuper y soloOnline', async () => {
    mockVTEX(VTEX.carr);
    const { promos } = await pb.fetchCarrefour();
    const credito = promos.find(p => p.canonicosPosibles.includes('Tarjeta Carrefour Crédito'));
    assert.ok(pb.promoBancariaRequiereOnline(credito));

    const supers = [{ key: 'carr', nombre: 'Carrefour' }];
    const resumen = calcularResumenFinal([
      { input: 'A', cantidad: 1, ambiguo: false, mejores: { carr: { total: 50000, esOnlineExclusivo: false, ean: '1', sinOferta: true } } },
    ], supers);
    const datos = pb.filtrarPromosBancariasPorTarjetas(
      { carr: { promos: [{ ...credito, dias: TODOS_LOS_DIAS, ...VIGENCIA }], error: null } },
      ['Tarjeta Carrefour Crédito'],
    );
    const bancario = compararTest.aplicarPromosBancarias(resumen, supers, ['Tarjeta Carrefour Crédito'], datos, []);
    assert.equal(resumen.requiereOnlinePorSuper.carr, true);
    assert.equal(bancario.porSuper.carr.soloOnline, true);
    assert.equal(bancario.porSuper.carr.descuento, 10000); // 20% de 50.000, tope $10.000
  });
});

// ─── 6. Domingo en Cencosud ──────────────────────────────────────────────────
describe('6. domingo perdido en Cencosud', () => {
  test('Cencopay Cuenta 40% "viernes, sábados y domingos": days=[5,6] → [5,6,7]', async () => {
    mockCencosud([CENCOSUD.cencopay40]);
    const { promos } = await pb.fetchVea();
    assert.deepEqual(promos[0].dias, [5, 6, 7]);
  });
  test('no agrega domingo por "semana de lunes a domingo" ni por "todos los días martes"', () => {
    assert.deepEqual(pb.diasCencosud(['3'], 'tope $5.000 por cliente por semana (se considera semana de lunes a domingo).'), [3]);
    assert.deepEqual(pb.diasCencosud(['2'], 'beneficio valido todos los dias martes desde el 01/01/2025'), [2]);
    assert.deepEqual(pb.diasCencosud(['1', '2', '3', '4', '5', '6'], 'promocion valida todos los dias del mes de septiembre'), [1, 2, 3, 4, 5, 6, 7]);
  });
});

// ─── 7. Local puntual ────────────────────────────────────────────────────────
describe('7. promos atadas a un local puntual', () => {
  test('Cencopay 25% martes "EN EL LOCAL DE JUMBO COMODORO" se descarta', async () => {
    mockCencosud([CENCOSUD.comodoro]);
    const { promos } = await pb.fetchJumbo();
    assert.equal(promos.length, 0);
  });
  test('no descarta "en los locales habilitados" ni "en los locales jumbo habilitados"', () => {
    assert.equal(pb.esPromoDeLocalPuntual('promocion valida en los locales habilitados y sitios web'), false);
    assert.equal(pb.esPromoDeLocalPuntual('para compras presenciales en los locales jumbo habilitados buenos aires'), false);
    assert.equal(pb.esPromoDeLocalPuntual('valido en la sucursal de venado tuerto. exclusivo disco.com.ar'), true);
  });
});

// ─── 8. Cuotas leídas como % ─────────────────────────────────────────────────
describe('8. cuotas leídas como %', () => {
  test('Cencopay "18" + "CSI o 15% y 12CSI" (18 cuotas) ya no es un 18% sobre el ticket', async () => {
    assert.equal(pb.esFinanciacionVea('CSI o 15% y 12CSI'), true);
    mockCencosud([CENCOSUD.cencopay18]);
    const { promos } = await pb.fetchVea();
    assert.equal(promos.length, 0);
  });
  test('"y 12" / "mil $" tampoco son %; "% y 3 Cuotas Sin Interés", "%" y "" sí', () => {
    assert.equal(pb.esFinanciacionVea('y 12'), true);
    assert.equal(pb.esFinanciacionVea('mil $'), true);
    assert.equal(pb.esFinanciacionVea('% y 3 Cuotas Sin Interés'), false);
    assert.equal(pb.esFinanciacionVea('% '), false);
    assert.equal(pb.esFinanciacionVea(''), false);
  });
});

// ─── 9. Coto "Aplica en los productos sin oferta" ────────────────────────────
describe('9. Coto: solo productos sin oferta', () => {
  test('el fetch marca soloSinOferta en Ciudad online, MODO martes, Supervielle/Comafi con MODO', async () => {
    mockCoto();
    const { promos } = await pb.fetchCoto();
    const marcadas = promos.filter(p => p.soloSinOferta).map(p => `${p.canonicosPosibles.join('+')}/${p.canales[0]}`).sort();
    assert.deepEqual(marcadas, ['Banco Ciudad/ecommerce', 'Comafi+MODO/tienda', 'MODO/tienda', 'Supervielle+MODO/tienda']);
  });

  test('mejorPromoTicket usa como base solo la parte sin oferta (monto mínimo sigue contra el total)', () => {
    const promo = { descuentoPct: 0.2, tope: null, montoMinimo: null, soloSinOferta: true };
    assert.equal(pb.mejorPromoTicket([promo], 40000, 10000).descuento, 2000);
    assert.equal(pb.mejorPromoTicket([{ ...promo, soloSinOferta: false }], 40000, 10000).descuento, 8000);
  });

  test('comparar.js: el % va solo sobre los ítems sin promo de producto y se reparte solo entre esas filas', () => {
    const supers = [{ key: 'coto', nombre: 'Coto' }];
    const resumen = calcularResumenFinal([
      { input: 'sin oferta', cantidad: 1, ambiguo: false, mejores: { coto: { total: 10000, esOnlineExclusivo: false, ean: '1', sinOferta: true } } },
      { input: 'con oferta', cantidad: 1, ambiguo: false, mejores: { coto: { total: 30000, esOnlineExclusivo: false, ean: '2', sinOferta: false } } },
    ], supers);
    const promo = { canonicosPosibles: ['MODO'], requiereTodas: false, dias: TODOS_LOS_DIAS, ...VIGENCIA, canales: ['tienda'], descuentoPct: 0.2, tope: null, montoMinimo: null, soloSinOferta: true };
    const datos = pb.filtrarPromosBancariasPorTarjetas({ coto: { promos: [promo], error: null } }, ['MODO']);
    const bancario = compararTest.aplicarPromosBancarias(resumen, supers, ['MODO'], datos, []);
    assert.equal(bancario.porSuper.coto.descuento, 2000, '20% de $10.000, no de $40.000');
    assert.equal(bancario.porSuper.coto.soloSinOferta, true);

    const items = [
      { ean: '1', opciones: [{ key: 'coto', total: 10000, totalSinPromo: 10000, promo: null }] },
      { ean: '2', opciones: [{ key: 'coto', total: 30000, totalSinPromo: 36000, promo: { descripcion: '2x1', tarjetaActiva: true } }] },
    ];
    compararTest.repartirDescuentoBancarioEntreFilas(items, resumen, bancario, supers);
    assert.equal(items[0].opciones[0].total, 8000);
    assert.equal(items[1].opciones[0].total, 30000, 'la fila con oferta no se toca');
    assert.equal(resumen.subtotalAsignadoPorSuper.coto, 38000);
  });
});

// ─── 10. Coto: fechas puntuales ──────────────────────────────────────────────
describe('10. Coto: fechas puntuales', () => {
  const texto = 'Válido únicamente los lunes 07/09, 14/09 y 28/09 Aplican exclusiones. Tope de Reintegro $15000 semanal por usuario.Ver legales.';

  test('parsea "únicamente los lunes 07/09, 14/09 y 28/09"', () => {
    assert.deepEqual(pb.extraerFechasPuntuales(texto, [1], 2026), ['09-07', '09-14', '09-28']);
    assert.equal(pb.extraerFechasPuntuales('Sin tope de reintegro.', [1], 2026), null);
  });

  test('si una fecha no cae en el día de la promo (o no se puede leer) → false (se descarta)', () => {
    assert.equal(pb.extraerFechasPuntuales(texto, [2], 2026), false);
    assert.equal(pb.extraerFechasPuntuales('Válido únicamente los lunes 31/02', [1], 2026), false);
  });

  test('solo aplica esos lunes (hora argentina), no todos los lunes', () => {
    const promo = { dias: [1], ...VIGENCIA, fechasPuntuales: ['09-07', '09-14', '09-28'] };
    assert.equal(pb.promosAplicablesHoy([promo], { fecha: new Date('2026-09-21T15:00:00Z') }).length, 0, 'lunes 21/09');
    assert.equal(pb.promosAplicablesHoy([promo], { fecha: new Date('2026-09-28T15:00:00Z') }).length, 1, 'lunes 28/09');
  });

  test('el fetch de Coto le pone fechasPuntuales a las dos de Credicoop', async () => {
    if (partesFechaArgentina(new Date()).anio !== 2026) return; // las fechas del feed son de 2026
    mockCoto();
    const { promos } = await pb.fetchCoto();
    const credicoop = promos.filter(p => p.canonicosPosibles.includes('Credicoop'));
    assert.equal(credicoop.length, 2);
    for (const p of credicoop) assert.deepEqual(p.fechasPuntuales, ['09-07', '09-14', '09-28']);
  });
});
