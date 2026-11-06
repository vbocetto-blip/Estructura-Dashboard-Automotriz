/* API del tablero Ansar sobre Cloudflare D1.
   Login: Cloudflare Access. Cada request trae un JWT firmado (Cf-Access-Jwt-Assertion) que se verifica aquí.
   Roles: admin ve y escribe todo; virtual solo las colecciones de Consignación virtual. */
const VIRTUAL_RW = new Set(["virtual", "virtualLlamadas"]);
const VIRTUAL_RO = new Set(["config/virtual"]);
const json = (o, s = 200, extra = {}) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra } });
const now = () => new Date().toISOString();

let certCache = null, certAt = 0;
const b64u = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), c => c.charCodeAt(0));
async function verifyAccess(request, env) {
  const tok = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!tok || !env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null;
  const [h, p, sig] = tok.split(".");
  if (!h || !p || !sig) return null;
  const head = JSON.parse(new TextDecoder().decode(b64u(h)));
  const pay = JSON.parse(new TextDecoder().decode(b64u(p)));
  if (Date.now() - certAt > 3600e3 || !certCache) {
    const r = await fetch(`https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`);
    certCache = (await r.json()).keys; certAt = Date.now();
  }
  const jwk = certCache.find(k => k.kid === head.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64u(sig), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) return null;
  const aud = Array.isArray(pay.aud) ? pay.aud : [pay.aud];
  if (!aud.includes(env.ACCESS_AUD) || pay.exp * 1000 < Date.now()) return null;
  return String(pay.email || "").toLowerCase();
}
/* ---------- Login propio: correo + contraseña (PBKDF2) y sesión en cookie ---------- */
const SES_DIAS = 14, MIN_PASS = 10;
const hex = b => Array.from(new Uint8Array(b), x => x.toString(16).padStart(2, "0")).join("");
const randHex = n => hex(crypto.getRandomValues(new Uint8Array(n)));
async function hashPass(pass, saltHex) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveBits"]);
  const salt = Uint8Array.from(saltHex.match(/../g), h => parseInt(h, 16));
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 }, key, 256));
}
const safeEq = (x, y) => { if (x.length !== y.length) return false; let r = 0; for (let i = 0; i < x.length; i++) r |= x.charCodeAt(i) ^ y.charCodeAt(i); return r === 0; };
const cookieOf = (req, name) => { const m = (req.headers.get("cookie") || "").match(new RegExp("(?:^|;\\s*)" + name + "=([^;]+)")); return m ? m[1] : ""; };
const setCookie = (tok, maxAge) => `ansar_s=${tok}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
async function sessionEmail(request, env) {
  const tok = cookieOf(request, "ansar_s");
  if (!/^[0-9a-f]{64}$/.test(tok)) return null;
  const r = await env.DB.prepare("SELECT email FROM sesiones WHERE token=? AND expira>?").bind(tok, now()).first();
  return r ? r.email : null;
}
async function nuevaSesion(env, email) {
  const tok = randHex(32), exp = new Date(Date.now() + SES_DIAS * 864e5).toISOString();
  await env.DB.prepare("INSERT INTO sesiones (token,email,expira,creada) VALUES (?,?,?,?)").bind(tok, email, exp, now()).run();
  return json({ ok: true }, 200, { "set-cookie": setCookie(tok, SES_DIAS * 86400) });
}
async function authRoutes(path, request, env) {
  if (request.method !== "POST") return null;
  if (path === "logout") {
    const tok = cookieOf(request, "ansar_s");
    if (tok) await env.DB.prepare("DELETE FROM sesiones WHERE token=?").bind(tok).run();
    return json({ ok: true }, 200, { "set-cookie": setCookie("x", 0) });
  }
  if (path !== "login" && path !== "primer-acceso") return null;
  let b; try { b = await request.json(); } catch { return json({ error: "json_invalido" }, 400); }
  const email = String(b.email || "").trim().toLowerCase(), pass = String(b.password || "");
  const u = await env.DB.prepare("SELECT email,pass_hash,pass_salt,fallos,bloqueado_hasta FROM usuarios WHERE email=? AND activo=1").bind(email).first();
  const t = now();
  if (path === "primer-acceso") {
    if (!u || u.pass_hash) return json({ error: "no_disponible" }, 400);
    if (pass.length < MIN_PASS) return json({ error: "clave_corta", min: MIN_PASS }, 400);
    const salt = randHex(16), h = await hashPass(pass, salt);
    const r = await env.DB.prepare("UPDATE usuarios SET pass_hash=?, pass_salt=?, fallos=0, bloqueado_hasta=NULL WHERE email=? AND pass_hash IS NULL").bind(h, salt, email).run();
    if (!r.meta.changes) return json({ error: "no_disponible" }, 400);
    await env.DB.prepare("INSERT INTO auditoria (cuando,email,accion) VALUES (?,?,?)").bind(t, email, "primer_acceso").run();
    return nuevaSesion(env, email);
  }
  if (!u || !u.pass_hash) { await hashPass(pass || "x", "00".repeat(16)); return json({ error: "credenciales" }, 401); }
  if (u.bloqueado_hasta && u.bloqueado_hasta > t) return json({ error: "bloqueado", hasta: u.bloqueado_hasta }, 429);
  const h = await hashPass(pass, u.pass_salt);
  if (!safeEq(h, u.pass_hash)) {
    const f = (u.fallos || 0) + 1, lock = f >= 8 ? new Date(Date.now() + 15 * 60e3).toISOString() : null;
    await env.DB.prepare("UPDATE usuarios SET fallos=?, bloqueado_hasta=? WHERE email=?").bind(lock ? 0 : f, lock, email).run();
    return json({ error: "credenciales" }, 401);
  }
  await env.DB.batch([
    env.DB.prepare("UPDATE usuarios SET fallos=0, bloqueado_hasta=NULL WHERE email=?").bind(email),
    env.DB.prepare("DELETE FROM sesiones WHERE expira<?").bind(t),
    env.DB.prepare("INSERT INTO auditoria (cuando,email,accion) VALUES (?,?,?)").bind(t, email, "login")]);
  return nuevaSesion(env, email);
}

function canRead(rol, col, id) {
  if (rol === "admin" || rol === "equipo") return true;
  return VIRTUAL_RW.has(col) || VIRTUAL_RO.has(`${col}/${id}`);
}
function canWrite(rol, col) {
  if (rol === "admin") return true;
  if (rol === "equipo") return col !== "config";
  return VIRTUAL_RW.has(col);
}
const validName = s => typeof s === "string" && /^[A-Za-z0-9_\-.:@+~]{1,200}$/.test(s);

export async function onRequest(ctx) {
  const { request, env, params } = ctx;
  const ar = await authRoutes((params.path || []).join("/"), request, env);
  if (ar) return ar;
  const email = (await sessionEmail(request, env)) || (await verifyAccess(request, env));
  if (!email) return json({ error: "no_autenticado" }, 401);
  const u = await env.DB.prepare("SELECT email,nombre,rol FROM usuarios WHERE email=? AND activo=1").bind(email).first();
  if (!u) return json({ error: "sin_acceso", email }, 403);
  const path = (params.path || []).join("/");
  const url = new URL(request.url);

  if (path === "me") return json({ email: u.email, nombre: u.nombre, rol: u.rol });

  if (path === "usuarios" || path === "usuarios/reset") {
    if (u.rol !== "admin") return json({ error: "sin_permiso" }, 403);
    if (request.method === "GET" && path === "usuarios") {
      const rs = await env.DB.prepare("SELECT email,nombre,rol,activo,(pass_hash IS NOT NULL) AS tiene_clave FROM usuarios ORDER BY rol,email").all();
      return json({ usuarios: rs.results });
    }
    if (request.method === "POST") {
      let b; try { b = await request.json(); } catch { return json({ error: "json_invalido" }, 400); }
      const em = String(b.email || "").trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return json({ error: "correo_invalido" }, 400);
      const t = now();
      if (path === "usuarios/reset") {
        await env.DB.batch([
          env.DB.prepare("UPDATE usuarios SET pass_hash=NULL, pass_salt=NULL, fallos=0, bloqueado_hasta=NULL WHERE email=?").bind(em),
          env.DB.prepare("DELETE FROM sesiones WHERE email=?").bind(em),
          env.DB.prepare("INSERT INTO auditoria (cuando,email,accion,id) VALUES (?,?,?,?)").bind(t, u.email, "reset_clave", em)]);
        return json({ ok: true });
      }
      const rol = ["admin", "equipo", "virtual"].includes(b.rol) ? b.rol : "virtual", nombre = String(b.nombre || "").trim().slice(0, 60) || em, activo = b.activo === false ? 0 : 1;
      if (em === u.email && (rol !== "admin" || !activo)) return json({ error: "no_puedes_quitarte_admin" }, 400);
      await env.DB.batch([
        env.DB.prepare("INSERT INTO usuarios (email,nombre,rol,activo,creado_en) VALUES (?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET nombre=excluded.nombre, rol=excluded.rol, activo=excluded.activo").bind(em, nombre, rol, activo, t),
        ...(activo ? [] : [env.DB.prepare("DELETE FROM sesiones WHERE email=?").bind(em)]),
        env.DB.prepare("INSERT INTO auditoria (cuando,email,accion,id) VALUES (?,?,?,?)").bind(t, u.email, "usuario_" + rol + (activo ? "" : "_inactivo"), em)]);
      return json({ ok: true });
    }
  }

  if (path === "changes" && request.method === "GET") {
    const since = url.searchParams.get("since") || "";
    const rs = await env.DB.prepare("SELECT col,id,data,version,updated_at,deleted FROM docs WHERE updated_at > ? ORDER BY updated_at LIMIT 2000").bind(since).all();
    const rows = rs.results.filter(r => canRead(u.rol, r.col, r.id)).map(r => ({ col: r.col, id: r.id, v: r.version, t: r.updated_at, del: !!r.deleted, data: r.deleted ? null : JSON.parse(r.data) }));
    return json({ rows, more: rs.results.length === 2000, serverTime: now() });
  }

  if (path === "import" && request.method === "POST") {
    if (u.rol !== "admin") return json({ error: "sin_permiso" }, 403);
    let body; try { body = await request.json(); } catch { return json({ error: "json_invalido" }, 400); }
    if (body.formato !== "ansar-respaldo-1" || !body.colecciones) return json({ error: "formato_invalido" }, 400);
    const t = now(), stmts = [];
    for (const [col, docs] of Object.entries(body.colecciones)) {
      if (!validName(col) || !docs || typeof docs !== "object") continue;
      for (const [id, data] of Object.entries(docs)) {
        if (!validName(id) || !data || typeof data !== "object") continue;
        stmts.push(env.DB.prepare("INSERT INTO docs (col,id,data,version,updated_at,updated_by,deleted) VALUES (?,?,?,1,?,?,0) ON CONFLICT(col,id) DO UPDATE SET data=excluded.data, version=docs.version+1, updated_at=excluded.updated_at, updated_by=excluded.updated_by, deleted=0").bind(col, id, JSON.stringify(data), t, u.email));
      }
    }
    for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));
    await env.DB.prepare("INSERT INTO auditoria (cuando,email,accion,col,id) VALUES (?,?,?,?,?)").bind(t, u.email, "import", "*", String(stmts.length)).run();
    return json({ ok: true, total: stmts.length });
  }

  if (path === "doc") {
    let body = {};
    if (request.method !== "GET") { try { body = await request.json(); } catch { return json({ error: "json_invalido" }, 400); } }
    const col = request.method === "GET" ? url.searchParams.get("col") : body.col;
    const id = request.method === "GET" ? url.searchParams.get("id") : body.id;
    if (!validName(col) || !validName(id)) return json({ error: "ruta_invalida" }, 400);
    if (request.method === "GET") {
      if (!canRead(u.rol, col, id)) return json({ exists: false });
      const r = await env.DB.prepare("SELECT data,version,deleted FROM docs WHERE col=? AND id=?").bind(col, id).first();
      return json(r && !r.deleted ? { exists: true, data: JSON.parse(r.data), v: r.version } : { exists: false });
    }
    if (!canWrite(u.rol, col)) return json({ error: "sin_permiso" }, 403);
    const t = now();
    if (request.method === "DELETE") {
      await env.DB.batch([
        env.DB.prepare("UPDATE docs SET deleted=1, data='{}', version=version+1, updated_at=?, updated_by=? WHERE col=? AND id=?").bind(t, u.email, col, id),
        env.DB.prepare("INSERT INTO auditoria (cuando,email,accion,col,id) VALUES (?,?,?,?,?)").bind(t, u.email, "delete", col, id)]);
      return json({ ok: true, t });
    }
    if (request.method === "POST") {
      const data = body.data;
      if (!data || typeof data !== "object" || Array.isArray(data)) return json({ error: "datos_invalidos" }, 400);
      const s = JSON.stringify(data);
      if (s.length > 256 * 1024) return json({ error: "muy_grande" }, 413);
      if (body.mode === "update") {
        const cur = await env.DB.prepare("SELECT 1 FROM docs WHERE col=? AND id=? AND deleted=0").bind(col, id).first();
        if (!cur) return json({ error: "no_existe" }, 404);
        await env.DB.prepare("UPDATE docs SET data=json_patch(data, ?), version=version+1, updated_at=?, updated_by=? WHERE col=? AND id=?").bind(s, t, u.email, col, id).run();
      } else {
        await env.DB.prepare("INSERT INTO docs (col,id,data,version,updated_at,updated_by,deleted) VALUES (?,?,?,1,?,?,0) ON CONFLICT(col,id) DO UPDATE SET data=excluded.data, version=docs.version+1, updated_at=excluded.updated_at, updated_by=excluded.updated_by, deleted=0").bind(col, id, s, t, u.email).run();
      }
      return json({ ok: true, t });
    }
  }
  return json({ error: "no_encontrado" }, 404);
}
