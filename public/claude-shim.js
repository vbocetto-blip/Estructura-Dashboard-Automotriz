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
  const ready = fetch("/api/me", { credentials: "same-origin" }).then(r => r.ok ? r.json() : null).then(j => { me = j; return j; }).catch(() => null);
  window.claude = { use: async name => { const m = await ready; if (!m) return null; return name === "db" ? db : name === "user" ? user : null; } };
})();
