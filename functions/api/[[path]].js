/* API del tablero Ansar sobre Cloudflare D1.
   Login: Cloudflare Access. Cada request trae un JWT firmado (Cf-Access-Jwt-Assertion) que se verifica aquí.
   Roles: admin ve y escribe todo; virtual solo las colecciones de Consignación virtual. */
import { reconocer, TIPOS } from "../../public/js/catalogo-autos.js";
import { OPC as LW_OPC, perfilConsigna, puntaje as lwScore, normHorario, diasDisponibles, citaValida, ahoraChile, franjaDe } from "../../public/js/perfil-consigna.js";
const VIRTUAL_RW = new Set(["virtual", "virtualLlamadas"]);
const VIRTUAL_RO = new Set(["config/virtual", "config/jornada"]);
const json = (o, s = 200, extra = {}) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...extra } });
const now = () => new Date().toISOString();

let certCache = null, certAt = 0;
const b64u = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), c => c.charCodeAt(0));
async function verifyAccess(request, env) {
  const tok = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!tok || !env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null;
  const [h, p, sig] = tok.split(".");
  if (!h || !p || !sig) return null;
  let head, pay;
  try { head = JSON.parse(new TextDecoder().decode(b64u(h))); pay = JSON.parse(new TextDecoder().decode(b64u(p))); } catch { return null; }
  if (!head || head.alg !== "RS256" || !pay || typeof pay.exp !== "number") return null;
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
const SES_DIAS = 14, MIN_PASS = 10, PRIMER_ACCESO_H = 48;
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
    const abierto = await env.DB.prepare("SELECT 1 FROM auditoria WHERE id=? AND (accion='reset_clave' OR (accion LIKE 'usuario_%' AND accion NOT LIKE '%_inactivo')) AND cuando>? LIMIT 1").bind(email, new Date(Date.now() - PRIMER_ACCESO_H * 3600e3).toISOString()).first();
    if (!abierto) return json({ error: "no_disponible" }, 400);
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
async function sha256hex(t) { return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t))); }
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
  if (d.modalidad === "llamada") d.franja = "";
  let cita = null;
  if (b.cita && (d.modalidad === "presencial" || d.modalidad === "virtual")) {
    const f = String(b.cita.fecha || ""), h = String(b.cita.hora || "");
    if (!/^\d{4}-\d\d-\d\d$/.test(f) || !/^\d\d:\d\d$/.test(h)) return json({ error: "cita_invalida" }, 400);
    const ag = await agendaEstado(env);
    if (!citaValida(ag.cfg, f, h, ag.ahora, ag.tomados)) return json({ error: "hora_no_disponible" }, 409);
    cita = { fecha: f, hora: h, duracion: ag.cfg.duracion, tipo: d.modalidad === "virtual" ? "Videollamada" : "Tasación presencial" };
    d.cita = cita; d.franja = franjaDe(cita);
  }
  if (!d.nombre || !d.marca || !d.modelo || !d.anio || !d.cuando) return json({ error: "faltan_datos" }, 400);
  const t = now(), ip = request.headers.get("CF-Connecting-IP") || "", ipHash = (await sha256hex(ip + t.slice(0, 10))).slice(0, 16);
  const hora = new Date(Date.now() - 3600e3).toISOString();
  const rl = await env.DB.prepare("SELECT COUNT(*) AS n FROM docs WHERE col='leadsWeb' AND updated_at>? AND json_extract(data,'$.ipHash')=?").bind(hora, ipHash).first();
  if (rl && rl.n >= 5) return json({ error: "demasiados_envios" }, 429);
  const src = b.src && typeof b.src === "object" ? b.src : {};
  d.tipoDeclarado = TIPOS[b.tipo] ? b.tipo : "";
  let mk = null; try { mk = await mercado(env, d.marca, d.modelo, d.anio, d.tipoDeclarado); } catch {}
  if (mk) {
    const c = mk.comparable;
    d.vehiculo = { estado: mk.vehiculo.estado, marca: mk.vehiculo.marca, modelo: mk.vehiculo.modelo, tipo: mk.vehiculo.tipo, original: mk.vehiculo.original };
    d.mercado = { nivel: c.nivel, n: c.n, nModelo: mk.modelo.n, nCercanos: c.nivel === "modelo" ? mk.modelo.nCercanos : c.n, mediana: c.mediana, p25: c.p25, p75: c.p75, kmMediana: c.kmMediana,
      tipo: mk.vehiculo.tipoTxt, similares: c.similares, totalRegion: mk.region.total, desde: mk.region.desde };
  }
  d.vistos = Array.isArray(b.vistos) ? b.vistos.filter(x => typeof x === "string").slice(0, 12).map(x => LW_TXT(x, 30)) : [];
  const pf = perfilConsigna(d);
  Object.assign(d, lwScore(d), { perfil: { version: pf.version, arquetipo: pf.arquetipo, cliente: pf.cliente, interno: pf.interno } }, {
    fuente: LW_TXT(src.utm_source || (src.fbclid ? "meta" : "directo"), 30), campana: LW_TXT(src.utm_campaign, 60), anuncio: LW_TXT(src.utm_content, 60),
    consentimiento: { acepta: true, texto: LW_TXT(b.textoConsentimiento, 300), version: LW_TXT(b.versionPolitica, 20), en: t },
    estado: "Nuevo", creadoEn: t, ipHash });
  const id = "lw_" + t.replace(/\D/g, "").slice(0, 14) + "_" + randHex(3);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO docs (col,id,data,version,updated_at,updated_by,deleted) VALUES ('leadsWeb',?,?,1,?,?,0)").bind(id, JSON.stringify(d), t, "formulario"),
    env.DB.prepare("INSERT INTO auditoria (cuando,email,accion,col,id) VALUES (?,?,?,?,?)").bind(t, "formulario", "lead_web", "leadsWeb", id),
    ...(cita ? [env.DB.prepare("INSERT INTO docs (col,id,data,version,updated_at,updated_by,deleted) VALUES ('agenda',?,?,1,?,?,0)").bind(id, JSON.stringify({
      ...cita, leadId: id, nombre: d.nombre, tel: d.tel, auto: [d.marca, d.modelo, d.anio].filter(Boolean).join(" "), etiqueta: d.etiqueta, perfil: d.perfil && d.perfil.interno ? d.perfil.interno.nombre : "",
      origen: "Formulario web", estado: "Por confirmar", creadoEn: t }), t, "formulario")] : [])]);
  return json({ ok: true });
}

/* ---------- Datos de mercado para el formulario público (sin login) ----------
   Solo agregados (cantidad, mediana, rango) de avisos de particulares que vio el radar en la IV Región.
   Nunca devuelve links, ids, teléfonos ni avisos individuales. */
const normTxt = s => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
const pct = (arr, q) => { if (!arr.length) return null; const a = [...arr].sort((x, y) => x - y), i = (a.length - 1) * q, lo = Math.floor(i); return Math.round(a[lo] + (a[Math.ceil(i)] - a[lo]) * (i - lo)); };
const TIPO_RADAR = { "SUV": "suv", "Pickup": "pickup", "Sedán": "sedan", "Hatchback": "hatch", "Furgón / Van": "van", "Minivan": "minivan" };
const statsDe = lista => {
  const precios = lista.map(x => Number(x.precio)), kms = lista.map(x => Number(x.km)).filter(k => k > 0);
  return { n: lista.length, mediana: lista.length >= 3 ? pct(precios, .5) : null, p25: lista.length >= 4 ? pct(precios, .25) : null, p75: lista.length >= 4 ? pct(precios, .75) : null,
    kmMediana: kms.length >= 3 ? pct(kms, .5) : null };
};
/* tipoCliente: el tipo que eligió el cliente cuando no reconocimos su modelo */
let radarCache = null, radarAt = 0;
export async function mercado(env, marca, modelo, anio, tipoCliente) {
  if (!radarCache || Date.now() - radarAt > 300e3) { radarCache = await env.DB.prepare("SELECT id, data FROM docs WHERE col IN ('radar','virtual') AND deleted=0").all(); radarAt = Date.now(); }
  const r = radarCache;
  const vistos = new Map();
  for (const row of r.results || []) { if (vistos.has(row.id)) continue; try { vistos.set(row.id, JSON.parse(row.data)); } catch {} }
  const todos = [...vistos.values()].filter(x => x && Number(x.precio) > 0).map(x => {
    const rc = reconocer(x.marca, x.modelo);
    return { ...x, _marca: rc.marca, _modelo: rc.modelo, _tipo: rc.tipo || TIPO_RADAR[x.perfil] || null };
  });
  const desde = todos.reduce((m, x) => (x.primerRadar && (!m || x.primerRadar < m) ? x.primerRadar : m), null);
  const portales = new Set(todos.map(x => x.src).filter(Boolean)).size;
  const vh = reconocer(marca, modelo), an = parseInt(anio, 10) || 0;
  const tipo = vh.tipo || (TIPOS[tipoCliente] ? tipoCliente : null);
  const cerca = (lista, k) => an ? lista.filter(x => Math.abs((parseInt(x.anio, 10) || 0) - an) <= k) : lista;
  const deMarca = vh.marca ? todos.filter(x => x._marca === vh.marca) : [];
  const deModelo = vh.modelo ? deMarca.filter(x => x._modelo === vh.modelo) : [];
  const modCerca = cerca(deModelo, 1);
  const deTipo = tipo ? todos.filter(x => x._tipo === tipo) : [], tipoCerca = cerca(deTipo, 2);
  let nivel, base;
  if (deModelo.length >= 2) { nivel = "modelo"; base = modCerca.length >= 3 ? modCerca : deModelo; }
  else if (tipoCerca.length >= 3) { nivel = "tipo"; base = tipoCerca; }
  else if (deTipo.length >= 3) { nivel = "tipo"; base = deTipo; }
  else { nivel = "region"; base = an ? cerca(todos, 2) : todos; if (base.length < 3) base = todos; }
  const cuenta = new Map(); base.forEach(x => { if (x._marca && x._modelo) { const k = x._marca + " " + x._modelo; cuenta.set(k, (cuenta.get(k) || 0) + 1); } });
  const similares = [...cuenta.entries()].sort((a, b) => b[1] - a[1]).filter(([k]) => k !== [vh.marca, vh.modelo].join(" ")).slice(0, 3).map(([k, n]) => ({ auto: k, n }));
  const st = statsDe(base);
  return {
    region: { total: todos.length, desde, portales },
    vehiculo: { ...vh, tipo, tipoTxt: tipo ? TIPOS[tipo] : null, original: [marca, modelo].filter(Boolean).join(" ") },
    marca: { n: deMarca.length },
    modelo: { n: deModelo.length, nCercanos: modCerca.length, base: modCerca.length >= 3 && an ? "anio±1" : "modelo", ...(nivel === "modelo" ? st : { mediana: null }) },
    comparable: { nivel, aniosCerca: base !== deTipo && base !== deModelo && base !== todos && !!an, ...st, similares }
  };
}
async function mercadoPublico(request, env) {
  const u = new URL(request.url), q = k => (u.searchParams.get(k) || "").slice(0, 40);
  const m = await mercado(env, q("marca"), q("modelo"), q("anio"), q("tipo"));
  return json(m, 200, { "cache-control": "public, max-age=600" });
}

/* ---------- Agenda pública: solo qué horas quedan libres, nunca quién las tomó ---------- */
const AG_ACTIVA = "json_extract(data,'$.estado') NOT IN ('Cancelada','Reagendada')";
async function agendaEstado(env) {
  const cfgRow = await env.DB.prepare("SELECT data FROM docs WHERE col='config' AND id='agenda' AND deleted=0").first();
  let cfg = null; try { cfg = cfgRow ? JSON.parse(cfgRow.data) : null; } catch {}
  cfg = normHorario(cfg);
  const ahora = ahoraChile(), hoy = ahora.slice(0, 10);
  const rs = await env.DB.prepare(`SELECT json_extract(data,'$.fecha') f, json_extract(data,'$.hora') h, COUNT(*) n FROM docs WHERE col='agenda' AND deleted=0 AND json_extract(data,'$.fecha')>=? AND ${AG_ACTIVA} GROUP BY f,h`).bind(hoy).all();
  const tomados = {}; for (const r of rs.results || []) tomados[r.f + " " + r.h] = r.n;
  return { cfg, ahora, tomados };
}
async function agendaPublica(env) {
  const { cfg, ahora, tomados } = await agendaEstado(env);
  return json({ ahora, duracion: cfg.duracion, dias: diasDisponibles(cfg, ahora, tomados) });
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
const URL_OK = /^https?:\/\//i;
const limpiaUrls = (o, n = 0) => { if (!o || typeof o !== "object" || n > 6) return; for (const k of Object.keys(o)) { const v = o[k]; if (typeof v === "string") { if (/^(url|link|href|enlace)$/i.test(k) && v && !URL_OK.test(v.trim())) o[k] = ""; } else limpiaUrls(v, n + 1); } };
const validName = s => typeof s === "string" && /^[A-Za-z0-9_\-.:@+~]{1,200}$/.test(s);

export async function onRequest(ctx) {
  const { request, env, params } = ctx;
  if ((params.path || []).join("/") === "lead-consigna" && request.method === "POST") return leadConsigna(request, env);
  if ((params.path || []).join("/") === "mercado" && request.method === "GET") return mercadoPublico(request, env);
  if ((params.path || []).join("/") === "agenda-libre" && request.method === "GET") return agendaPublica(env);
  const ar = await authRoutes((params.path || []).join("/"), request, env);
  if (ar) return ar;
  const email = (await sessionEmail(request, env)) || (await verifyAccess(request, env));
  if (!email) return json({ error: "no_autenticado" }, 401);
  const u = await env.DB.prepare("SELECT email,nombre,rol FROM usuarios WHERE email=? AND activo=1").bind(email).first();
  if (!u) return json({ error: "sin_acceso", email }, 403);
  const path = (params.path || []).join("/");
  const url = new URL(request.url);

  /* Permiso puntual para ver el reloj de todo el equipo, sin ser administrador: config/jornada.verEquipo = [correos]. */
  const verEquipo = async () => { if (u.rol === "admin") return true; try { const r = await env.DB.prepare("SELECT json_extract(data,'$.verEquipo') AS v FROM docs WHERE col='config' AND id='jornada' AND deleted=0").first(); return !!(r && r.v && JSON.parse(r.v).map(x => String(x).toLowerCase()).includes(u.email.toLowerCase())); } catch { return false; } };
  if (path === "me") return json({ email: u.email, nombre: u.nombre, rol: u.rol, verEquipo: await verEquipo() });

  /* Prueba de rendimiento: un latido por minuto activo (pestaña visible + interacción reciente). Solo minuto sí/no, sin contenido. */
  if (path === "latido" && request.method === "POST") {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date()).map(x => [x.type, x.value]));
    let pag = "", est = "activo"; try { const b = await request.json(); pag = String(b.pagina || "").slice(0, 20); if (["activo", "gestion", "presente"].includes(b.estado)) est = b.estado; } catch {}
    /* Un minuto guarda su mejor estado: gestión (llamando o escribiendo) > activo (usando el panel) > presente (panel abierto sin uso). */
    await env.DB.prepare("INSERT INTO actividad (email,dia,minuto,pagina,estado) VALUES (?,?,?,?,?) ON CONFLICT(email,dia,minuto) DO UPDATE SET estado = CASE WHEN (CASE excluded.estado WHEN 'gestion' THEN 3 WHEN 'activo' THEN 2 ELSE 1 END) > (CASE coalesce(actividad.estado,'activo') WHEN 'gestion' THEN 3 WHEN 'activo' THEN 2 ELSE 1 END) THEN excluded.estado ELSE coalesce(actividad.estado,'activo') END").bind(u.email, `${p.year}-${p.month}-${p.day}`, `${p.hour === "24" ? "00" : p.hour}:${p.minute}`, pag, est).run();
    return json({ ok: true });
  }
  /* Reloj: cada persona ve sus minutos; el administrador puede ver a cualquiera o el resumen del equipo. */
  if (path === "reloj" && request.method === "GET") {
    const okD = d => /^\d{4}-\d{2}-\d{2}$/.test(d || "");
    const desde = okD(url.searchParams.get("desde")) ? url.searchParams.get("desde") : "2000-01-01";
    const hasta = okD(url.searchParams.get("hasta")) ? url.searchParams.get("hasta") : "2999-12-31";
    const pedido = (url.searchParams.get("email") || "").toLowerCase();
    const puede = await verEquipo();
    if (pedido === "equipo") {
      if (!puede) return json({ error: "sin_permiso" }, 403);
      const rs = await env.DB.prepare("SELECT a.email, u.nombre, a.dia, a.minuto, coalesce(a.estado,'activo') AS e FROM actividad a LEFT JOIN usuarios u ON u.email=a.email WHERE a.dia BETWEEN ? AND ? ORDER BY a.email, a.dia, a.minuto").bind(desde, hasta).all();
      return json({ filas: rs.results });
    }
    const email = puede && pedido ? pedido : u.email;
    const rs = await env.DB.prepare("SELECT a.email, u.nombre, a.dia, a.minuto, coalesce(a.estado,'activo') AS e FROM actividad a LEFT JOIN usuarios u ON u.email=a.email WHERE a.email=? AND a.dia BETWEEN ? AND ? ORDER BY a.dia, a.minuto").bind(email, desde, hasta).all();
    return json({ email, filas: rs.results });
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
        limpiaUrls(data);
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
      limpiaUrls(data);
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
