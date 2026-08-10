# Contexto del proyecto: App de compra óptima en supermercados

## La idea (definitiva y simple)

El usuario arma un carrito con productos identificados por EAN (código de barras). La app consulta los precios actuales en Vea, Chango Más y Carrefour, y le dice dónde comprar cada cosa para gastar lo menos posible. No importa si es online o presencial — lo que importa es el precio final más bajo. El usuario decide cómo ejecuta la compra.

---

## Uso previsto

Uso personal (el desarrollador y familiares). No es un producto comercial. Escala pequeña: 3 sucursales en Luján, Buenos Aires. Esto elimina preocupaciones de costos de infraestructura, límites de rate, y complejidad legal.

---

## Fuentes de datos
### 1. APIs de los supermercados (precios reales + promos)
Vea, Chango y Carrefour corren sobre **VTEX**, lo que significa que los tres tienen APIs similares.

#### Vea (vea.com.ar) — API confirmada y funcionando
- **Base URL:** `https://www.vea.com.ar/api/catalog_system/pub/products/search`
- **Autenticación:** Requiere cookie `vtex_segment` en el header.
- **Cookie confirmada:** `eyJjYW1wYWlnbnMiOm51bGwsImNoYW5uZWwiOiIzNCIsInByaWNlVGFibGVzIjpudWxsLCJyZWdpb25JZCI6bnVsbCwidXRtX2NhbXBhaWduIjpudWxsLCJ1dG1fc291cmNlIjpudWxsLCJ1dG1pX2NhbXBhaWduIjpudWxsLCJjdXJyZW5jeUNvZGUiOiJBUlMiLCJjdXJyZW5jeVN5bWJvbCI6IiQiLCJjb3VudHJ5Q29kZSI6IkFSRyIsImN1bHR1cmVJbmZvIjoiZXMtQVIiLCJhZG1pbl9jdWx0dXJlSW5mbyI6ImVzLUFSIiwiY2hhbm5lbFByaXZhY3kiOiJwdWJsaWMifQ`
- **Sales channel:** `34` (decodificado del campo `channel` de la cookie)
- **Buscar por SKU:** `?fq=skuId:XXXXXX&sc=34`
- **Precio:** dentro de `items[].sellers[].commertialOffer.Price`
- **Precio de lista:** `commertialOffer.ListPrice` (OJO: este campo tiene un bug en Vea, devuelve valores absurdos como $193.388 para una leche. Ignorarlo.)
- **Promos de góndola:** en `commertialOffer.Teasers` (lista, puede estar vacía)
- **Promos online:** en `productClusters` (nombres de campañas, ej: "30% en Lácteos"). Estas promos se aplican en el checkout, no en el precio del producto individual.
- **Pendiente:** encontrar el endpoint de búsqueda por EAN directamente (para no necesitar el skuId interno de VTEX).

#### Chango Más (masonline.com.ar) — pendiente de inspección
- También corre sobre VTEX. Se espera API similar a Vea.
- Pendiente: capturar cookie `vtex_segment` de la sesión del usuario en masonline.com.ar.

#### Carrefour (carrefour.com.ar) — pendiente de inspección
- También corre sobre VTEX. Tiene protección Cloudflare moderada pero manejable a escala pequeña.
- Pendiente: capturar cookie `vtex_segment`.

---

## Motor de optimización (ya implementado y probado)

**Lógica:** Para N supermercados y máximo K a visitar, evalúa todas las combinaciones posibles. Para cada combinación asigna cada ítem al super más barato que lo tenga. Elige la combinación de menor costo total.

A escala de 3 supers y máximo 2 → 6 combinaciones. Fuerza bruta, sin necesidad de algoritmos complejos.

**Scripts Python funcionales ya escritos:**
- `compra_optima.py` — motor general, ítems por EAN o por búsqueda de palabras.
- `compra_mensual.py` — ejemplo de compra mensual familia de 4.
- `compra_premium.py` — ejemplo de carrito de primeras marcas tope $400k.

**Hallazgo clave de las pruebas:** Repartir entre dos supers con precios similares ahorra menos del 1%. El valor real está en las promos, en agregar un tercer super con precios distintos, o en permitir sustituir marca líder por segunda marca.

---

## Hallazgos importantes sobre los datos

**EAN = identidad garantizada para envasados.** Mismo EAN en dos supers = exactamente el mismo producto. No hay ambigüedad.

**Productos al peso = códigos internos, no comparables.** Queso de horma, fiambre feteado, carne usan prefijos `0000000X` o `2X` (reservados por GS1 para uso interno). Son distintos entre cadenas. **Fuera del scope — solo productos envasados con EAN real.**

**Las promos online de Vea no están en el campo `Teasers`.** Están en `productClusters` y se aplican en el checkout. Para capturar el precio final con promo online hay que simular un carrito completo. Pendiente de resolver.

**`ListPrice` de Vea está roto.** Ignorar ese campo. Usar solo `Price`.

---

## Decisiones de diseño

| Tema | Decisión |
|---|---|
| Modo de compra | Sin diferenciación online/presencial. El objetivo es pagar menos, punto. |
| Identificación de producto | Por EAN (código de barras). El usuario selecciona entre los productos. Internamente se diferencian por EAN, pero nosotros usaremos descripciones para que el usuario vea.
| Productos al peso | Fuera del scope. Solo envasados. |
| Promos bancarias | Fuera del scope por ahora. |
| Costo del viaje | No considerado en el motor. A futuro. |
| Datos de precios | API de cada super (VTEX) como fuente principal. SEPA como respaldo. |
| Base de datos | SQLite local. Suficiente para uso personal. |
| Escala inicial | Solo Luján. 3 supermercados. |
| Infraestructura | Script Python corriendo en Mac del usuario. Sin servidor. |

---

## Arquitectura prevista (simple)

```
scraper.py          — corre 1 vez por día via cron
    └── llama API Vea  (cookie vtex_segment channel=34)
    └── llama API Chango (pendiente)
    └── llama API Carrefour (pendiente)
    └── guarda en precios.sqlite

app.py / interfaz   — el usuario arma el carrito
    └── usuario ingresa EANs
    └── consulta precios.sqlite
    └── corre optimizador
    └── muestra: "comprá X en Vea, Y en Chango, total $Z"
```

---

## Pendientes concretos (en orden de prioridad)

1. **Endpoint de búsqueda por EAN en Vea** — actualmente se busca por `skuId` interno de VTEX. Necesitamos buscar directamente por EAN (`fq=ean:XXXXXXXXXX` o similar). Probar: `?fq=ean:7790895000232&sc=34`

2. **Capturar cookie `vtex_segment` de Chango Más** — misma metodología que Vea. Abrir masonline.com.ar, DevTools → Application → Cookies.

3. **Capturar cookie `vtex_segment` de Carrefour** — ídem.

4. **Identificar sucursal correcta del Carrefour de Luján** — buscar en `sucursales.csv` por dirección.

5. **Resolver precio con promos online de Vea** — encontrar el endpoint de checkout/orderForm que devuelve el precio final con todos los descuentos aplicados.

6. **Armar el scraper diario** — script Python que corre con cron cada noche, guarda en SQLite.

7. **Interfaz simple** — puede ser una página web local (Flask) o incluso un script de terminal al principio.

---

## Código de referencia — llamada a API de Vea

```python
import requests, json

VEA_COOKIE = "eyJjYW1wYWlnbnMiOm51bGwsImNoYW5uZWwiOiIzNCIsInByaWNlVGFibGVzIjpudWxsLCJyZWdpb25JZCI6bnVsbCwidXRtX2NhbXBhaWduIjpudWxsLCJ1dG1fc291cmNlIjpudWxsLCJ1dG1pX2NhbXBhaWduIjpudWxsLCJjdXJyZW5jeUNvZGUiOiJBUlMiLCJjdXJyZW5jeVN5bWJvbCI6IiQiLCJjb3VudHJ5Q29kZSI6IkFSRyIsImN1bHR1cmVJbmZvIjoiZXMtQVIiLCJhZG1pbl9jdWx0dXJlSW5mbyI6ImVzLUFSIiwiY2hhbm5lbFByaXZhY3kiOiJwdWJsaWMifQ"

cookies = {"vtex_segment": VEA_COOKIE}

# Buscar por skuId interno
url = "https://www.vea.com.ar/api/catalog_system/pub/products/search?fq=skuId:331676&sc=34"

# Buscar por EAN (a confirmar que funcione)
# url = "https://www.vea.com.ar/api/catalog_system/pub/products/search?fq=ean:7790895000232&sc=34"

r = requests.get(url, cookies=cookies)
data = r.json()

for product in data:
    print("Producto:", product.get("productName"))
    for item in product.get("items", []):
        print("  EAN:", item.get("ean"))
        for seller in item.get("sellers", []):
            offer = seller.get("commertialOffer", {})
            print("  Precio:", offer.get("Price"))          # usar este
            # offer.get("ListPrice") -> IGNORAR, tiene bug en Vea
            teasers = offer.get("Teasers", [])
            if teasers:
                print("  PROMOS:", json.dumps(teasers, ensure_ascii=False))
```