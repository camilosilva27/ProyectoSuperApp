/**
 * Tests del modelo de tarjetas/descuentos del cliente (decisiones del usuario, 2026-09-24):
 *  1. "<Banco> Modo" como canónico propio (ICBC Modo, Credicoop Modo, Banco Nación Modo…), igual
 *     que "Galicia Modo" — reemplaza a `requiereTodas`.
 *  2. Segmentos del cliente como requisitos ("Jubilado", "Plan sueldo", "Empleado público",
 *     "Supervielle Identité"), detectados solo en los campos cortos.
 *  3. "Billeteras Virtuales" (Chango Más) = Mercado Pago.
 *  4. "MasGO" (formato de tienda de Chango Más) como requisito.
 *  5. "Comunidad Coto" como requisito (promos por ticket de Coto con ícono de comunidad).
 *  6. Carrefour "10% OFF Todos los Medios de Pago - EXCLUSIVO ONLINE" para todos los usuarios.
 * Todos los textos y entradas son REALES, recortados de los feeds del 2026-09-24 (Cencosud
 * bankDiscount, GraphQL de Carrefour/Chango Más, getPromocionesMulticanal de Coto, bloque de CMS
 * de Día). Ver "Promos bancarias por ticket" en .claude/docs/CONTEXTO_TECNICO.md.
 *
 * Sin red: fetch se mockea reemplazando globalThis.fetch.
 * Correr con: node --test AllPromos/core/bancarias-tarjetas-segmentos.test.js
 */

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const pb = require('../promos-bancarias');
const { calcularResumenFinal } = require('./comparador');
const { _test: compararTest } = require('../../backend/src/routes/comparar');
const { _test: grillaTest } = require('../../backend/src/routes/promosBancariasGrilla');
const { _test: misDescuentosTest } = require('../../backend/src/routes/misDescuentos');

const fetchOriginal = globalThis.fetch;
afterEach(() => { globalThis.fetch = fetchOriginal; });

// ─── Fixtures reales (recortadas) ─────────────────────────────────────────────
const CARR = {
 "promos": [
  {
   "id": "5b3a5ac4-b292-4228-9cc1-c8deab420fe8",
   "title": "10% de descuento si sos parte de Mi Carrefour y beneficiario de Anses o mayor de 60 años.",
   "sub_title": "Tope de devolución: $35.000. No incluye canicería, huevos de gallina, ni electro",
   "legal": "VÁLIDO DE LUNES A MIÉRCOLES HASTA EL 30/09/26 INCLUSIVE. EXCLUSIVO EN HIPERMERCADOS CARREFOUR, CARREFOUR MARKET, CARREFOUR\r\nEXPRESS, CARREFOUR.COM.AR Y EN EL CASO DE CARREFOUR MAXI PARA COMPRAS DE CLI",
   "discount_percentage": "10",
   "idBank": "442cdb4d-e69c-4065-a25f-972544be6228",
   "idCard": "null",
   "monday": "true",
   "tuesday": "true",
   "wednesday": "true",
   "thursday": "false",
   "friday": "false",
   "saturday": "false",
   "sunday": "false",
   "hyper": "true",
   "market": "true",
   "ecommerce": "true",
   "express": "true",
   "maxi": "true",
   "active_from": "2026-09-01T00:00:00+00:00",
   "active_to": "2026-10-01T00:00:00+00:00"
  },
  {
   "id": "bc1f3a3d-50aa-4bf0-a833-177b08adc79e",
   "title": "5% de Ahorro, si sos jubilado o pensionado, en el acto con tarjetas de crédito visa y mastercard y tarjetas de débito mastercard. Exclusivo pagando con Modo.",
   "sub_title": "Acumulable con promociones vigentes. Tope semanal:$5000. No incluye  electrodomésticos, electrónica, telefonía celular carnicería ni huevos de gallina.",
   "legal": "PROMOCIÓN VÁLIDA EXCLUSIVAMENTE DE LUNES A VIERNES HASTA EL 30/09/2026. BENEFICIO DEL 5% PARA JUBILADOS Y QUIENES COBREN SUS HABERES PREVISIONALES POR BNA. PARA COMPRAS REALIZADAS EN 1 PAGO CON TARJET",
   "discount_percentage": "5",
   "idBank": "deb62fe4-7dad-11eb-82ac-0abd31a25a99",
   "idCard": "null",
   "monday": "true",
   "tuesday": "true",
   "wednesday": "true",
   "thursday": "true",
   "friday": "true",
   "saturday": "false",
   "sunday": "false",
   "hyper": "true",
   "market": "true",
   "ecommerce": "false",
   "express": "true",
   "maxi": "true",
   "active_from": "2026-09-01T00:00:00+00:00",
   "active_to": "2026-10-01T00:00:00+00:00"
  },
  {
   "id": "35d30d5f-567a-11f0-b37f-c2cb70a90ede",
   "title": "10% de descuento en tu compra con Cuenta DNI ¡Sin Tope!. Y si sos jubilado, tenes 5% de descuento adicional.",
   "sub_title": "Mínimo de compra $15.000. Promoción acumulable. Si sos jubilado tope de $5.000. Ver exclusiones en el legal",
   "legal": "PROMOCIÓN VÁLIDA TODOS LOS MIÉRCOLES HASTA EL 30/09/2026 INCLUSIVE. PARA COMPRAS REALIZADAS A TRAVÉS DE LA FUNCIONALIDAD \"PAGO CLAVE DNI\" Y/O QR DE LA APLICACIÓN CUENTA DNI EN TODAS LAS TIENDAS HIPERM",
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
   "id": "4f9ac242-778f-11f0-b37f-f9b6f2b5c87b",
   "title": "Si sos empleado/a público todos los jueves",
   "sub_title": "En Alimentos secos, Congelados, Lácteos, Fiambres,  Bebidas, Limpieza y Perfumería. Tope máximo de descuento mensual $ 20.000",
   "legal": "PROMOCIÓN VÁLIDA LOS DIAS JUEVES HASTA EL 30/09/2026, EXCLUSIVO EN HIPERMERCADOS CARREFOUR Y CARREFOUR MARKET DE LAS PROVINCIAS DE: SANTA FE, FORMOSA, NEUQUÉN, SALTA, RÍO NEGRO, TIERRA DEL\r\nFUEGO, Y D",
   "discount_percentage": "15",
   "idBank": "null",
   "idCard": "null",
   "monday": "false",
   "tuesday": "false",
   "wednesday": "false",
   "thursday": "true",
   "friday": "false",
   "saturday": "false",
   "sunday": "false",
   "hyper": "true",
   "market": "true",
   "ecommerce": "false",
   "express": "true",
   "maxi": "true",
   "active_from": "2026-09-01T00:00:00+00:00",
   "active_to": "2026-10-01T00:00:00+00:00"
  },
  {
   "id": "41bd454d-0113-44ca-8848-c6950450ba95",
   "title": "10% OFF Todos los Medios de Pago - EXCLUSIVO ONLINE",
   "sub_title": "Tope de descuento de $8000 por semana",
   "legal": "DESCUENTO EXCLUSIVO PARA COMPRAS REALIZADAS EN 1 PAGO, ABONANDO CON CUALQUIER MEDIO DE PAGO. VÁLIDO TODOS LOS JUEVES DE SEPTIEMBRE 2026 PARA LAS COMPRAS ONLINE EN CARREFOUR.COM.AR Y EN LA APP DE CARRE",
   "discount_percentage": "10",
   "idBank": "null",
   "idCard": "null",
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
   "id": "2be11499-17aa-4d95-8937-45a2837c3d51",
   "title": "15% de Ahorro con tarjeta de débito y en un pago con tarjeta de credito Visa, Mastercard y Amex.",
   "sub_title": "Tope de devolución (POR MES Y POR CUENTA) $10.000 - Exclusivo para clientes con plan sueldo. Ver exclusiones en el legal.",
   "legal": "PROMOCIÓN VÁLIDA LOS DÍAS MIERCOLES HASTA EL 30/09/2026. PARA COMPRAS REALIZADAS CON TARJETA DE DÉBITO Y EN 1 PAGO CON TARJETAS DE CRÉDITO VISA EMITIDAS POR EL BANCO PATAGONIA QUE COBREN SUS HABERES E",
   "discount_percentage": "15",
   "idBank": "962da28b-7dae-11eb-82ac-02f0e64629af",
   "idCard": "5a3c378c-7dad-11eb-82ac-0e5742ad38db",
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
   "maxi": "true",
   "active_from": "2026-09-01T00:00:00+00:00",
   "active_to": "2026-10-01T00:00:00+00:00"
  }
 ],
 "bancos": [
  {
   "id": "deb62fe4-7dad-11eb-82ac-0abd31a25a99",
   "name": "Banco_Nacion"
  },
  {
   "id": "8153eb03-198c-4e73-b5a1-07ac54c4e42e",
   "name": "Cuenta Dni"
  },
  {
   "id": "442cdb4d-e69c-4065-a25f-972544be6228",
   "name": "Mi Carrefour"
  },
  {
   "id": "962da28b-7dae-11eb-82ac-02f0e64629af",
   "name": "Patagonia"
  },
  {
   "id": "5a3c378c-7dad-11eb-82ac-0e5742ad38db",
   "name": "Visa"
  }
 ]
};
const CM = {
 "promos": [
  {
   "id": "146b6061-e761-4a77-aef4-2efc3edc13c4",
   "title": "Exclusivo MasGo ¡SIN TOPE!",
   "sub_title": "Promoción exclusiva para socios de masclub. No acumulable con otras promociones.  Consulte detalles y legales en Masclub.com.ar (MC)*",
   "legal": "Promoción exclusiva para todos los socios de MâsClub. Válida del 01/04/2026 al 31/12/2026 únicamente para compras realizadas los días Miércoles y Jueves. No acumulable con otras promociones. Sin tope ",
   "discount_percentage": "20",
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
   "market": "true",
   "ecommerce": "false",
   "express": "false",
   "maxi": "null",
   "active_from": "2026-08-01T00:00:00+00:00",
   "active_to": "2026-12-31T00:00:00+00:00",
   "isMasClub": "true"
  },
  {
   "id": "248970a3-8b2a-11ef-b37f-e25d0cbe8412",
   "title": "Presencial y online ¡SIN TOPE!",
   "sub_title": "Promoción exclusiva para socios de masclub. No acumulable con otras promociones. Consulta detalles y legales en Masclub.com.ar (MC)*",
   "legal": "Promoción exclusiva para todos los socios de MâsClub. Válida del 01/04/2026 al 31/12/2026 únicamente para compras realizadas los días Miércoles y Jueves. No acumulable con otras promociones. Sin tope ",
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
   "active_from": "2025-12-25T00:00:00+00:00",
   "active_to": "2026-12-31T00:00:00+00:00",
   "isMasClub": "true"
  },
  {
   "id": "f72bdebb-262f-11f0-b37f-a7f7ce43e163",
   "title": "SIN TOPE DE REINTEGRO",
   "sub_title": "Pagando con QR de todas las billeteras virtuales. No acumulable con otras promociones. Aplican exclusiones. (BV)",
   "legal": "PARA PAGOS REALIZADOS LOS DIAS VIERNES, SABADOS Y DOMINGOS DE SEPTIEMBRE 2026 A TRAVÉS DEL SERVICIO DE PROCESAMIENTO DE PAGOS DE MERCADO PAGO OPERADO POR MERCADOLIBRE S.R.L. (“MERCADO PAGO.”) MEDIANTE",
   "discount_percentage": "15",
   "idBank": "15ff1c4e-2630-11f0-b37f-93b1d8eaa315",
   "idCard": "null",
   "monday": "false",
   "tuesday": "false",
   "wednesday": "false",
   "thursday": "false",
   "friday": "true",
   "saturday": "true",
   "sunday": "true",
   "hyper": "null",
   "market": "false",
   "ecommerce": "false",
   "express": "true",
   "maxi": "null",
   "active_from": "2025-12-06T00:00:00+00:00",
   "active_to": "2026-10-01T00:00:00+00:00",
   "isMasClub": "false"
  },
  {
   "id": "a3c07fac-a4f8-4a49-8fc4-8e814dcc10df",
   "title": "Con tarjeta de crédito Mastercard a través de Buepp y App Ciudad",
   "sub_title": "Tope: $20.000 mensual. Promocióne exclusiva en las tiendas de MasGO. (BC-MG)*",
   "legal": "PROMOCIÓN OFRECIDA POR EL BANCO DE LA CIUDAD DE BUENOS AIRES, CUIT 30-99903208-3 (BANCO CIUDAD) CON DOMICILIO EN LA CALLE FLORIDA 302, CABA. VÁLIDA DESDE EL 27/08/2026 HASTA EL 31/12/2026 INCLUSIVE, T",
   "discount_percentage": "35",
   "idBank": "6db380e1-bb9d-4ed9-82ef-15a799aec451",
   "idCard": "null",
   "monday": "false",
   "tuesday": "false",
   "wednesday": "false",
   "thursday": "true",
   "friday": "false",
   "saturday": "false",
   "sunday": "false",
   "hyper": "null",
   "market": "true",
   "ecommerce": "false",
   "express": "false",
   "maxi": "null",
   "active_from": "2026-09-01T00:00:00+00:00",
   "active_to": "2026-10-01T00:00:00+00:00",
   "isMasClub": "false"
  },
  {
   "id": "106ed460-96d5-46f7-b1cd-1b8b6b43a06a",
   "title": "Desde APP MODO o APP de bancos aheridos",
   "sub_title": "Tope: $20.000 por cliente por mes. Mínmo de compra $30.000. Promoción exlusiva en las tiendas de MASGO. (MODO-MG)",
   "legal": "BENEFICIO EXCLUSIVO PARA COMPRAS REALIZADAS DE MANERA PRESENCIAL EN TIENDAS MASGO ADHERIDAS, LOS DÍAS DOMINGOS COMPRENDIDOS ENTRE EL 16/08/2026 Y EL 31/10/2026, INCLUSIVE. 20% DE REINTEGRO PARA COMPRA",
   "discount_percentage": "20",
   "idBank": "6bbbedf1-ab40-11ee-8452-127334bd7427",
   "idCard": "null",
   "monday": "false",
   "tuesday": "false",
   "wednesday": "false",
   "thursday": "false",
   "friday": "false",
   "saturday": "false",
   "sunday": "true",
   "hyper": "null",
   "market": "true",
   "ecommerce": "false",
   "express": "false",
   "maxi": "null",
   "active_from": "2026-09-01T00:00:00+00:00",
   "active_to": "2026-10-01T00:00:00+00:00",
   "isMasClub": "false"
  },
  {
   "id": "66dc6331-3d38-4a60-8d98-19cce4e385cf",
   "title": "Con tarjetas de Crédito Visa y MasterCard",
   "sub_title": "Tope: $15.000 semanal. (IC1)*",
   "legal": "CARTERA DE CONSUMO. PROMOCIÓN VÁLIDA EN LA REPÚBLICA ARGENTINA PARA EL CUARTO FIN DE SEMANA DE CADA MES DESDE EL 01/07/2026 HASTA EL 31/12/2026. 20% DE AHORRO CON TARJETAS DE CRÉDITO VISA Y MASTERCARD",
   "discount_percentage": "20",
   "idBank": "06fc4208-78d8-11ee-83ab-0a1649dfa6b1",
   "idCard": "null",
   "monday": "false",
   "tuesday": "false",
   "wednesday": "false",
   "thursday": "false",
   "friday": "false",
   "saturday": "true",
   "sunday": "true",
   "hyper": "null",
   "market": "false",
   "ecommerce": "false",
   "express": "true",
   "maxi": "null",
   "active_from": "2026-07-01T00:00:00+00:00",
   "active_to": "2026-10-01T00:00:00+00:00",
   "isMasClub": "false"
  },
  {
   "id": "f75d9bb7-25f8-11f0-b37f-f803d3fbf6af",
   "title": "Con tarjeta Visa débito",
   "sub_title": "Tope mensual: $10.000 para Cartera General y $30.000 para Búho One, Sueldo, Emprededor y Jubilado. (H)",
   "legal": "CARTERA CONSUMO. PROMOCIÓN VÁLIDA EN LA REPÚBLICA ARGENTINA COMPRANDO DE FORMA PRESENCIAL LOS MARTES EN CHANGOMÁS, HIPERCHANGOMÁS, MASGO Y EN WWW.MASONLINE.COM.AR CON PAGO ONLINE DESDE EL 01/09/2026 H",
   "discount_percentage": "25",
   "idBank": "c40d38d3-1a7a-11ee-83ab-0263dabe290f",
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
   "active_from": "2025-04-30T00:00:00+00:00",
   "active_to": "2026-12-01T00:00:00+00:00",
   "isMasClub": "false"
  },
  {
   "id": "9b9876e3-0770-423d-bf5b-19a83a8f64eb",
   "title": "Con tarjeta de Crédito MasterCard",
   "sub_title": "Tope: $15.000 semanal. (Y2)*",
   "legal": "CARTERA DE CONSUMO. PROMOCIÓN VÁLIDA EN LA REPÚBLICA ARGENTINA PARA EL CUARTO FIN DE SEMANA DE CADA MES DESDE EL 01/07/2026 HASTA EL 31/12/2026: (1) 20% DE AHORRO CON TARJETAS DE CRÉDITO MASTERCARD YO",
   "discount_percentage": "20",
   "idBank": "ab6abe23-54fd-11ef-8452-1211a9021aa7",
   "idCard": "null",
   "monday": "false",
   "tuesday": "false",
   "wednesday": "false",
   "thursday": "false",
   "friday": "false",
   "saturday": "true",
   "sunday": "true",
   "hyper": "null",
   "market": "false",
   "ecommerce": "false",
   "express": "true",
   "maxi": "null",
   "active_from": "2026-04-27T00:00:00+00:00",
   "active_to": "2026-10-01T00:00:00+00:00",
   "isMasClub": "false"
  },
  {
   "id": "61239502-26b4-4c2a-8bb9-8b41677e63ec",
   "title": "Con tarjetas de crédito y débito MasterCard",
   "sub_title": "Tope: 10.000 semanal. (Y)*",
   "legal": "PROPUESTA PARA CARTERA DE CONSUMO VÁLIDA EN LA REPÚBLICA ARGENTINA PARA LOS DÍAS JUEVES DESDE EL 01/07/2026 HASTA EL 31/12/2026. 20% DE AHORRO CON TARJETAS DE CRÉDITO MASTERCARD YOY EN UN SOLO PAGO Y ",
   "discount_percentage": "20",
   "idBank": "7daf51ea-1f6b-11ef-8452-0e6ca8a392fd",
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
   "active_from": "2026-01-01T00:00:00+00:00",
   "active_to": "2026-10-01T00:00:00+00:00",
   "isMasClub": "false"
  },
  {
   "id": "b1435162-d05c-4d5b-94c8-70274110644a",
   "title": "Con tarjetas de Crédito y débito (Cuenta Sueldo)",
   "sub_title": "Tope: $15.000 semanal. (ICS)*",
   "legal": "PROPUESTA PARA CARTERA DE CONSUMO VÁLIDA EN LA REPÚBLICA ARGENTINA PARA LOS DÍAS JUEVES DESDE EL 01/07/2026 HASTA EL 31/12/2026 (1) 20% DE AHORRO CON TARJETAS DE CRÉDITO VISA Y MASTERCARD ICBC EN UN S",
   "discount_percentage": "30",
   "idBank": "2f59e6b6-b357-430a-9e82-3781b870bc52",
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
   "active_from": "2026-04-01T00:00:00+00:00",
   "active_to": "2027-01-01T00:00:00+00:00",
   "isMasClub": "false"
  },
  {
   "id": "da08f0a1-15bd-4a42-aad3-4de113832bf4",
   "title": "Exclusivo Jubilados - Con Visa débito",
   "sub_title": "Tope: $25.000 mensual. (S2)*",
   "legal": "CARTERA CONSUMO. BANCO SUPERVIELLE S.A., RECONQUISTA 330, C.A.B.A., CUIT 33-50000517-9, INSCRIP. I.G.J. N° 23, F° 502, L. 45, T° A DE ESTATUTOS NAC. (“EL BANCO”). PROMOCIÓN VÁLIDA EN LA REPÚBLICA ARGE",
   "discount_percentage": "20",
   "idBank": "b7409f62-44f4-11ed-83ab-1600502170e1",
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
   "active_from": "2026-01-01T00:00:00+00:00",
   "active_to": "2026-10-01T00:00:00+00:00",
   "isMasClub": "false"
  },
  {
   "id": "589fddc2-f1f1-4169-81b5-c8dbd03b33da",
   "title": "Todos los medios de pago.",
   "sub_title": "Tope: $12.000 por transacción. No acumulable con otras promociones. Aplican exclusiones.(A)*",
   "legal": "PROMOCIÓN EXCLUSIVA PARA BENEFICIARIOS DE ANSES EN COMPRAS PRESENCIALES Y ONLINE EN TODAS LAS TIENDAS DEL PAÍS. 10% DESCUENTO. TOPE DE REINTEGRO $12.000 POR TRANSACCIÓN Y $50.000 TOTAL POR MES. PROMOC",
   "discount_percentage": "10",
   "idBank": "32f07815-982d-11ee-8452-1288a753a239",
   "idCard": "null",
   "monday": "true",
   "tuesday": "true",
   "wednesday": "true",
   "thursday": "true",
   "friday": "true",
   "saturday": "true",
   "sunday": "true",
   "hyper": "null",
   "market": "false",
   "ecommerce": "false",
   "express": "true",
   "maxi": "null",
   "active_from": "2026-05-01T00:00:00+00:00",
   "active_to": "2026-10-01T00:00:00+00:00",
   "isMasClub": "false"
  },
  {
   "id": "dbd37a0a-66e3-11ef-b37f-89905a2f1760",
   "title": "Todos los medios de pago",
   "sub_title": "Tope: $12.000 por transacción. Excluye sucursal Luján. (EM)*",
   "legal": "PROMOCIÓN EXCLUSIVA PARA EMPLEADOS MUNICIPALES Y PROVINCIALES PARA COMPRAS PRESENCIALES EN TODAS LAS TIENDAS DEL PAÍS (EXCLUYE TIENDAS DE LUJAN). 10% DE DESCUENTO CON TOPE DE REINTEGRO POR TRANSACCIÓN",
   "discount_percentage": "10",
   "idBank": "d247d13c-0881-11ef-8452-0affe9b94723",
   "idCard": "null",
   "monday": "true",
   "tuesday": "true",
   "wednesday": "true",
   "thursday": "true",
   "friday": "true",
   "saturday": "true",
   "sunday": "true",
   "hyper": "null",
   "market": "true",
   "ecommerce": "false",
   "express": "false",
   "maxi": "null",
   "active_from": "2026-04-01T00:00:00+00:00",
   "active_to": "2026-10-01T00:00:00+00:00",
   "isMasClub": "false"
  },
  {
   "id": "bec58c33-1a9c-4a38-8197-845c2f33deb5",
   "title": "Débito Visa Y Crédito Visa y MasterCard",
   "sub_title": "Tope: $12.000 semanal para Comafi Ahorro, Global, y/o Classic, Premium y/o Platinum.                   Tope: $15.000 semanal para Comafi Unico Black. (CMF)",
   "legal": "LEGAL SEGMENTO: AHORRO, GLOBAL Y CLASSIC | PREMIUM Y PLATINUM.\r\nCARTERA DE CONSUMO. PROMOCIÓN VÁLIDA LOS MARTES DESDE EL 01/08/26 HASTA EL 31/10/26 ABONANDO CON TARJETAS DE CRÉDITO VISA Y MASTERCARD, ",
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
   "active_from": "2026-02-01T00:00:00+00:00",
   "active_to": "2026-10-01T00:00:00+00:00",
   "isMasClub": "false"
  }
 ],
 "bancos": [
  {
   "id": "32f07815-982d-11ee-8452-1288a753a239",
   "name": "Anses"
  },
  {
   "id": "b7409f62-44f4-11ed-83ab-1600502170e1",
   "name": "Banco Supervielle"
  },
  {
   "id": "a234c39c-7f5a-11ef-b37f-f2e65af65faa",
   "name": "Banco_Comafi_MODO"
  },
  {
   "id": "15ff1c4e-2630-11f0-b37f-93b1d8eaa315",
   "name": "Billeteras Virtuales"
  },
  {
   "id": "6db380e1-bb9d-4ed9-82ef-15a799aec451",
   "name": "Buepp Banco Ciudad"
  },
  {
   "id": "d247d13c-0881-11ef-8452-0affe9b94723",
   "name": "Empleados Públicos"
  },
  {
   "id": "c40d38d3-1a7a-11ee-83ab-0263dabe290f",
   "name": "Hipotecario_Modo"
  },
  {
   "id": "06fc4208-78d8-11ee-83ab-0a1649dfa6b1",
   "name": "ICBC Modo"
  },
  {
   "id": "2f59e6b6-b357-430a-9e82-3781b870bc52",
   "name": "ICBC_Sueldos"
  },
  {
   "id": "8fab960f-8b29-11ef-b37f-98380ffd16cd",
   "name": "MasClub"
  },
  {
   "id": "6bbbedf1-ab40-11ee-8452-127334bd7427",
   "name": "Modo"
  },
  {
   "id": "7daf51ea-1f6b-11ef-8452-0e6ca8a392fd",
   "name": "Yoy"
  },
  {
   "id": "ab6abe23-54fd-11ef-8452-1211a9021aa7",
   "name": "Yoy_MODO"
  }
 ]
};
const COTO = {
 "promocionesDigitales": [
  {
   "descripcion": "PLAN SUELDO En un pago con tarjetas de crédito Visa, Mastercard y Visa débito.",
   "icono": "logo_icbc_1.png",
   "textoDescuento": "30% DE DESCUENTO",
   "dias": [
    {
     "descripcion": "Lunes"
    }
   ],
   "isDigital": true,
   "observacion": "Aplican exclusiones. Ver legales - Tope de Reintegro de $20.000"
  },
  {
   "descripcion": "SGTO IDENTITÉ En un pago con tarjetas de crédito Visa y Mastercard.",
   "icono": "logo_supervielle2.png",
   "textoDescuento": "25% DE DESCUENTO",
   "dias": [
    {
     "descripcion": "Martes"
    }
   ],
   "isDigital": true,
   "observacion": "Sin tope de reintegro. Aplican exclusiones. Ver legal."
  },
  {
   "descripcion": "En un pago con tarjetas de crédito Visa y Mastercard, y con tarjeta de débito Visa.",
   "icono": "logo_supervielle2.png",
   "textoDescuento": "20% DE DESCUENTO",
   "dias": [
    {
     "descripcion": "Martes"
    }
   ],
   "isDigital": true,
   "observacion": "Sin tope de reintegro. Aplican exclusiones. Ver legal."
  }
 ],
 "promocionesSucursalesFisicas": [
  {
   "descripcion": "Exclusivo en sucursales. En un pago si sos miembro DE NUESTRA COMUNIDAD. Con todos los medios de pago",
   "icono": "logo_comunidad.png",
   "textoDescuento": "15% DE DESCUENTO",
   "dias": [
    {
     "descripcion": "Miercoles"
    }
   ],
   "isDigital": false,
   "observacion": "Siendo miembro de Comunidad Coto - Aplican exclusiones. Ver legales - Sin límite de reintegro."
  },
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
   "descripcion": "Exclusivo en sucursales. Programa ciudadanía porteña",
   "icono": "logo_ciudadania_portena.png",
   "textoDescuento": "15% DE DESCUENTO",
   "dias": [
    {
     "descripcion": "Martes"
    },
    {
     "descripcion": "Jueves"
    }
   ],
   "isDigital": false,
   "observacion": "Sin tope de reintegro. Aplican exclusiones. Ver legal."
  },
  {
   "descripcion": "Exclusivo en sucursales. En un pago con todos los medios de pago Presentando DNI",
   "icono": "logo_jubiladosypensionados.png",
   "textoDescuento": "15% DE DESCUENTO",
   "dias": [
    {
     "descripcion": "Jueves"
    }
   ],
   "isDigital": false,
   "observacion": "Para todos los JUBILADOS Y PENSIONADOS en un pago con todos los medios de pago Presentando DNI. No válido para venta online. Aplican exclusiones. Ver legal."
  },
  {
   "descripcion": "Exclusivo en sucursales. En pago con tarjetas de débito y crédito.",
   "icono": "logo_beneficios_anses.png",
   "textoDescuento": "10% DE DESCUENTO",
   "dias": [
    {
     "descripcion": "Lunes"
    },
    {
     "descripcion": "Martes"
    },
    {
     "descripcion": "Miercoles"
    },
    {
     "descripcion": "Jueves"
    }
   ],
   "isDigital": false,
   "observacion": "Sin tope de reintegro. Aplican exclusiones. Ver legal."
  },
  {
   "descripcion": "Exclusivo en sucursales. Programa ciudadanía porteña",
   "icono": "logo_ciudadania_portena.png",
   "textoDescuento": "15% DE DESCUENTO",
   "dias": [],
   "isDigital": false,
   "observacion": "Sin tope de reintegro. Aplican exclusiones. Ver legal."
  },
  {
   "descripcion": "Exclusivo en sucursales. En pago con tarjetas de débito y crédito.",
   "icono": "logo_beneficios_anses.png",
   "textoDescuento": "10% DE DESCUENTO",
   "dias": [],
   "isDigital": false,
   "observacion": "Sin tope de reintegro. Aplican exclusiones. Ver legal."
  }
 ]
};
const CENCOSUD = {
 "galicia20": {
  "banks": [
   {
    "name": "Galicia"
   }
  ],
  "websites": [
   "jumboargentina",
   "veaargentina",
   "discoargentina",
   "jumboargentinaio"
  ],
  "days": [
   "4"
  ],
  "discount": "20.00",
  "discountText": "",
  "dateStart": "1748746800",
  "dateEnd": "1761965940",
  "info": "VÁLIDO PRESENCIAL LOS JUEVES | Promoción exclusiva abonando con tus Tarjetas Galicia Visa Débito y Visa Crédito.\r\n(Excluye tarjetas MasterCard y American Express).\r\nAplica sólo a pagos realizados a través de QR de Modo desde app Galicia y app Modo.\r\nTope de reintegro: $15.000 por cliente por mes.\r\nLa presente promoción no es acumulable con otras ofertas, descuentos y/o promociones vigentes. Válida para consumidor final. ",
  "legals": "CARTERA DE CONSUMO: Promoción del 20% de ahorro en compras realizadas en el país, en un pago sobre el precio de contado. Tope de reintegro $15.000 por cliente por mes. Válida todos los días JUEVES com"
 },
 "supervielleJub": {
  "banks": [
   {
    "name": "supervielle"
   }
  ],
  "websites": [
   "discoargentina",
   "jumboargentinaio",
   "jumboargentina"
  ],
  "days": [
   "2"
  ],
  "discount": "25.00",
  "discountText": "",
  "dateStart": "1675220700",
  "dateEnd": "1790823540",
  "info": "MARTES JUBILADOS\r\nVálido para compras presenciales\r\n25% de ahorro con tope mensual por cuenta de $25.000 para pagos con TD de jubilados.",
  "legals": "JUBILADO: CARTERA CONSUMO. Banco Supervielle S.A., Reconquista 330, C.A.B.A., CUIT 33-50000517-9, Inscrip. I.G.J. N° 23, F° 502, L. 45, T° A de Estatutos Nac. (“el Banco”). Vigente en la República Arg"
 },
 "mediosVea": {
  "banks": [
   {
    "name": "Medios de Pago"
   }
  ],
  "websites": [
   "veaargentina"
  ],
  "days": [
   "2"
  ],
  "discount": "10.00",
  "discountText": "",
  "dateStart": "1625108400",
  "dateEnd": "1798772340",
  "info": "Comprando los días martes. Exclusivo para compras presenciales, en Vea.com.ar y telefónicas llamando al 0810-999-9832. 10% de descuento para Jubilados y mayores de 60 años presentando tu Vea Ahorro. Beneficio adicional: 15% de descuento con Cencopay. No acumulable con otras ofertas o promociones vigentes.\r\n5% de reintegro PAGANDO EXCLUSIVAMENTE CON MODO BNA+ hasta el 30/09/2026.",
  "legals": "Promoción válida todos los martes en las sucursales adheridas de Vea del país y para compras realizadas en Vea.com.ar. Beneficio exclusivo para Jubilados y Pensionados que acrediten su condición prese"
 },
 "hipotecario": {
  "banks": [
   {
    "name": "Banco Hipotecario"
   }
  ],
  "websites": [
   "veaargentina",
   "discoargentina",
   "jumboargentinaio"
  ],
  "days": [
   "2"
  ],
  "discount": "25.00",
  "discountText": "",
  "dateStart": "1675220400",
  "dateEnd": "1735614000",
  "info": "VÁLIDO PRESENCIAL | Todos los Martes\r\n25% de descuento con tarjeta de debito y crédito – Desde App Hipotecario o App Modo.\r\nTOPE DE REINTEGRO $10.000 POR CUENTA POR MES.",
  "legals": "PROMOCIÓN VÁLIDA EN LA REPÚBLICA ARGENTINA LOS DÍAS MARTES DESDE EL 01/06/2024 HASTA EL 31/12/2024, PARA CONSUMOS EFECTUADOS EN LOS COMERCIOS INDICADOS EN LA PIEZA REALIZANDO UN PAGO QR CON TARJETA DE"
 }
};
const DIA_CARDS = [
 {
  "__editorItemTitle": "Anses",
  "active": true,
  "daysToShow": {
   "monday": true,
   "tuesday": false,
   "wednesday": false,
   "thursday": false,
   "friday": false,
   "saturday": false,
   "sunday": false,
   "all": true
  },
  "availableOn": {
   "online": false,
   "store": true,
   "all": true
  },
  "associatedBanks": [
   {
    "__editorItemTitle": "Anses"
   }
  ],
  "terms": "\"VALIDA PARA TODAS LAS TIENDAS DIA DEL PAÍS EXCEPTO LAS FRANQUICIAS TRADICIONALES (*). PROMOCIÓN ACUMULABLE CON LOS DESCUENTO DE FIDELIZACIÓN. EL DESCUENTO NO SE REALIZA EN LA LÍNEA DE CAJAS SINO QUE SE REINTEGRARÁ EN LA TARJETA DENTRO DE LOS 10 DÍAS HÁBILES DESDE LA FECHA DE COMPRA. ANSES LIMITARÁ SU RESPONSABILIDAD EXCLUSIVAMENTE A LA PROMOCIÓN, PUBLICIDAD Y DIFUSIÓN DE PRODUCTOS Y/O SERVICIOS OFERTADOS POR LOS COMERCIOS ADHERIDOS AL PROGRAMA DE BENEFICIOS ANSES. ANSES NO ES INTERMEDIARIO DE LA OFERTA Y NO SERÁ RESPONSABLE POR LOS DAÑOS Y PERJUICIOS QUE PUDIERAN SUFRIR LOS BENEFICIARIOS DEL PROGRAMA. ANSES PONDRÁ A DISPOSICIÓN DEL COMERCIO ADHERIDO UNA HERRAMIENTA EXCLUSIVAMENTE PROMOCIONAL PARA LA PROMOCIÓN DE SUS PRODUCTOS Y/O SERVICIOS; Y PARA LA VALIDACIÓN DE SUS CLIENTES COMO BENEFICIARIOS DEL PROGRAMA. ANSES NO SERÁ RESPONSABLE POR LA APLICACIÓN DE LOS DESCUENTOS PROMOCIONADOS. D"
 },
 {
  "__editorItemTitle": "20% - MODO",
  "active": true,
  "daysToShow": {
   "monday": false,
   "tuesday": false,
   "wednesday": false,
   "thursday": false,
   "friday": true,
   "saturday": true,
   "sunday": false,
   "all": true
  },
  "availableOn": {
   "online": true,
   "store": true,
   "all": true
  },
  "associatedBanks": [
   {
    "__editorItemTitle": "Modo"
   }
  ],
  "terms": "PROMOCIÓN ORGANIZADA POR PLAY DIGITAL S.A., CUIT 30-71682943-6, CON DOMICILIO EN AV. DEL LIBERTADOR 7208, TORRE PRINCIPAL, PISO 3, OFICINA 3.1 CABA (“PDSA”). SERÁN IGUALMENTE DE APLICACIÓN A ESTA PROMOCIÓN LOS TÉRMINOS Y CONDICIONES DE LA APP MODO DISPONIBLES EN HTTPS://WWW.MODO.COM.AR/TERMINOS-Y-CONDICIONES-APP-MODO.\n\nVIGENCIA\nDESDE LAS 00:00  HORAS DEL DÍA 01 DE MAYO  DE 2026  HASTA LAS 23:59 HORAS DEL DÍA 31 DE MAYO DE 2026,AMBAS FECHAS INCLUSIVE O HASTA ALCANZAR LA SUMA DE $3.086.208.000 (PESOS TRES MIL OCHENTA Y SEIS MILLONES DOSCIENTOS OCHO MIL) EN CONCEPTO DE REINTEGROS OTORGADOS A LOS USUARIOS (LO QUE OCURRA PRIMERO).\n\nELEGIBILIDAD\nAPLICABLE A TODAS LAS PERSONAS HUMANAS QUE CUMPLAN CON LA TOTALIDAD DE LOS SIGUIENTES REQUISITOS: \n\n3.1 \tREALICEN UN PAGO POR UN MONTO MAYOR O IGUAL A $35.000 (TREINTA Y CINCO MIL PESOS) LOS DÍAS VIERNES Y SÁBADOS EN LOS COMERCIOS ADHERIDOS (VER LISTAD"
 },
 {
  "__editorItemTitle": "5% BNA MODO",
  "active": true,
  "daysToShow": {
   "monday": true,
   "tuesday": true,
   "wednesday": true,
   "thursday": true,
   "friday": true,
   "saturday": false,
   "sunday": false,
   "all": true
  },
  "availableOn": {
   "online": false,
   "store": true,
   "all": true
  },
  "associatedBanks": [
   {
    "__editorItemTitle": "Modo"
   },
   {
    "__editorItemTitle": "BNA"
   }
  ],
  "terms": "BNA JUBILADOS 5%\n\nPROMOCIÓN VÁLIDA EN LA REPÚBLICA ARGENTINA TODOS LOS DÍAS LUNES, MARTES, MIÉRCOLES, JUEVES Y VIERNES DESDE EL 01/01/2026 HASTA EL 30/06/2026 PARA COMPRAS CON TARJETAS DE CRÉDITO VISA Y MASTERCARD Y TARJETAS DE DÉBITO MASTERCARD DÉBITO DEL BANCO NACIÓN PAGANDO EXCLUSIVAMENTE CON MODO BNA+ ESCANEANDO QR MODO EN COMERCIOS ADHERIDOS. TOPE DE DEVOLUCIÓN: HASTA $ 5.000 POR CLIENTE (SE CONSIDERA CLIENTE PARA EL BNA EL CUIT) POR CADA SEMANA (SE CONSIDERA SEMANA PARA EL BNA DE LUNES A DOMINGOS), DURANTE LA VIGENCIA DE LA PROMO, TOPE MÁXIMO DE DEVOLUCIÓN POR MES (SE CONSIDERA MES DEL PRIMERO AL ÚLTIMO DÍA DE CADA MES CALENDARIO) HASTA $ 20.000. EL BENEFICIO APLICA ÚNICAMENTE PARA EL CLIENTE SELECCIONADO QUE COBRE SUS HABERES JUBILATORIOS DE ANSES MEDIANTE UNA CUENTA MONETARIA DEL BNA. EL BENEFICIO NO ES TRANSFERIBLE. EL DESCUENTO SE VERÁ REFLEJADO EN EN LA CUENTA MONETARIA ASOCIA"
 }
];

const respuesta = body => ({ ok: true, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
const aDocs = objetos => ({ data: { documents: objetos.map(o => ({ fields: Object.entries(o).map(([key, value]) => ({ key, value })) })) } });
function mockVTEX({ promos, bancos }) {
  globalThis.fetch = async url => {
    if (String(url).includes('GetBanks')) return respuesta(aDocs(bancos));
    if (String(url).includes('GetCards')) return respuesta(aDocs([]));
    return respuesta(aDocs(promos));
  };
}
const mockCencosud = entradas => { globalThis.fetch = async () => respuesta({ value: JSON.stringify(entradas) }); };
const mockCoto = () => { globalThis.fetch = async () => respuesta({ result: COTO }); };
// Día: el fetch busca el bloque de CMS por su marca dentro del HTML.
const mockDia = () => {
  const html = `<script>{"landing-medios-pago#props":{"x":1},"props":${JSON.stringify({ cards: DIA_CARDS })}}</script>`;
  globalThis.fetch = async () => respuesta(html);
};

const VIGENCIA = { vigenciaDesde: new Date('2020-01-01'), vigenciaHasta: new Date('2099-01-01') };
const TODOS_LOS_DIAS = [1, 2, 3, 4, 5, 6, 7];
const resumen = p => `${p.canonicosPosibles.join('+') || '-'}${p.requisitos.length ? ` [${p.requisitos.join('+')}]` : ''}`;
const hoyTodos = p => ({ ...p, dias: TODOS_LOS_DIAS, ...VIGENCIA });

// ─── 1. "<Banco> Modo" ───────────────────────────────────────────────────────
describe('1. "<Banco> Modo" es su propio canónico', () => {
  const nombres = [
    ['ICBC Modo', 'ICBC Modo'],
    ['Banco Credicoop MODO', 'Credicoop Modo'],
    ['Hipotecario_Modo', 'Hipotecario Modo'],
    ['Yoy_MODO', 'Yoy Modo'],
    ['Banco_Comafi_MODO', 'Comafi Modo'],
    ['BNA+MODO', 'Banco Nación Modo'],
    ['Supervielle Modo', 'Supervielle Modo'],
    ['Galicia Modo', 'Galicia Modo'],
    ['Macro Modo', null], // "Macro" a secas no es alias de Banco Macro (queda como estaba)
    ['Banco San Juan MODO', null],
    ['Semana_MODO', null],
    ['Yoy', null], // Yoy a secas no tiene canónico
  ];
  for (const [nombre, esperado] of nombres) {
    test(`"${nombre}" → ${esperado ?? 'descartada'}`, () => {
      assert.deepEqual(pb.resolverTarjetasPromo([nombre]).canonicosPosibles, esperado ? [esperado] : []);
    });
  }

  test('Día "Modo|BNA" (dos nombres en la misma entrada) → "Banco Nación Modo", no "MODO o Banco Nación"', () => {
    assert.deepEqual(pb.resolverTarjetasPromo(['Modo', 'BNA']).canonicosPosibles, ['Banco Nación Modo']);
  });

  test('texto corto que exige MODO convierte el banco (Carrefour BNA, Cencosud Galicia/Hipotecario)', () => {
    assert.deepEqual(pb.resolverTarjetasPromo(['Banco_Nacion'], CARR.promos[1].title).canonicosPosibles, ['Banco Nación Modo']);
    assert.deepEqual(pb.resolverTarjetasPromo(['Galicia'], CENCOSUD.galicia20.info).canonicosPosibles, ['Galicia Modo']);
    assert.deepEqual(pb.resolverTarjetasPromo(['Banco Hipotecario'], CENCOSUD.hipotecario.info).canonicosPosibles, ['Hipotecario Modo']);
  });

  test('menciones de MODO de pasada no convierten ("acumulable … pagando con MODO", "no aplica … modo")', () => {
    assert.equal(pb.textoExigeModo('El beneficio es acumulable con otras promociones vigentes que apliquen pagando con MODO.'), false);
    assert.equal(pb.textoExigeModo('Aplica para tarjetas de crédito Visa, Mastercard y American Express emitidas por Banco Macro. No aplica a pagos realizados con tarjetas Agro/Empresa, MercadoPago/ modo, Transferencias 3.0'), false);
    assert.equal(pb.textoExigeModo('Con tarjetas de Crédito Visa y MasterCard'), false);
  });

  test('match: "ICBC Modo" solo para quien marca "ICBC Modo" (ni MODO, ni ICBC, ni los dos)', async () => {
    mockVTEX(CM);
    const datos = { changomas: await pb.fetchChangoMas() };
    const conIcbcModo = p => p.canonicosPosibles.includes('ICBC Modo');
    for (const tarjetas of [['MODO'], ['ICBC'], ['MODO', 'ICBC']]) {
      assert.equal(pb.filtrarPromosBancariasPorTarjetas(datos, tarjetas).changomas.promos.filter(conIcbcModo).length, 0, tarjetas.join());
    }
    const propias = pb.filtrarPromosBancariasPorTarjetas(datos, ['ICBC Modo']).changomas.promos;
    assert.deepEqual(propias.map(p => p.bancoCanonico), ['ICBC Modo']);
    assert.equal(propias[0].descuentoPct, 0.2);
  });

  test('Chango Más: todas las MODO + banco del feed quedan como "<Banco> Modo"', async () => {
    mockVTEX(CM);
    const { promos } = await pb.fetchChangoMas();
    const modos = promos.map(p => p.canonicosPosibles.join('+')).filter(c => /modo/i.test(c)).sort();
    assert.deepEqual(modos, ['Comafi Modo', 'Hipotecario Modo', 'ICBC Modo', 'MODO', 'Yoy Modo']);
    assert.ok(!promos.some(p => 'requiereTodas' in p), 'ya no existe requiereTodas');
  });

  test('Cencosud: Galicia 20% "QR de Modo desde app Galicia" → Galicia Modo (antes: cualquier Galicia)', async () => {
    mockCencosud([CENCOSUD.galicia20, CENCOSUD.hipotecario]);
    const { promos } = await pb.fetchJumbo();
    assert.deepEqual(promos.map(resumen), ['Galicia Modo', 'Hipotecario Modo']);
  });

  test('Galicia Modo sigue siendo el mismo string (hay usuarios que lo tienen guardado)', () => {
    assert.ok(pb.TARJETAS_CONOCIDAS.includes('Galicia Modo'));
    assert.equal(pb.TARJETAS_CONOCIDAS.indexOf('Galicia Modo'), pb.TARJETAS_CONOCIDAS.indexOf('Galicia') + 1);
  });
});

// ─── 2. Segmentos ────────────────────────────────────────────────────────────
describe('2. segmentos del cliente (solo campos cortos)', () => {
  const casos = [
    // Carrefour
    ['10% de descuento si sos parte de Mi Carrefour y beneficiario de Anses o mayor de 60 años.', ['Jubilado']],
    ['5% de Ahorro, si sos jubilado o pensionado, en el acto con tarjetas de crédito visa y mastercard y tarjetas de débito mastercard. Exclusivo pagando con Modo.', ['Jubilado']],
    ['Si sos empleado/a público todos los jueves', ['Empleado público']],
    ['Si sos empleada/o público todos los miércoles', ['Empleado público']],
    ['Tope de devolución (POR MES Y POR CUENTA) $10.000 - Exclusivo para clientes con plan sueldo. Ver exclusiones en el legal.', ['Plan sueldo']],
    // Cuenta DNI general: el jubilado es un tope/adicional, no el segmento de la promo
    ['10% de descuento en tu compra con Cuenta DNI ¡Sin Tope!. Y si sos jubilado, tenes 5% de descuento adicional.. Mínimo de compra $15.000. Promoción acumulable. Si sos jubilado tope de $5.000. Ver exclusiones en el legal', []],
    ['30% de ahorro en el acto con tarjetas de crédito visa y mastercard. Si sos jubilado, 5% de ahorro adicional.. Exclusivo pagando con MODO. Tope de devolucion semanal: $12.000. 5% adicional jubilados. Tope semanal: $5000.', []],
    // Chango Más
    ['Hipotecario_Modo. Con tarjeta Visa débito. Tope mensual: $10.000 para Cartera General y $30.000 para Búho One, Sueldo, Emprededor y Jubilado. (H)', []],
    ['Banco Supervielle. Exclusivo Jubilados - Con Visa débito. Tope: $25.000 mensual. (S2)*', ['Jubilado']],
    ['ICBC_Sueldos. Con tarjetas de Crédito y débito (Cuenta Sueldo). Tope: $15.000 semanal. (ICS)*', ['Plan sueldo']],
    ['Anses. Todos los medios de pago.. Tope: $12.000 por transacción. No acumulable con otras promociones. Aplican exclusiones.(A)*', ['Jubilado']],
    ['Empleados Públicos. Todos los medios de pago. Tope: $12.000 por transacción. Excluye sucursal Luján. (EM)*', ['Empleado público']],
    // Coto (descripcion)
    ['PLAN SUELDO En un pago con tarjetas de crédito Visa, Mastercard y Visa débito.', ['Plan sueldo']],
    ['SGTO IDENTITÉ En un pago con tarjetas de crédito Visa y Mastercard.', ['Supervielle Identité']],
    // Cencosud (info)
    ['MARTES JUBILADOS Válido para compras presenciales 25% de ahorro con tope mensual por cuenta de $25.000 para pagos con TD de jubilados.', ['Jubilado']],
    // MasGO
    ['Tope: $20.000 por cliente por mes. Mínmo de compra $30.000. Promoción exlusiva en las tiendas de MASGO. (MODO-MG)', ['MasGO']],
    ['Exclusivo MasGo ¡SIN TOPE!. Promoción exclusiva para socios de masclub.', ['MasGO']],
  ];
  for (const [texto, esperado] of casos) {
    test(`"${texto.slice(0, 70)}…" → [${esperado.join(', ')}]`, () => assert.deepEqual(pb.requisitosDeTexto(texto), esperado));
  }

  test('el legal completo NO se mira: Cuenta DNI en Carrefour (legal con "si sos jubilado") queda general', async () => {
    mockVTEX(CARR);
    const { promos } = await pb.fetchCarrefour();
    const dni = promos.find(p => p.canonicosPosibles.includes('Cuenta DNI'));
    assert.deepEqual(dni.requisitos, []);
  });

  test('Carrefour: Mi Carrefour ANSES/+60 y BNA 5% jubilados exigen tarjeta + Jubilado; empleados públicos exige solo el segmento', async () => {
    mockVTEX(CARR);
    const { promos } = await pb.fetchCarrefour();
    const r = promos.map(resumen);
    assert.ok(r.includes('Mi Carrefour [Jubilado]'));
    assert.ok(r.includes('Banco Nación Modo [Jubilado]'));
    assert.ok(r.includes('- [Empleado público]'));
    assert.ok(r.includes('Cuenta DNI'));
    // Patagonia "plan sueldo" sigue sin alias (decisión pendiente por niveles) → no aparece
    assert.ok(!r.some(x => /patagonia/i.test(x)));
  });

  test('Chango Más: Supervielle jubilados, ICBC_Sueldos, Anses y Empleados Públicos', async () => {
    mockVTEX(CM);
    const r = (await pb.fetchChangoMas()).promos.map(resumen);
    for (const esperado of ['Supervielle [Jubilado]', 'ICBC [Plan sueldo]', '- [Jubilado]', '- [Empleado público]', 'Hipotecario Modo']) {
      assert.ok(r.includes(esperado), esperado);
    }
  });

  test('Coto: jubilados/ANSES por ícono (sin banco), ICBC plan sueldo, Supervielle Identité; ciudadanía porteña sigue afuera', async () => {
    mockCoto();
    const r = (await pb.fetchCoto()).promos.map(p => `${resumen(p)}/${p.canales[0]}/${Math.round(p.descuentoPct * 100)}`);
    for (const esperado of ['- [Jubilado]/tienda/15', '- [Jubilado]/tienda/10', 'ICBC [Plan sueldo]/ecommerce/30',
      'Supervielle [Supervielle Identité]/ecommerce/25', 'Supervielle/ecommerce/20', 'Supervielle Modo/tienda/25']) {
      assert.ok(r.includes(esperado), esperado);
    }
    assert.equal(r.filter(x => x.startsWith('- ')).length, 4, 'jubilados + 2 ANSES + comunidad; sin ciudadanía porteña');
  });

  test('Día: BNA 5% jubilados ("Modo|BNA", % del título) → Banco Nación Modo + Jubilado; Anses sin % sigue afuera', async () => {
    mockDia();
    const { promos } = await pb.fetchDia();
    const r = promos.map(p => `${resumen(p)}/${Math.round(p.descuentoPct * 100)}`);
    assert.deepEqual(r.sort(), ['Banco Nación Modo [Jubilado]/5', 'MODO/20']);
  });

  test('Cencosud: "Medios de Pago" jubilados (Vea) solo exige Jubilado; Supervielle "MARTES JUBILADOS" exige las dos', async () => {
    mockCencosud([CENCOSUD.mediosVea, CENCOSUD.supervielleJub]);
    const vea = (await pb.fetchVea()).promos.map(resumen);
    assert.deepEqual(vea, ['- [Jubilado]']);
    mockCencosud([CENCOSUD.mediosVea, CENCOSUD.supervielleJub]);
    const jumbo = (await pb.fetchJumbo()).promos.map(resumen);
    assert.deepEqual(jumbo, ['Supervielle [Jubilado]']);
  });

  test('una promo de jubilados de un banco que la app no modela NO se regala a todos los jubilados', () => {
    assert.equal(pb.clasificarPromo(['Banco Santa Fe'], 'MARTES JUBILADOS 20% de descuento'), null);
    assert.deepEqual(pb.clasificarPromo(['Medios de Pago'], '10% de descuento para Jubilados y mayores de 60 años'), { canonicosPosibles: [], requisitos: ['Jubilado'] });
  });
});

// ─── 3-6. Match de requisitos, Billeteras, MasGO, Comunidad, todos los medios ─
describe('3-6. match por tarjetas + requisitos', () => {
  const promo = (canonicosPosibles, requisitos) => hoyTodos({ canonicosPosibles, requisitos, descuentoPct: 0.1 });

  test('banco + segmento exige los dos; solo segmento exige solo el segmento; general del banco no se restringe', () => {
    const supervielleJub = promo(['Supervielle'], ['Jubilado']);
    const soloJub = promo([], ['Jubilado']);
    const supervielle = promo(['Supervielle'], []);
    assert.equal(pb.promoAplicaATarjetas(supervielleJub, ['Supervielle']), false);
    assert.equal(pb.promoAplicaATarjetas(supervielleJub, ['Jubilado']), false);
    assert.equal(pb.promoAplicaATarjetas(supervielleJub, ['Supervielle', 'Jubilado']), true);
    assert.equal(pb.promoAplicaATarjetas(soloJub, ['Jubilado']), true);
    assert.equal(pb.promoAplicaATarjetas(soloJub, ['Supervielle']), false);
    assert.equal(pb.promoAplicaATarjetas(supervielle, ['Supervielle']), true);
    assert.equal(pb.etiquetaTarjetas(supervielleJub, ['Supervielle', 'Jubilado']), 'Supervielle (Jubilado)');
    assert.equal(pb.etiquetaTarjetas(soloJub, ['Jubilado']), 'cualquier medio de pago (Jubilado)');
  });

  test('3. "Billeteras Virtuales" (Chango Más, 15% vie-dom QR) = Mercado Pago', async () => {
    assert.deepEqual(pb.resolverCanonicosDesdeNombre('Billeteras Virtuales'), ['Mercado Pago']);
    mockVTEX(CM);
    const mp = (await pb.fetchChangoMas()).promos.filter(p => p.canonicosPosibles.join() === 'Mercado Pago');
    assert.deepEqual(mp.map(p => p.dias.join('')), ['567']);
  });

  test('4. MasGO: MasClub 20%, Banco Ciudad 35% y MODO domingo 20% exigen la tarjeta + MasGO; MasClub 15% general no', async () => {
    mockVTEX(CM);
    const datos = { changomas: await pb.fetchChangoMas() };
    const masgo = datos.changomas.promos.filter(p => p.requisitos.includes('MasGO')).map(p => `${p.canonicosPosibles.join('+')} ${Math.round(p.descuentoPct * 100)}`).sort();
    assert.deepEqual(masgo, ['Banco Ciudad 35', 'MODO 20', 'MasClub 20']);
    const sinMasgo = pb.filtrarPromosBancariasPorTarjetas(datos, ['MasClub', 'Banco Ciudad']).changomas.promos;
    assert.deepEqual(sinMasgo.map(p => p.descuentoPct), [0.15], 'sin MasGO marcado solo queda MasClub 15%');
    const conMasgo = pb.filtrarPromosBancariasPorTarjetas(datos, ['MasClub', 'Banco Ciudad', 'MasGO']).changomas.promos;
    assert.equal(conMasgo.length, 3);
  });

  test('5. Comunidad Coto: 15% miércoles en sucursales, solo para quien marca "Comunidad Coto"', async () => {
    mockCoto();
    const datos = { coto: await pb.fetchCoto() };
    const comunidad = datos.coto.promos.filter(p => p.requisitos.includes('Comunidad Coto'));
    assert.equal(comunidad.length, 1);
    assert.deepEqual([comunidad[0].descuentoPct, comunidad[0].dias, comunidad[0].canales, comunidad[0].canonicosPosibles], [0.15, [3], ['tienda'], []]);
    assert.equal(pb.filtrarPromosBancariasPorTarjetas(datos, ['MODO']).coto.promos.some(p => p.requisitos.includes('Comunidad Coto')), false);
    assert.equal(pb.filtrarPromosBancariasPorTarjetas(datos, ['Comunidad Coto']).coto.promos.length, 1);
    assert.ok(pb.TARJETAS_CONOCIDAS.includes('Comunidad Coto'));
  });

  test('6. Carrefour "10% OFF Todos los Medios de Pago - EXCLUSIVO ONLINE": para todos, solo online, tope $8.000', async () => {
    mockVTEX(CARR);
    const datos = { carr: await pb.fetchCarrefour() };
    const todos = datos.carr.promos.filter(p => !p.canonicosPosibles.length && !p.requisitos.length);
    assert.equal(todos.length, 1);
    assert.deepEqual([todos[0].descuentoPct, todos[0].dias, todos[0].tope], [0.1, [4], 8000]);
    assert.ok(pb.promoBancariaRequiereOnline(todos[0]));
    // Sin ninguna tarjeta marcada igual aplica
    const sinTarjetas = pb.filtrarPromosBancariasPorTarjetas(datos, []).carr.promos;
    assert.deepEqual(sinTarjetas.map(p => p.bancoCanonico), ['cualquier medio de pago']);
  });

  test('6. comparar.js: sin tarjetas, el 10% de todos los medios se aplica y marca REQUIERE COMPRAR ONLINE', async () => {
    mockVTEX(CARR);
    const { promos } = await pb.fetchCarrefour();
    const todos = promos.find(p => !p.canonicosPosibles.length && !p.requisitos.length);
    const supers = [{ key: 'carr', nombre: 'Carrefour' }];
    const res = calcularResumenFinal([
      { input: 'A', cantidad: 1, ambiguo: false, mejores: { carr: { total: 50000, esOnlineExclusivo: false, ean: '1', sinOferta: true } } },
    ], supers);
    const datos = pb.filtrarPromosBancariasPorTarjetas({ carr: { promos: [hoyTodos(todos)], error: null } }, []);
    const bancario = compararTest.aplicarPromosBancarias(res, supers, [], datos, []);
    assert.equal(bancario.porSuper.carr.descuento, 5000);
    assert.equal(bancario.porSuper.carr.soloOnline, true);
    assert.equal(bancario.porSuper.carr.tarjeta, 'cualquier medio de pago');
    assert.equal(res.requiereOnlinePorSuper.carr, true);
  });

  test('no mete financiación: "Todos los medios" sin % (cuotas) sigue descartado', async () => {
    mockVTEX({ promos: [{ ...CARR.promos[4], discount_percentage: 'null', title: '3 cuotas sin interés con todos los medios de pago' }], bancos: [] });
    assert.equal((await pb.fetchCarrefour()).promos.length, 0);
  });
});

// ─── Mis descuentos / grilla / opciones ──────────────────────────────────────
describe('opciones de Mis descuentos, grilla y compatibilidad', () => {
  test('TARJETAS_CONOCIDAS: "<Banco> Modo" después de su banco, segmentos y programas al final, sin duplicados', () => {
    const t = pb.TARJETAS_CONOCIDAS;
    assert.equal(new Set(t).size, t.length);
    for (const nombre of ['ICBC Modo', 'Comafi Modo', 'Credicoop Modo', 'Hipotecario Modo', 'Supervielle Modo', 'Banco Ciudad Modo', 'Yoy Modo', 'Banco Nación Modo',
      'Jubilado', 'Plan sueldo', 'Empleado público', 'Supervielle Identité', 'MasGO', 'Comunidad Coto']) {
      assert.ok(t.includes(nombre), nombre);
    }
    assert.equal(t.indexOf('ICBC Modo'), t.indexOf('ICBC') + 1);
    assert.deepEqual(t.slice(-6), ['Jubilado', 'Plan sueldo', 'Empleado público', 'Supervielle Identité', 'MasGO', 'Comunidad Coto']);
  });

  test('misDescuentos lista las promos bajo su tarjeta Y bajo su requisito (ICBC Modo no aparece bajo MODO)', async () => {
    mockVTEX(CM);
    const datos = { changomas: await pb.fetchChangoMas() };
    const { descuentos } = misDescuentosTest.calcularDescuentos(datos);
    const de = nombre => descuentos.find(d => d.nombre === nombre);
    assert.equal(de('ICBC Modo').descuentoPct, 0.2);
    assert.equal(de('MasGO').descuentoPct, 0.35);
    assert.equal(de('Empleado público').descuentoPct, 0.1);
    assert.equal(de('MODO').descuentoPct, 0.2); // MODO genérico (lunes / domingo MasGO), no el 30% de Credicoop Modo
    assert.equal(de('Comafi Modo').descuentoPct, 0.2);
    assert.equal(de('Comafi').descuentoPct, null, 'Comafi Modo no se lista bajo Comafi');
  });

  test('grilla: propias primero; entre las ajenas, las sin requisito antes (MasClub 15% general antes que 20% MasGO)', () => {
    const promos = [
      hoyTodos({ canonicosPosibles: ['MasClub'], requisitos: ['MasGO'], descuentoPct: 0.2 }),
      hoyTodos({ canonicosPosibles: ['MasClub'], requisitos: [], descuentoPct: 0.15 }),
      hoyTodos({ canonicosPosibles: [], requisitos: ['Jubilado'], descuentoPct: 0.1 }),
    ];
    assert.deepEqual(grillaTest.elegirPromosDelDia(promos, 3, []), [{ banco: 'MasClub', pct: 0.15 }, { banco: 'Jubilado', pct: 0.1 }]);
    assert.deepEqual(grillaTest.elegirPromosDelDia(promos, 3, ['MasClub', 'MasGO', 'Jubilado']), [{ banco: 'MasClub', pct: 0.2 }, { banco: 'Jubilado', pct: 0.1 }]);
  });

  test('compatibilidad con un cache viejo (MODO + banco con requiereTodas) hasta que corra el cron', () => {
    const vieja = { canonicosPosibles: ['ICBC', 'MODO'], requiereTodas: true };
    assert.equal(pb.promoAplicaATarjetas(vieja, ['MODO']), false);
    assert.equal(pb.promoAplicaATarjetas(vieja, ['MODO', 'ICBC']), true);
  });

  test('TARJETAS_DISPONIBLES de la app tiene exactamente los mismos strings que TARJETAS_CONOCIDAS', () => {
    const fuente = require('fs').readFileSync(require('path').join(__dirname, '../../app/src/carrito.tsx'), 'utf8');
    const bloque = fuente.slice(fuente.indexOf('export const TARJETAS_DISPONIBLES'), fuente.indexOf('];', fuente.indexOf('export const TARJETAS_DISPONIBLES')));
    const app = [...bloque.replace(/\/\/.*$/gm, '').matchAll(/'([^']+)'/g)].map(m => m[1]);
    assert.deepEqual([...app].sort(), [...pb.TARJETAS_CONOCIDAS].sort());
  });
});
