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


/* ---------- Formulario público de consignación (sin login) ----------
   Recibe solo lo necesario para tasar y contactar, exige consentimiento explícito y limita envíos por IP (guardada como hash diario, nunca en claro). */
const LW_TXT = (v, n = 80) => String(v ?? "").replace(/[\u0000-\u001f<>]/g, " ").trim().slice(0, n);
const LW_OPC = {
  titular: ["si", "no", "familiar"], prenda: ["no", "si", "nose"], cuando: ["mes", "1a3", "viendo"],
  motivo: ["cambio", "dinero", "nouso", "otro"], cambio: ["si", "no", "quizas"] };
async function sha256hex(t) { return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t))); }
function lwScore(d) {
  const det = [];
  const urg = { mes: 35, "1a3": 20, viendo: 5 }[d.cuando] || 0; det.push(["urgencia", urg]);
  const pc = d.titular === "si" && d.prenda === "no" ? 25 : (d.titular === "no" ? 0 : 10); det.push(["puede consignar", pc]);
  const pr = 10; det.push(["precio (por evaluar)", pr]);
  const rt = d.cambio === "si" ? 10 : d.cambio === "quizas" ? 5 : 0; det.push(["retoma", rt]);
  const ct = /^569\d{8}$/.test(d.tel) && d.comuna ? 10 : 5; det.push(["contacto", ct]);
  const total = det.reduce((a, x) => a + x[1], 0);
  return { puntaje: total, puntajeDet: det.map(x => `${x[0]} ${x[1]}`).join(" + "), etiqueta: total >= 75 ? "CALIENTE" : total >= 50 ? "TIBIO" : "FRÍO" };
}
async function leadConsigna(request, env) {
  let b; try { b = await request.json(); } catch { return json({ error: "json_invalido" }, 400); }
  if (b.web) return json({ ok: true });                      // trampa para bots: campo oculto
  if (b.acepta !== true) return json({ error: "falta_consentimiento" }, 400);
  let tel = String(b.tel || "").replace(/\D/g, ""); if (tel.length === 9) tel = "56" + tel; if (tel.length === 8) tel = "569" + tel;
  if (!/^569\d{8}$/.test(tel)) return json({ error: "telefono_invalido" }, 400);
  const d = {
    nombre: LW_TXT(b.nombre, 60), tel, comuna: LW_TXT(b.comuna, 40),
    marca: LW_TXT(b.marca, 30), modelo: LW_TXT(b.modelo, 40), anio: Math.min(2027, Math.max(1980, parseInt(b.anio, 10) || 0)) || null,
    km: Math.min(999999, Math.max(0, parseInt(String(b.km || "").replace(/\D/g, ""), 10) || 0)) || null,
    precioEsperado: Math.min(999e6, Math.max(0, parseInt(String(b.precio || "").replace(/\D/g, ""), 10) || 0)) || null };
  for (const [k, ops] of Object.entries(LW_OPC)) d[k] = ops.includes(b[k]) ? b[k] : "";
  if (!d.nombre || !d.marca || !d.modelo || !d.anio || !d.cuando) return json({ error: "faltan_datos" }, 400);
  const t = now(), ip = request.headers.get("CF-Connecting-IP") || "", ipHash = (await sha256hex(ip + t.slice(0, 10))).slice(0, 16);
  const hora = new Date(Date.now() - 3600e3).toISOString();
  const rl = await env.DB.prepare("SELECT COUNT(*) AS n FROM docs WHERE col='leadsWeb' AND updated_at>? AND json_extract(data,'$.ipHash')=?").bind(hora, ipHash).first();
  if (rl && rl.n >= 5) return json({ error: "demasiados_envios" }, 429);
  const src = b.src && typeof b.src === "object" ? b.src : {};
  Object.assign(d, lwScore(d), {
    fuente: LW_TXT(src.utm_source || (src.fbclid ? "meta" : "directo"), 30), campana: LW_TXT(src.utm_campaign, 60), anuncio: LW_TXT(src.utm_content, 60),
    consentimiento: { acepta: true, texto: LW_TXT(b.textoConsentimiento, 300), version: LW_TXT(b.versionPolitica, 20), en: t },
    estado: "Nuevo", creadoEn: t, ipHash });
  const id = "lw_" + t.replace(/\D/g, "").slice(0, 14) + "_" + randHex(3);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO docs (col,id,data,version,updated_at,updated_by,deleted) VALUES ('leadsWeb',?,?,1,?,?,0)").bind(id, JSON.stringify(d), t, "formulario"),
    env.DB.prepare("INSERT INTO auditoria (cuando,email,accion,col,id) VALUES (?,?,?,?,?)").bind(t, "formulario", "lead_web", "leadsWeb", id)]);
  return json({ ok: true });
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
  if ((params.path || []).join("/") === "lead-consigna" && request.method === "POST") return leadConsigna(request, env);
  const ar = await authRoutes((params.path || []).join("/"), request, env);
  if (ar) return ar;
  const email = (await sessionEmail(request, env)) || (await verifyAccess(request, env));
  if (!email) return json({ error: "no_autenticado" }, 401);
  const u = await env.DB.prepare("SELECT email,nombre,rol FROM usuarios WHERE email=? AND activo=1").bind(email).first();
  if (!u) return json({ error: "sin_acceso", email }, 403);
  const path = (params.path || []).join("/");
  const url = new URL(request.url);

  if (path === "me") return json({ email: u.email, nombre: u.nombre, rol: u.rol });

  /* Prueba de rendimiento: un latido por minuto activo (pestaña visible + interacción reciente). Solo minuto sí/no, sin contenido. */
  if (path === "latido" && request.method === "POST") {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date()).map(x => [x.type, x.value]));
    let pag = ""; try { pag = String((await request.json()).pagina || "").slice(0, 20); } catch {}
    await env.DB.prepare("INSERT INTO actividad (email,dia,minuto,pagina) VALUES (?,?,?,?) ON CONFLICT DO NOTHING").bind(u.email, `${p.year}-${p.month}-${p.day}`, `${p.hour === "24" ? "00" : p.hour}:${p.minute}`, pag).run();
    return json({ ok: true });
  }
  if (path === "actividad" && request.method === "GET") {
    if (u.rol !== "admin") return json({ error: "sin_permiso" }, 403);
    const desde = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("desde") || "") ? url.searchParams.get("desde") : "2000-01-01";
    const rs = await env.DB.prepare("SELECT a.email, u.nombre, a.dia, COUNT(*) AS minutos, MIN(a.minuto) AS desde, MAX(a.minuto) AS hasta FROM actividad a LEFT JOIN usuarios u ON u.email=a.email WHERE a.dia>=? GROUP BY a.email, a.dia ORDER BY a.dia").bind(desde).all();
    return json({ filas: rs.results });
  }

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
      /* Quién contacta = el dueño del correo. Solo el administrador puede corregir registros ajenos. */
      if (u.rol !== "admin" && u.nombre) {
        if (col === "llamadas" || col === "virtualLlamadas") {
          const prev = await env.DB.prepare("SELECT json_extract(data,'$.consignador') AS c FROM docs WHERE col=? AND id=? AND deleted=0").bind(col, id).first();
          if (!prev) data.consignador = u.nombre;
          else if ("consignador" in data) data.consignador = prev.c ?? u.nombre;
        } else if ((col === "radar" || col === "virtual") && "consignador" in data && data.consignador) {
          data.consignador = u.nombre;
        }
      }
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
