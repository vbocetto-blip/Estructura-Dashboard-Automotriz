# Nexo Motor

Nexo Motor: la red que mueve las consignaciones de una automotora. Primer cliente y piloto: Ansar Automotriz (La Serena). Autor y propietario: Luis Francisco (vbocetto).

- `public/` · la página del tablero
  - Pestaña **Compradores**: registro de interesados en comprar (colección `compradores`), cruce automático con el stock en venta y canal de llegada.
  - **Monitoreo (embudo)**: las 8 etapas de punta a punta (Aviso, Contacto, Seguimiento, Agenda, Tasación, Mandato, Vitrina, Venta) con lo registrado en el período.
  - **Recorrido**: cada auto muestra en su fila y en su ficha por qué etapas pasó. Se arma al leer (aviso por `radarId`, llamadas y citas por aviso o teléfono); no guarda datos nuevos.
  - **Menú Más**: Resumen, Piloto, Equipo y reglas, Patio en vivo, Actualizar, modo claro u oscuro y Salir.
  - **Resumen → Proyección**: cierre proyectado del mes, meta de ventas (`semanas/meta-AAAA-MM`) y ritmo de contactos que exige, calculado solo con datos propios.
- `functions/api/` · servidor que conecta con la base de datos (Cloudflare D1)
- `sql/schema.sql` · estructura de la base de datos
- `wrangler.toml` · configuración de Cloudflare Pages (base `ansar-consignaciones`)

Publicación: Cloudflare Pages conectado a este repositorio, carpeta de salida `public`.
Login: correo + contraseña (guardadas con PBKDF2 en D1) y sesión en cookie de 14 días. Cloudflare Access es opcional (variables ACCESS_*). Sin sesión válida el servidor no entrega datos.
Usuarios: se administran en Equipo y reglas → Usuarios del sitio. Un correo nuevo entra con “Primer acceso” y crea su contraseña.
