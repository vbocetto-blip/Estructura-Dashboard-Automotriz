/* Capa de datos del tablero fuera de claude.ai.
   Imita la API que usa el tablero (collection/doc/onSnapshot/set/update/delete) sobre /api de Cloudflare D1.
   Así el código del tablero queda igual al de Claude y cada cambio se puede portar directo. */
(function () {
  "use strict";
  const POLL_MS = 8000;
  const cache = new Map(); // col -> Map(id -> {data, v})
  let since = "", loaded = false, me = null, timer = null, polling = null;
  const subs = new Set();
  const colMap = c => { if (!cache.has(c)) cache.set(c, new Map()); return cache.get(c); };
  const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(15)), b => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("").slice(0, 20);
  const err = (code, msg) => Object.assign(new Error(msg || code), { code });

  async function api(path, opts) {
    const r = await fetch("/api/" + path, { credentials: "same-origin", headers: { "content-type": "application/json" }, ...opts });
    if (r.status === 401) throw err("unauthenticated", "Sesión vencida: recarga la página");
    if (r.status === 403) throw err("invalid_argument", "Sin permiso");
    if (!r.ok) throw err("unavailable", "Error " + r.status);
    return r.json();
  }
  async function poll() {
    if (polling) return polling;
    polling = (async () => {
      try {
        let more = true;
        while (more) {
          const res = await api("changes?since=" + encodeURIComponent(since));
          for (const row of res.rows) {
            const m = colMap(row.col);
            if (row.del) m.delete(row.id); else m.set(row.id, { data: row.data, v: row.v });
            if (row.t > since) since = row.t;
          }
          more = res.more;
        }
        loaded = true;
        subs.forEach(s => { try { s.fire(); } catch (e) { console.error(e); } });
      } catch (e) {
        subs.forEach(s => s.onErr && s.onErr(e));
      } finally { polling = null; }
    })();
    return polling;
  }
  function start() { if (!timer) { timer = setInterval(() => { if (!document.hidden) poll(); }, POLL_MS); document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); }); } }

  const docSnap = (col, id) => { const e = colMap(col).get(id); return { id, exists: !!e, data: () => (e ? JSON.parse(JSON.stringify(e.data)) : undefined) }; };
  const parsePath = p => { const s = String(p).split("/"); return { col: s.slice(0, -1).join("/"), id: s[s.length - 1] }; };
  const match = (data, [f, op, v]) => { const x = data ? data[f] : undefined;
    switch (op) { case "==": return x === v; case "!=": return x !== v; case ">=": return x >= v; case "<=": return x <= v; case ">": return x > v; case "<": return x < v; case "in": return Array.isArray(v) && v.includes(x); default: return true; } };

  function querySnap(col, wheres, prev) {
    const m = colMap(col), docs = [];
    m.forEach((e, id) => { if (wheres.every(w => match(e.data, w))) docs.push(docSnap(col, id)); });
    const changes = [], cur = new Map(docs.map(d => [d.id, colMap(col).get(d.id).v]));
    docs.forEach(d => { if (!prev.has(d.id)) changes.push({ type: "added", doc: d }); else if (prev.get(d.id) !== cur.get(d.id)) changes.push({ type: "modified", doc: d }); });
    prev.forEach((v, id) => { if (!cur.has(id)) changes.push({ type: "removed", doc: { id, exists: false, data: () => undefined } }); });
    return { snap: { docs, size: docs.length, empty: !docs.length, docChanges: () => changes, metadata: { fromCache: false, hasPendingWrites: false } }, cur };
  }
  function subscribe(fire, onErr) { const s = { fire, onErr }; subs.add(s); start(); if (loaded) setTimeout(fire, 0); else poll(); return () => subs.delete(s); }

  async function write(col, id, data, mode) {
    await api("doc", { method: "POST", body: JSON.stringify({ col, id, data, mode }) });
    const m = colMap(col), e = m.get(id);
    m.set(id, { data: mode === "update" && e ? { ...e.data, ...data } : data, v: (e ? e.v : 0) + 0.5 });
    subs.forEach(s => s.fire()); poll();
  }
  function docRef(col, id) {
    return {
      id, path: col + "/" + id,
      get: async () => { if (!loaded) await poll(); return docSnap(col, id); },
      set: data => write(col, id, data, "set"),
      update: data => write(col, id, data, "update"),
      delete: async () => { await api("doc", { method: "DELETE", body: JSON.stringify({ col, id }) }); colMap(col).delete(id); subs.forEach(s => s.fire()); poll(); },
      acquire: async () => ({ acquired: true, release: async () => {} }),
      onSnapshot(next, onErr) { let last; return subscribe(() => { const e = colMap(col).get(id); const v = e ? e.v : -1; if (v !== last) { last = v; next(docSnap(col, id)); } }, onErr); }
    };
  }
  function query(col, wheres) {
    return {
      where: (f, op, v) => query(col, [...wheres, [f, op, v]]),
      orderBy: () => query(col, wheres), limit: () => query(col, wheres),
      get: async () => { if (!loaded) await poll(); return querySnap(col, wheres, new Map()).snap; },
      onSnapshot(next, onErr) { let prev = new Map(), sig = null; return subscribe(() => { const { snap, cur } = querySnap(col, wheres, prev); const s = [...cur].join("|"); if (s !== sig) { sig = s; prev = cur; next(snap); } }, onErr); }
    };
  }
  const db = {
    collection: col => Object.assign(query(col, []), { doc: id => docRef(col, id || rid()), add: async data => { const r = docRef(col, rid()); await r.set(data); return r; } }),
    doc: path => { const { col, id } = parsePath(path); return docRef(col, id); }
  };
  const user = {
    id: async () => me.email, me: async () => ({ id: me.email, email: me.email, name: me.nombre }),
    isOwner: async () => me.rol === "admin", canEdit: async () => me.rol === "admin", can: async () => true,
    profiles: async ids => Object.fromEntries(ids.map(i => [i, { name: "" }]))
  };
  /* Pantalla de ingreso: correo + contraseña. "Primer acceso" crea la contraseña de un correo autorizado que aún no tiene. */
  /* Logo Nexo Motor (N "Carril" + destello), dibujado en SVG: no depende de fuentes ni de archivos externos. */
  const LOGO = `<svg class="lg-logo" viewBox="-84 -14 668 168" role="img" aria-label="Nexo Motor" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="nxmMetal" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="100"><stop offset="0" stop-color="#F7F8FA"/><stop offset=".42" stop-color="#BFC5CE"/><stop offset=".5" stop-color="#858E9C"/><stop offset=".56" stop-color="#D9DDE3"/><stop offset="1" stop-color="#9AA2AF"/></linearGradient><radialGradient id="nxmGlow"><stop offset="0" stop-color="#3B8BFF" stop-opacity=".8"/><stop offset="1" stop-color="#3B8BFF" stop-opacity="0"/></radialGradient><radialGradient id="nxmCore"><stop offset="0" stop-color="#FFF"/><stop offset=".45" stop-color="#CFE4FF" stop-opacity=".9"/><stop offset="1" stop-color="#3B8BFF" stop-opacity="0"/></radialGradient><linearGradient id="nxmRay"><stop offset="0" stop-color="#3B8BFF" stop-opacity="0"/><stop offset=".5" stop-color="#EAF3FF"/><stop offset="1" stop-color="#3B8BFF" stop-opacity="0"/></linearGradient></defs><rect width="22" height="70" fill="url(#nxmMetal)"/><circle cx="11" cy="88" r="12" fill="url(#nxmMetal)"/><rect x="108" y="34" width="22" height="66" fill="url(#nxmMetal)"/><circle cx="119" cy="16" r="11" fill="none" stroke="url(#nxmMetal)" stroke-width="9"/><polygon points="0.0,0 26.0,0 46.8,20 20.8,20" fill="url(#nxmMetal)"/><polygon points="28.1,27 54.1,27 74.9,47 48.9,47" fill="url(#nxmMetal)"/><polygon points="55.1,53 81.1,53 101.9,73 75.9,73" fill="url(#nxmMetal)"/><polygon points="83.2,80 109.2,80 130.0,100 104.0,100" fill="url(#nxmMetal)"/><g transform="translate(154 0)" fill="url(#nxmMetal)"><rect width="22" height="100"/><rect width="110" height="22"/><rect y="39" width="100" height="22"/><rect y="78" width="110" height="22"/></g><g transform="translate(288 0)" fill="url(#nxmMetal)"><polygon points="0,0 30,0 130,100 100,100"/><polygon points="100,0 130,0 30,100 0,100"/></g><rect x="453" y="11" width="108" height="78" rx="20" fill="none" stroke="url(#nxmMetal)" stroke-width="22"/><g transform="translate(2 88)"><circle r="20" fill="url(#nxmGlow)"/><ellipse cx="-10" rx="70" ry="1.6" fill="url(#nxmRay)"/><circle r="6" fill="url(#nxmCore)"/></g><g fill="none" stroke="#C7CCD4" stroke-width="2" stroke-linejoin="round"><path d="M0 138H190M382 138H572" stroke="#6B7480" stroke-width="1"/><g transform="translate(214 132)"><path d="M0 12V0L8 7L16 0V12"/><rect x="32" width="16" height="12" rx="3.5"/><path d="M64 0H80M72 0V12"/><rect x="96" width="16" height="12" rx="3.5"/><path d="M128 12V0H140.5a3.5 3.5 0 0 1 0 7H128M137 7L144 12"/></g></g></svg>`;
  function loginScreen(motivo) {
    const st = document.createElement("style");
    st.textContent = `.lg{position:fixed;inset:0;z-index:100;background:var(--bg,#EEF2F0);display:grid;place-items:center;padding:24px max(16px,env(safe-area-inset-left,0px)) 24px max(16px,env(safe-area-inset-right,0px));overflow:auto}
.lg form{background:var(--surface,#fff);border:1px solid var(--line,#CFD8D4);border-radius:12px;padding:22px;width:min(400px,100%);display:grid;gap:12px;color:var(--ink,#15201D);font-family:var(--f-body,system-ui)}
.lg h1{font-family:var(--f-display,system-ui);font-size:28px;margin:0;line-height:1}.lg-logo{display:block;width:100%;height:auto;background:#05070A;border-radius:10px}.lg p{margin:0;font-size:13.5px;color:var(--muted,#596864)}
.lg label{display:grid;gap:4px;font-size:12px;font-weight:600;color:var(--muted,#596864)}.lg input{border:1px solid var(--line,#CFD8D4);background:var(--surface,#fff);color:inherit;border-radius:8px;padding:10px;font:inherit;font-size:16px}
.lg button{border:0;border-radius:8px;padding:11px;font:inherit;font-weight:700;background:var(--accent,#0D6656);color:var(--on-accent,#fff);cursor:pointer}.lg button:disabled{opacity:.6}
.lg .alt{background:none;color:var(--accent,#0D6656);padding:2px;font-weight:600;justify-self:start}.lg .err{color:var(--bad,#B2261B);font-weight:600;min-height:1em}`;
    document.head.appendChild(st);
    const box = document.createElement("div"); box.className = "lg";
    let modo = "login";
    const draw = () => {
      box.innerHTML = `<form novalidate><h1>${LOGO}</h1>
        <p>${modo === "login" ? "Ingresa con tu correo y contraseña." : "Primer acceso: crea tu contraseña con el código que te entregó el administrador."}</p>
        <label for="lg_email">Correo<input id="lg_email" type="email" autocomplete="username" required></label>
        <label for="lg_pass">${modo === "login" ? "Contraseña" : "Contraseña nueva (mínimo 10 caracteres)"}<input id="lg_pass" type="password" autocomplete="${modo === "login" ? "current-password" : "new-password"}" required></label>
        ${modo === "login" ? "" : `<label for="lg_pass2">Repite la contraseña<input id="lg_pass2" type="password" autocomplete="new-password" required></label>
        <label for="lg_cod">Código de primer acceso<input id="lg_cod" type="text" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" maxlength="20" required></label>`}
        <p class="err" id="lg_err" role="alert">${motivo || ""}</p>
        <button type="submit" id="lg_btn">${modo === "login" ? "Entrar" : "Crear contraseña y entrar"}</button>
        <button type="button" class="alt" id="lg_alt">${modo === "login" ? "¿Primera vez? Crea tu contraseña" : "Ya tengo contraseña"}</button></form>`;
      motivo = "";
      box.querySelector("#lg_alt").onclick = () => { modo = modo === "login" ? "primer" : "login"; draw(); };
      box.querySelector("form").onsubmit = async e => {
        e.preventDefault();
        const em = box.querySelector("#lg_email").value.trim(), pw = box.querySelector("#lg_pass").value, out = box.querySelector("#lg_err"), btn = box.querySelector("#lg_btn");
        if (!em || !pw) { out.textContent = "Escribe tu correo y contraseña."; return; }
        if (modo === "primer") { if (pw.length < 10) { out.textContent = "La contraseña debe tener al menos 10 caracteres."; return; } if (pw !== box.querySelector("#lg_pass2").value) { out.textContent = "Las contraseñas no coinciden."; return; } if (!box.querySelector("#lg_cod").value.trim()) { out.textContent = "Escribe el código de primer acceso que te entregó el administrador."; return; } }
        btn.disabled = true; out.textContent = "";
        try {
          const r = await fetch("/api/" + (modo === "login" ? "login" : "primer-acceso"), { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(modo === "login" ? { email: em, password: pw } : { email: em, password: pw, codigo: box.querySelector("#lg_cod").value }) });
          const j = await r.json().catch(() => ({}));
          if (r.ok) { location.reload(); return; }
          out.textContent = j.error === "bloqueado" ? "Demasiados intentos. Espera 15 minutos." : j.error === "codigo" ? "El código no es correcto o ya venció. Pide uno nuevo al administrador." : j.error === "no_disponible" ? "Este correo no está habilitado para un primer acceso. Si es tu primera vez, pide a Luis que te habilite. Si ya creaste tu contraseña, usa «Ya tengo contraseña» o pide que te la reinicien." : j.error === "clave_corta" ? "La contraseña debe tener al menos 10 caracteres." : "Correo o contraseña incorrectos.";
        } catch { out.textContent = "Sin conexión. Inténtalo de nuevo."; }
        btn.disabled = false;
      };
      setTimeout(() => box.querySelector("#lg_email").focus(), 30);
    };
    draw(); document.body.appendChild(box);
  }
  /* Reloj de gestión: un latido por minuto con su estado.
     gestion = ventana abierta al llamar, escribir por WhatsApp o tomar un aviso (aunque el panel no esté a la vista), hasta registrar el resultado o 12 min;
     activo = panel visible y uso en el último minuto y medio; presente = panel visible sin uso hasta 10 min. Solo se guarda minuto y estado, sin contenido. */
  function latidos() {
    if (window.__ansarLatido) return; window.__ansarLatido = true;
    let ult = Date.now(); window.__ansarGestion = window.__ansarGestion || 0;
    ["pointerdown", "keydown", "wheel", "touchstart", "scroll"].forEach(ev => addEventListener(ev, () => { ult = Date.now(); }, { passive: true, capture: true }));
    addEventListener("click", e => { const t = e.target.closest && e.target.closest('a[href^="tel:"],a[href*="wa.me"],a[href*="whatsapp"],[data-rtake],[data-rquick],[data-pwa],[data-rcopy],[data-sgconf],[data-lwwa],[data-pcopy]'); if (t) window.__ansarGestion = Date.now() + 12 * 60000; }, true);
    const pag = location.pathname.includes("patio") ? "patio" : "tablero";
    const estado = () => { const now = Date.now(), vis = document.visibilityState === "visible";
      if (window.__ansarGestion > now) return "gestion";
      if (vis && now - ult < 90000) return "activo";
      if (vis && now - ult < 600000) return "presente";
      return ""; };
    const tick = () => { const e = estado(); window.__ansarEstado = e || "pausa"; if (!e) return;
      fetch("/api/latido", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ pagina: (window.__ansarVista ? pag + ":" + window.__ansarVista : pag).slice(0, 20), estado: e }), keepalive: true }).catch(() => {}); };
    setInterval(tick, 60000); setTimeout(tick, 5000);
  }
  function logoutButton() {
    const menu = document.getElementById("masMenu"), row = menu || document.querySelector(".toprow"); if (!row || document.getElementById("btnSalir")) return;
    const b = document.createElement("button"); if (!menu) b.className = "btn"; b.id = "btnSalir"; b.type = "button"; b.textContent = "Salir";
    b.title = me ? me.email : ""; b.onclick = async () => { try { await fetch("/api/logout", { method: "POST", credentials: "same-origin" }); } catch {} location.reload(); };
    row.appendChild(b);
  }
  const ready = fetch("/api/me", { credentials: "same-origin" }).then(r => r.ok ? r.json() : (r.status === 403 ? { _sinAcceso: true } : null)).then(j => {
    const go = fn => document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", fn) : fn();
    if (!j) { go(() => loginScreen()); return null; }
    if (j._sinAcceso) { go(() => loginScreen("Tu correo no está autorizado. Pide acceso a un administrador.")); return null; }
    me = j; window.__ANSAR_ROL = j.rol; window.__ANSAR_NOMBRE = j.nombre || ""; window.__ANSAR_VEREQ = !!j.verEquipo; go(logoutButton); latidos(); return j;
  }).catch(() => null);
  window.__ANSAR_SITE = true;
  window.claude = { use: async name => { const m = await ready; if (!m) return null; return name === "db" ? db : name === "user" ? user : null; } };
})();
