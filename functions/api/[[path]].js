/* API del tablero Ansar sobre Cloudflare D1.
   Login: Cloudflare Access. Cada request trae un JWT firmado (Cf-Access-Jwt-Assertion) que se verifica aquí.
   Roles: admin ve y escribe todo; virtual solo las colecciones de Consignación virtual. */
const VIRTUAL_RW = new Set(["virtual", "virtualLlamadas"]);
const VIRTUAL_RO = new Set(["config/virtual"]);
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
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
function canRead(rol, col, id) {
  if (rol === "admin") return true;
  return VIRTUAL_RW.has(col) || VIRTUAL_RO.has(`${col}/${id}`);
}
function canWrite(rol, col) {
  if (rol === "admin") return true;
  return VIRTUAL_RW.has(col);
}
const validName = s => typeof s === "string" && /^[A-Za-z0-9_\-.:@+~]{1,200}$/.test(s);

export async function onRequest(ctx) {
  const { request, env, params } = ctx;
  const email = await verifyAccess(request, env);
  if (!email) return json({ error: "no_autenticado" }, 401);
  const u = await env.DB.prepare("SELECT email,nombre,rol FROM usuarios WHERE email=? AND activo=1").bind(email).first();
  if (!u) return json({ error: "sin_acceso", email }, 403);
  const path = (params.path || []).join("/");
  const url = new URL(request.url);

  if (path === "me") return json({ email: u.email, nombre: u.nombre, rol: u.rol });

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
