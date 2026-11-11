# Estructura Dashboard Automotriz

Tablero de consignaciones (Ansar Automotriz, piloto). Autor y propietario: Luis Francisco (vbocetto).

- `public/` · la página del tablero
  - Pestaña **Compradores**: registro de interesados en comprar (colección `compradores`), cruce automático con el stock en venta y canal de llegada.
  - **Resumen → Proyección**: cierre proyectado del mes, meta de ventas (`semanas/meta-AAAA-MM`) y ritmo de contactos que exige, calculado solo con datos propios.
- `functions/api/` · servidor que conecta con la base de datos (Cloudflare D1)
- `sql/schema.sql` · estructura de la base de datos
- `wrangler.toml` · configuración de Cloudflare Pages (base `ansar-consignaciones`)

Publicación: Cloudflare Pages conectado a este repositorio, carpeta de salida `public`.
Login: correo + contraseña (guardadas con PBKDF2 en D1) y sesión en cookie de 14 días. Cloudflare Access es opcional (variables ACCESS_*). Sin sesión válida el servidor no entrega datos.
Usuarios: se administran en Equipo y reglas → Usuarios del sitio. Un correo nuevo entra con “Primer acceso” y crea su contraseña.
