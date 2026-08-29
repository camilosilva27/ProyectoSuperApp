cd AllPromos

# Antes de una compra grande, actualizá compras-real.txt con lo que necesitás,
# y si el script avisa que el catálogo tiene +30 días, regeneralo:
node scraper-promos-vea.js
node scraper-promos-carrefour.js
node scraper-promos-changomas.js

# Corré la lista real
node buscar-promos.js --lista compras-real.txt

# Para un chequeo puntual de un solo producto: 
node buscar-promos.js "producto" cantidad.

