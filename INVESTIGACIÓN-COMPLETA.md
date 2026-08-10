# 🔬 INVESTIGACIÓN COMPLETA: Descuentos VTEX Vea por API

**Estado:** 80% resuelto - necesitamos 1 pieza más

---

## ✅ LO QUE FUNCIONA

### 1. Endpoint de Promociones
```
POST https://www.vea.com.ar/_v/search-promotions
```

Obtiene los descuentos disponibles:

```bash
curl -X POST https://www.vea.com.ar/_v/search-promotions \
  -H "Content-Type: application/json" \
  -H "Cookie: vtex_segment=eyJjYW1wYWlnbnMiOm51bGwsImNoYW5uZWwiOiIzNCIsInByaWNlVGFibGVzIjpudWxsLCJyZWdpb25JZCI6IlUxY2phblZ0WW05aGNtZGxiblJwYm1GMk1UWXliSFZxWVc0PSIsInV0bV9jYW1wYWlnbiI6bnVsbCwidXRtX3NvdXJjZSI6bnVsbCwidXRtaV9jYW1wYWlnbiI6bnVsbCwiY3VycmVuY3lDb2RlIjoiQVJTIiwiY3VycmVuY3lTeW1ib2wiOiIkIiwiY291bnRyeUNvZGUiOiJBUkciLCJjdWx0dXJlSW5mbyI6ImVzLUFSIiwiYWRtaW5fY3VsdHVyZUluZm8iOiJlcy1BUiIsImNoYW5uZWxQcml2YWN5IjoicHVibGljIn0" \
  -d '{"seller":"jumboargentinav700cordoba700","skus":["331676"]}'
```

**Response:**
```json
{
  "promotions": {
    "generic": {
      "promotions": {
        "331676": {
          "name": "30% Leche UAT | Ecommerce",
          "code": "30%",
          "effectiveDiscount": "0.30"
        }
      }
    }
  }
}
```

✅ **COMPROBADO:** El descuento 30% está disponible

---

## ❌ LO QUE NO FUNCIONA

### Endpoint de Simulation (sin parámetro mágico)
```
POST https://www.vea.com.ar/api/checkout/pub/orderForms/simulation?sc=34
```

Devuelve subtotal pero **SIN aplicar descuentos**:

```bash
curl -X POST https://www.vea.com.ar/api/checkout/pub/orderForms/simulation?sc=34 \
  -H "Content-Type: application/json" \
  -H "Cookie: vtex_segment=..." \
  -d '{
    "items": [{
      "id": "331676",
      "quantity": 5,
      "seller": "jumboargentinav700cordoba700"
    }]
  }'
```

**Response:** `$11700` sin descuento (debería ser $8190 con descuento)

---

## 🔍 HIPÓTESIS: ¿QUÉ FALTA?

Hay varias opciones. Para resolver esto necesitamos capturar exactamente qué hace el navegador.

### Option A: Token/Cookie especial del usuario

Quizá la cookie `vtex_segment` en el navegador se modifica después de ir al carrito.

**Instrucciones:**
1. Abre el navegador y ve a https://www.vea.com.ar/checkout
2. Abre DevTools → Application → Cookies
3. Copia el valor COMPLETO de la cookie `vtex_segment`
4. Usa ESE valor, no el que tenemos

### Option B: El navegador usa GraphQL, no REST API

Los requests POST a `/_v/private/graphql/v1` sugerieren que el carrito se maneja con GraphQL.

### Option C: Hay un paso intermedio que nos falta

Posiblemente:
1. Agregar al carrito (mutation GraphQL)
2. El servidor calcula promociones
3. LUEGO puedo hacer simulation y obtener el descuento

---

## 🎯 INSTRUCCIONES PARA CAPTURAR EL REQUEST EXACTO

### Opción 1: Script Automático (RECOMENDADO)

1. Ve a https://www.vea.com.ar/leche-semi-descremada-1-lts-cuisine-co/p
2. Abre DevTools (F12) → Console
3. Copia y pega esto:

```javascript
(function() {
  const requests = [];
  const originalFetch = window.fetch;
  window.fetch = function(...args) {
    const [resource, config] = args;
    const url = typeof resource === 'string' ? resource : resource.url;
    if (url.includes('/api/') || url.includes('/_v/')) {
      requests.push({
        url, method: config?.method || 'GET',
        body: config?.body ? JSON.parse(config.body) : null
      });
    }
    return originalFetch.apply(this, args).then(r => {
      r.clone().json().then(data => {
        requests[requests.length-1].response = data;
      }).catch(() => {});
      return r;
    });
  };
  window.__capturedRequests = requests;
  console.log('✅ Captura iniciada. Ahora haz click en Agregar al carrito...');
  setTimeout(() => {
    console.log('📋 REQUESTS CAPTURADOS:');
    console.log(JSON.stringify(requests, null, 2));
    console.log('📋 O copia esto: copy(JSON.stringify(window.__capturedRequests, null, 2))');
  }, 3000);
})();
```

4. Haz click en "Agregar al carrito"
5. Espera 3 segundos
6. Copia el output

### Opción 2: DevTools Manual

1. Abre DevTools → Network
2. Filtra por "Fetch/XHR"
3. Haz click en "Agregar al carrito"
4. Busca requests que contengan:
   - "orderForm"
   - "simulation"
   - "checkout"
   - "graphql"
5. Para cada uno, anota:
   - **URL completa**
   - **Método** (POST/GET)
   - **Request Headers** (especialmente Cookie)
   - **Request Body/Payload**
   - **Response** (primeros 1000 caracteres)

---

## 📋 DATOS CONOCIDOS

```javascript
{
  sku: "331676",
  basePrice: 2340,        // $2340
  discountPercent: 30,
  finalPrice: 1638,       // $1638
  quantity: 5,
  subtotal: 11700,        // 5 × 2340
  expectedTotal: 8190,    // 11700 - 3510 (30% off)
  
  user: {
    seller: "jumboargentinav700cordoba700",
    channel: "34",
    regionId: "U1cjanVtYm9hcmdhblRwbmF2Ym12Mmpby2bHVqYW4=",  // Luján
    postalCode: "1636",
    vtex_segment: "eyJjYW1wYWlnbnMiOm51bGwsImNoYW5uZWwiOiIzNCIsInByaWNlVGFibGVzIjpudWxsLCJyZWdpb25JZCI6IlUxY2phblZ0WW05aGNtZGxiblJwYm1GMk1UWXliSFZxWVc0PSIsInV0bV9jYW1wYWlnbiI6bnVsbCwidXRtX3NvdXJjZSI6bnVsbCwidXRtaV9jYW1wYWlnbiI6bnVsbCwiY3VycmVuY3lDb2RlIjoiQVJTIiwiY3VycmVuY3lTeW1ib2wiOiIkIiwiY291bnRyeUNvZGUiOiJBUkciLCJjdWx0dXJlSW5mbyI6ImVzLUFSIiwiYWRtaW5fY3VsdHVyZUluZm8iOiJlcy1BUiIsImNoYW5uZWxQcml2YWN5IjoicHVibGljIn0"
  }
}
```

---

## 🚀 FUNCIÓN FINAL (CUANDO ENCONTREMOS EL PARÁMETRO)

```javascript
async function getPriceWithDiscount(sku, quantity, seller, vtexSegment) {
  // Paso 1: Obtener descuento
  const promoRes = await fetch('https://www.vea.com.ar/_v/search-promotions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': `vtex_segment=${vtexSegment}`
    },
    body: JSON.stringify({ seller, skus: [sku] })
  });

  const promos = await promoRes.json();
  const discount = promos.promotions?.generic?.promotions?.[sku];

  // Paso 2: Simulation
  const simRes = await fetch(
    `https://www.vea.com.ar/api/checkout/pub/orderForms/simulation?sc=34`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `vtex_segment=${vtexSegment}`
      },
      body: JSON.stringify({
        items: Array(quantity).fill({ id: sku, quantity: 1, seller }),
        // 🔑 PARÁMETRO MISTERIOSO (aún por descubrir):
        // coupon: discount.code,
        // O algo más...
      })
    }
  );

  const result = await simRes.json();
  const total = result.totals?.find(t => t.id === 'Items')?.value || 0;
  
  return {
    subtotal: total,
    discount: discount?.effectiveDiscount,
    finalPrice: total * (1 - parseFloat(discount?.effectiveDiscount || 0))
  };
}
```

---

## 📌 NEXT STEPS

**IMPORTANTE:** Necesitamos que captures el request exacto. Sin eso, hemos llegado al límite de lo que podemos probar remotamente.

Una vez que tengas el output del script automático, envíamelo y:
1. Identific aré el parámetro faltante
2. Actualizaré la función final
3. ¡Listo para usar en tu app!

---

## 📝 ARCHIVOS GENERADOS

- `/Users/camilosilva/vtex-promo-research.js` - Playwright (inicial, no necesario)
- `/Users/camilosilva/test-vtex-discount.js` - Tests básicos
- `/Users/camilosilva/vtex-final-solution.js` - Solución parcial
- `/Users/camilosilva/test-with-postal.js` - Tests con postal code
- `/Users/camilosilva/test-with-orderformid.js` - Tests con orderForm
- `/Users/camilosilva/capture-add-to-cart.js` - Script de captura
- `/Users/camilosilva/SOLUCIÓN-VTEX-DESCUENTOS.md` - Documentación técnica

---

## ❓ PREGUNTAS RÁPIDAS

**P:** ¿Por qué `/search-promotions` funciona pero `/orderForms/simulation` no?

**R:** Probablemente porque `/search-promotions` es un endpoint de lectura que solo devuelve qué promociones PODRÍAN aplicarse. El `/orderForms/simulation` probablemente necesita información adicional (token, estado del carrito, etc.) para APLICAR esos descuentos.

**P:** ¿El código de la promo "30%" es lo que falta?

**R:** Posiblemente. Pero el navegador no lo está mandando directamente (al menos no en el lugar donde esperaríamos).

**P:** ¿Qué pasó con los 3 enfoques originales que mencionaste?

**R:** 
- ✅ 1️⃣ `?RnbBehavior=1` - Probado, no funcionó
- ✅ 2️⃣ `marketingData` en body - Probado, no funcionó  
- ✅ 3️⃣ `postalCode` de Luján - Probado, no funcionó

Pero la solución existe, está en los requests de tu navegador. Solo necesitamos verlos.

---

**Última nota:** El hecho de que `/search-promotions` devuelva correctamente el descuento del 30% significa que el servidor sí conoce que la promoción existe para ese usuario, región y producto. La solución está muy cerca. 🎯
