/**
 * Cliente del backend de AllPromos.
 *
 * La app nunca habla directo con las APIs de los supermercados: la cookie de sesión de Vea
 * no debe viajar dentro de un binario distribuido, y concentrar las consultas en el backend
 * permite controlar el ritmo de requests en un solo lugar en vez de en cada teléfono.
 */

export type SuperKey = 'vea' | 'carr' | 'changomas' | 'dia' | 'coto';

export type Supermercado = { key: SuperKey; nombre: string; tag: string };

export type ProductoCatalogo = {
  ean: string;
  nombre: string;
  variante: string | null;
  categoria: string | null;
  disponibleEn: SuperKey[];
  /** Ruta relativa a `configApi.urlBase` (ej. "/imagenes/779...jpg"), o null si no hay foto
   *  todavía. Ver src/componentes/FotoProducto.tsx para el fallback. */
  imagen: string | null;
};

export type Promo = {
  tipo: string;
  descripcion: string;
  cantidadMinima: number;
  esOnline: boolean;
  requiereTarjeta: string | null;
  activa: boolean;
  /** false cuando la promo pide una tarjeta que no está en las seleccionadas: existe, pero
   *  no está contada en `total` — es un aviso, no una promesa de precio. */
  tarjetaActiva: boolean;
};

export type OpcionSuper = {
  key: SuperKey;
  super: string;
  tag: string;
  total: number;
  precioUnitario: number;
  productoNombre: string;
  variante: string | null;
  promo: Promo | null;
  /** Lo que pagarías en este super si activaras la tarjeta que pide `promo`. Solo viene
   *  poblado cuando hay una promo de tarjeta sin activar. */
  totalConTarjeta: number | null;
};

export type VistaPreviaCantidad = {
  cantidad: number;
  opciones: { key: SuperKey; nombre: string; tag: string; total: number; oferta: string }[];
};

export type ItemComparado = {
  ean: string;
  nombre: string | null;
  imagen: string | null;
  cantidad: number;
  enCatalogoLocal: boolean;
  opciones: OpcionSuper[];
  mejor: OpcionSuper | null;
  sugerenciaCantidad: {
    cantidadesCandidatas: number[];
    vistaPrevia: VistaPreviaCantidad[];
  } | null;
  error: string | null;
};

export type RespuestaComparar = {
  generado: string;
  supermercados: Supermercado[];
  items: ItemComparado[];
  resumen: {
    totalOptimo: number;
    totalesPorSuper: Record<SuperKey, number>;
    subtotalAsignadoPorSuper: Record<SuperKey, number>;
    comprasPorSuper: Record<SuperKey, { input: string; esOnlineExclusivo: boolean }[]>;
    requiereOnlinePorSuper: Record<SuperKey, boolean>;
    noEncontrados: string[];
    /** Link para abrir el carrito ya cargado en el sitio real del super (VTEX). `null` si el
     *  super no lo soporta (Coto) o no tiene nada asignado. */
    linksCarrito: Record<SuperKey, string | null>;
  };
  advertencias: string[];
};

/** Respuesta liviana de /api/precios: solo el mejor precio + oferta, sin el desglose de los 5 supers. */
export type PrecioRapido = {
  ean: string;
  mejor: { key: SuperKey; super: string; tag: string; total: number } | null;
  oferta: string | null;
  esOnline: boolean;
};

export type EstadoSalud = {
  ok: boolean;
  entorno: string;
  ahora: string;
  catalogos: {
    key: string; archivo: string; scraper: string; fecha: string | null;
    dias: number | null; totalSkus: number; disponible: boolean; vencido: boolean;
  }[];
  catalogoUnificado: { disponible: boolean; total: number; generado: string | null };
  problemas: string[];
};

const URL_BASE = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000').replace(/\/$/, '');

export class ErrorApi extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'ErrorApi';
  }
}

async function pedir<T>(ruta: string, init?: RequestInit): Promise<T> {
  let respuesta: Response;
  try {
    respuesta = await fetch(`${URL_BASE}${ruta}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    // Distinguir "no hay red / backend caído" de "el backend contestó un error" importa:
    // el primero se arregla prendiendo el server, el segundo mirando la respuesta.
    throw new ErrorApi('No se pudo conectar con el servidor de AllPromos');
  }

  if (!respuesta.ok) {
    let detalle = `Error ${respuesta.status}`;
    try {
      const cuerpo = await respuesta.json();
      if (cuerpo?.error) detalle = cuerpo.error;
    } catch {
      /* la respuesta no era JSON: nos quedamos con el código */
    }
    throw new ErrorApi(detalle, respuesta.status);
  }

  return respuesta.json() as Promise<T>;
}

/** 'precio' (ordenar por precio en vivo) NO se le pasa al backend — lo resuelve la pantalla
 *  de búsqueda pidiendo precio de toda la lista y ordenando ella misma (ver index.tsx). */
export type OrdenBusqueda = 'alfabetico' | 'disponibilidad' | 'precio';

export function buscarProductos(q: string, opciones: {
  limit?: number; supers?: SuperKey[]; orden?: OrdenBusqueda;
} = {}) {
  const { limit = 40, supers, orden = 'alfabetico' } = opciones;
  const params = new URLSearchParams({
    q, limit: String(limit), orden: orden === 'precio' ? 'alfabetico' : orden,
  });
  if (supers && supers.length) params.set('supers', supers.join(','));
  return pedir<{ disponible: boolean; total: number; resultados: ProductoCatalogo[] }>(
    `/api/catalogo/buscar?${params.toString()}`
  );
}

export function comparar(
  items: { ean: string; cantidad: number }[], tarjetas: string[], supers?: SuperKey[]
) {
  return pedir<RespuestaComparar>('/api/comparar', {
    method: 'POST',
    body: JSON.stringify({ items, tarjetas, supers }),
  });
}

/** Máximo por lote — tiene que coincidir con MAX_EANS_PRECIOS del backend (routes/comparar.js). */
export const MAX_EANS_PRECIOS = 40;

export function precios(eans: string[], supers?: SuperKey[]) {
  return pedir<{ generado: string; resultados: PrecioRapido[] }>('/api/precios', {
    method: 'POST',
    body: JSON.stringify({ eans, supers }),
  });
}

export function salud() {
  return pedir<EstadoSalud>('/api/health');
}

/** Una fila de la pantalla Mis descuentos (turno 5a): qué desbloquea una tarjeta/app/club,
 *  agregado en vivo de las promos bancarias de Vea, Carrefour y Chango Más. `disponible:
 *  false` significa que hoy no hay ninguna promo vigente para esa tarjeta (no que no exista). */
export type Descuento = {
  nombre: string;
  disponible: boolean;
  descuentoPct: number | null;
  dias: string[];
  tope: number | null;
  supers: SuperKey[];
};

export function misDescuentos() {
  return pedir<{ generado: string; descuentos: Descuento[]; advertencias: string[] }>(
    '/api/mis-descuentos'
  );
}

/** `producto.imagen` es una ruta relativa (ej. "/imagenes/779...jpg") — esto la completa. */
export function urlImagen(ruta: string | null): string | null {
  return ruta ? `${URL_BASE}${ruta}` : null;
}

export const configApi = { urlBase: URL_BASE };
