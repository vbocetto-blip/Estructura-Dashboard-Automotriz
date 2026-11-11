CREATE TABLE IF NOT EXISTS docs (col TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL, updated_by TEXT, deleted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (col, id));
CREATE INDEX IF NOT EXISTS idx_docs_col_updated ON docs(col, updated_at);
CREATE INDEX IF NOT EXISTS idx_docs_updated ON docs(updated_at);
CREATE TABLE IF NOT EXISTS usuarios (email TEXT PRIMARY KEY, nombre TEXT NOT NULL, rol TEXT NOT NULL CHECK (rol IN ('admin','equipo','virtual')), activo INTEGER NOT NULL DEFAULT 1, creado_en TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS auditoria (n INTEGER PRIMARY KEY AUTOINCREMENT, cuando TEXT NOT NULL, email TEXT, accion TEXT NOT NULL, col TEXT, id TEXT);

CREATE TABLE IF NOT EXISTS actividad (email TEXT NOT NULL, dia TEXT NOT NULL, minuto TEXT NOT NULL, pagina TEXT, estado TEXT, PRIMARY KEY (email, dia, minuto));

-- Login propio (correo + contraseña). Reconstruido a partir de functions/api: si se crea la base desde cero,
-- sin estas columnas y esta tabla el ingreso no funciona. Revisar contra la base real antes de usarlo en una migración.
-- ALTER TABLE usuarios ADD COLUMN pass_hash TEXT;
-- ALTER TABLE usuarios ADD COLUMN pass_salt TEXT;
-- ALTER TABLE usuarios ADD COLUMN fallos INTEGER NOT NULL DEFAULT 0;
-- ALTER TABLE usuarios ADD COLUMN bloqueado_hasta TEXT;
CREATE TABLE IF NOT EXISTS sesiones (token TEXT PRIMARY KEY, email TEXT NOT NULL, expira TEXT NOT NULL, creada TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_sesiones_email ON sesiones(email);
