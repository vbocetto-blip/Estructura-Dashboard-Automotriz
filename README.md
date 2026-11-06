# Estructura Dashboard Automotriz

Tablero de consignaciones (Ansar Automotriz, piloto). Autor y propietario: Luis Francisco (vbocetto).

- `public/` · la página del tablero
- `functions/api/` · servidor que conecta con la base de datos (Cloudflare D1)
- `sql/schema.sql` · estructura de la base de datos
- `wrangler.toml` · configuración de Cloudflare Pages (base `ansar-consignaciones`)

Publicación: Cloudflare Pages conectado a este repositorio, carpeta de salida `public`.
El login lo da Cloudflare Access; sin él, el servidor no entrega datos.
