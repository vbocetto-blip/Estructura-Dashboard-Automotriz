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
  /* Logo Pulso Motor (iris Vigía con velocímetro + wordmark), dibujado en SVG: no depende de fuentes ni de archivos externos. */
  const LOGO = `<svg class="lg-logo" viewBox="-48 -22 467 194" role="img" aria-label="Pulso Motor" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="pmWm" gradientUnits="userSpaceOnUse" x1="178" y1="27.623046875" x2="365.31562499999995" y2="85.826171875"><stop offset="0" stop-color="#FFFFFF"/><stop offset="0.5" stop-color="#EEF2F5"/><stop offset="1" stop-color="#CFD9E1"/></linearGradient></defs><g transform="scale(0.9375)"><defs><radialGradient id="pmIris" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#9DB86A"/><stop offset="38%" stop-color="#5E9A5C"/><stop offset="68%" stop-color="#3F8466"/><stop offset="88%" stop-color="#4A7684"/><stop offset="100%" stop-color="#55666F"/></radialGradient><linearGradient id="pmPearl" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#FFFFFF"/><stop offset="55%" stop-color="#EEF2F5"/><stop offset="100%" stop-color="#D3DCE3"/></linearGradient></defs><g transform="translate(80 80) scale(2.75) translate(-80 -80)"><circle cx="80" cy="80" r="27" fill="url(#pmIris)"/><g stroke="#B9D39A" stroke-width="1.4" stroke-linecap="round" opacity="0.4"><path d="M92.0 80.0 L104.0 80.0"/><path d="M91.6 83.1 L103.2 86.2"/><path d="M90.4 86.0 L100.8 92.0"/><path d="M88.5 88.5 L97.0 97.0"/><path d="M86.0 90.4 L92.0 100.8"/><path d="M83.1 91.6 L86.2 103.2"/><path d="M80.0 92.0 L80.0 104.0"/><path d="M76.9 91.6 L73.8 103.2"/><path d="M74.0 90.4 L68.0 100.8"/><path d="M71.5 88.5 L63.0 97.0"/><path d="M69.6 86.0 L59.2 92.0"/><path d="M68.4 83.1 L56.8 86.2"/><path d="M68.0 80.0 L56.0 80.0"/><path d="M68.4 76.9 L56.8 73.8"/><path d="M69.6 74.0 L59.2 68.0"/><path d="M71.5 71.5 L63.0 63.0"/><path d="M74.0 69.6 L68.0 59.2"/><path d="M76.9 68.4 L73.8 56.8"/><path d="M80.0 68.0 L80.0 56.0"/><path d="M83.1 68.4 L86.2 56.8"/><path d="M86.0 69.6 L92.0 59.2"/><path d="M88.5 71.5 L97.0 63.0"/><path d="M90.4 74.0 L100.8 68.0"/><path d="M91.6 76.9 L103.2 73.8"/></g><circle cx="80" cy="80" r="27" fill="none" stroke="#2F4250" stroke-width="2.4"/><g stroke="url(#pmPearl)" stroke-width="1.6" stroke-linecap="round" opacity="0.9"><path d="M67.3 92.7 L62.3 97.7"/><path d="M62.7 90.0 L58.3 92.5"/><path d="M60.7 85.2 L55.9 86.5"/><path d="M62.0 80.0 L55.0 80.0"/><path d="M60.7 74.8 L55.9 73.5"/><path d="M62.7 70.0 L58.3 67.5"/><path d="M67.3 67.3 L62.3 62.3"/><path d="M70.0 62.7 L67.5 58.3"/><path d="M74.8 60.7 L73.5 55.9"/><path d="M80.0 62.0 L80.0 55.0"/><path d="M85.2 60.7 L86.5 55.9"/><path d="M90.0 62.7 L92.5 58.3"/><path d="M92.7 67.3 L97.7 62.3"/><path d="M97.3 70.0 L101.7 67.5"/><path d="M99.3 74.8 L104.1 73.5"/><path d="M98.0 80.0 L105.0 80.0"/><path d="M99.3 85.2 L104.1 86.5"/><path d="M97.3 90.0 L101.7 92.5"/><path d="M92.7 92.7 L97.7 97.7"/></g><path d="M80 80 L99.7 66.2" fill="none" stroke="url(#pmPearl)" stroke-width="3.2" stroke-linecap="round"/><circle cx="80" cy="80" r="11" fill="#0A0F14"/><circle cx="74" cy="73" r="3.6" fill="url(#pmPearl)" opacity="0.9"/></g></g><path d="M182.21875 85.826171875V27.623046875H204.0546875Q210.7734375 27.623046875 215.32421875 30.123046875Q219.875 32.623046875 222.21875 36.998046875Q224.5625 41.373046875 224.5625 46.919921875Q224.5625 52.505859375 222.19921875 56.861328125Q219.8359375 61.216796875 215.2265625 63.697265625Q210.6171875 66.177734375 203.8984375 66.177734375H192.765625V85.826171875ZM192.765625 57.505859375H202.453125Q206.3984375 57.505859375 208.91796875 56.158203125Q211.4375 54.810546875 212.62890625 52.408203125Q213.8203125 50.005859375 213.8203125 46.919921875Q213.8203125 43.794921875 212.62890625 41.431640625Q211.4375 39.068359375 208.91796875 37.759765625Q206.3984375 36.451171875 202.4140625 36.451171875H192.765625ZM255.278125 67.505859375V42.154296875H265.5515625V85.826171875H255.590625V78.052734375H255.121875Q253.6375 81.724609375 250.278125 84.068359375Q246.91875 86.412109375 241.996875 86.373046875Q237.7 86.373046875 234.43828125 84.478515625Q231.1765625 82.583984375 229.32109375 78.892578125Q227.465625 75.201171875 227.465625 69.966796875V42.154296875H237.7390625V68.404296875Q237.7390625 72.505859375 240.02421875 74.966796875Q242.309375 77.427734375 246.0203125 77.388671875Q248.2859375 77.388671875 250.41484375 76.294921875Q252.54375 75.201171875 253.9109375 73.013671875Q255.278125 70.826171875 255.278125 67.505859375ZM280.603125 27.623046875V85.826171875H270.3296875V27.623046875ZM319.83437499999997 53.755859375 310.49843749999997 54.732421875Q309.91249999999997 52.583984375 307.95937499999997 50.923828125Q306.00624999999997 49.263671875 302.45156249999997 49.263671875Q299.24843749999997 49.263671875 297.08046874999997 50.669921875Q294.91249999999997 52.076171875 294.91249999999997 54.263671875Q294.91249999999997 56.177734375 296.33828124999997 57.408203125Q297.76406249999997 58.638671875 301.08437499999997 59.380859375L308.54531249999997 60.943359375Q314.67812499999997 62.232421875 317.72499999999997 65.162109375Q320.77187499999997 68.091796875 320.77187499999997 72.740234375Q320.77187499999997 76.841796875 318.38906249999997 80.005859375Q316.00624999999997 83.169921875 311.80703124999997 84.927734375Q307.60781249999997 86.685546875 302.13906249999997 86.685546875Q294.13124999999997 86.685546875 289.26796874999997 83.306640625Q284.40468749999997 79.927734375 283.42812499999997 73.912109375L293.46718749999997 72.974609375Q294.13124999999997 75.904296875 296.37734374999997 77.408203125Q298.62343749999997 78.912109375 302.13906249999997 78.912109375Q305.81093749999997 78.912109375 308.03749999999997 77.408203125Q310.26406249999997 75.904296875 310.26406249999997 73.716796875Q310.26406249999997 70.044921875 304.40468749999997 68.716796875L296.94374999999997 67.154296875Q290.65468749999997 65.787109375 287.64687499999997 62.720703125Q284.63906249999997 59.654296875 284.63906249999997 54.888671875Q284.63906249999997 50.826171875 286.86562499999997 47.857421875Q289.09218749999997 44.888671875 293.07656249999997 43.248046875Q297.06093749999997 41.607421875 302.29531249999997 41.607421875Q309.99062499999997 41.607421875 314.38515624999997 44.908203125Q318.77968749999997 48.208984375 319.83437499999997 53.755859375ZM342.50312499999995 86.685546875Q336.09687499999995 86.685546875 331.40937499999995 83.873046875Q326.72187499999995 81.060546875 324.16328124999995 75.982421875Q321.60468749999995 70.904296875 321.60468749999995 64.185546875Q321.60468749999995 57.427734375 324.16328124999995 52.330078125Q326.72187499999995 47.232421875 331.40937499999995 44.419921875Q336.09687499999995 41.607421875 342.50312499999995 41.607421875Q348.90937499999995 41.607421875 353.59687499999995 44.419921875Q358.28437499999995 47.232421875 360.86249999999995 52.330078125Q363.44062499999995 57.427734375 363.44062499999995 64.185546875Q363.44062499999995 70.904296875 360.86249999999995 75.982421875Q358.28437499999995 81.060546875 353.59687499999995 83.873046875Q348.90937499999995 86.685546875 342.50312499999995 86.685546875ZM342.50312499999995 78.404296875Q346.05781249999995 78.404296875 348.36249999999995 76.509765625Q350.66718749999995 74.615234375 351.81953124999995 71.373046875Q352.97187499999995 68.130859375 352.97187499999995 64.185546875Q352.97187499999995 60.162109375 351.81953124999995 56.919921875Q350.66718749999995 53.677734375 348.36249999999995 51.783203125Q346.05781249999995 49.888671875 342.50312499999995 49.888671875Q339.02656249999995 49.888671875 336.68281249999995 51.783203125Q334.33906249999995 53.677734375 333.18671874999995 56.919921875Q332.03437499999995 60.162109375 332.03437499999995 64.185546875Q332.03437499999995 68.130859375 333.18671874999995 71.373046875Q334.33906249999995 74.615234375 336.68281249999995 76.509765625Q339.02656249999995 78.404296875 342.50312499999995 78.404296875Z" fill="url(#pmWm)"/><path d="M183.171875 107.826171875H185.84765625L190.4765625 119.134765625H190.642578125L195.28125 107.826171875H197.99609375V122.376953125H195.84765625V111.849609375H195.7109375L191.404296875 122.357421875H189.666015625L185.408203125 111.83984375H185.271484375V122.376953125H183.171875ZM215.63359375 122.572265625Q213.75859375 122.572265625 212.27421875 121.673828125Q210.78984375 120.775390625 209.93046875 119.1005859375Q209.07109375 117.42578125 209.07109375 115.111328125Q209.07109375 112.77734375 209.93046875 111.1025390625Q210.78984375 109.427734375 212.27421875 108.529296875Q213.75859375 107.630859375 215.63359375 107.630859375Q217.528125 107.630859375 219.002734375 108.529296875Q220.47734375 109.427734375 221.3318359375 111.1025390625Q222.186328125 112.77734375 222.186328125 115.111328125Q222.186328125 117.435546875 221.3318359375 119.10546875Q220.47734375 120.775390625 219.002734375 121.673828125Q217.528125 122.572265625 215.63359375 122.572265625ZM215.63359375 120.5703125Q216.893359375 120.5703125 217.8796875 119.9453125Q218.866015625 119.3203125 219.4373046875 118.099609375Q220.00859375 116.87890625 220.00859375 115.111328125Q220.00859375 113.333984375 219.4373046875 112.1083984375Q218.866015625 110.8828125 217.8796875 110.2578125Q216.893359375 109.6328125 215.63359375 109.6328125Q214.38359375 109.6328125 213.3923828125 110.2578125Q212.401171875 110.8828125 211.825 112.1083984375Q211.248828125 113.333984375 211.248828125 115.111328125Q211.248828125 116.87890625 211.825 118.099609375Q212.401171875 119.3203125 213.3923828125 119.9453125Q214.38359375 120.5703125 215.63359375 120.5703125ZM232.53867187499998 109.7109375V107.826171875H243.80820312499998V109.7109375H239.27695312499998V122.376953125H237.08945312499998V109.7109375ZM260.72304687499997 122.572265625Q258.84804687499997 122.572265625 257.36367187499997 121.673828125Q255.87929687499997 120.775390625 255.01992187499997 119.1005859375Q254.16054687499997 117.42578125 254.16054687499997 115.111328125Q254.16054687499997 112.77734375 255.01992187499997 111.1025390625Q255.87929687499997 109.427734375 257.36367187499997 108.529296875Q258.84804687499997 107.630859375 260.72304687499997 107.630859375Q262.61757812499997 107.630859375 264.09218749999997 108.529296875Q265.56679687499997 109.427734375 266.42128906249997 111.1025390625Q267.27578124999997 112.77734375 267.27578124999997 115.111328125Q267.27578124999997 117.435546875 266.42128906249997 119.10546875Q265.56679687499997 120.775390625 264.09218749999997 121.673828125Q262.61757812499997 122.572265625 260.72304687499997 122.572265625ZM260.72304687499997 120.5703125Q261.98281249999997 120.5703125 262.96914062499997 119.9453125Q263.95546874999997 119.3203125 264.52675781249997 118.099609375Q265.09804687499997 116.87890625 265.09804687499997 115.111328125Q265.09804687499997 113.333984375 264.52675781249997 112.1083984375Q263.95546874999997 110.8828125 262.96914062499997 110.2578125Q261.98281249999997 109.6328125 260.72304687499997 109.6328125Q259.47304687499997 109.6328125 258.48183593749997 110.2578125Q257.49062499999997 110.8828125 256.91445312499997 112.1083984375Q256.33828124999997 113.333984375 256.33828124999997 115.111328125Q256.33828124999997 116.87890625 256.91445312499997 118.099609375Q257.49062499999997 119.3203125 258.48183593749997 119.9453125Q259.47304687499997 120.5703125 260.72304687499997 120.5703125ZM278.35078124999995 122.376953125V107.826171875H283.54609374999995Q285.23554687499995 107.826171875 286.34882812499995 108.4072265625Q287.46210937499995 108.98828125 288.01874999999995 110.0185546875Q288.57539062499995 111.048828125 288.57539062499995 112.396484375Q288.57539062499995 113.724609375 288.01874999999995 114.740234375Q287.46210937499995 115.755859375 286.34882812499995 116.3125Q286.14374999999995 116.41015625 285.91914062499995 116.498046875L289.13203124999995 122.376953125H286.63203124999995L283.67304687499995 116.869140625Q283.60468749999995 116.869140625 283.52656249999995 116.869140625H280.54804687499995V122.376953125ZM280.54804687499995 114.994140625H283.32148437499995Q284.40546874999995 114.994140625 285.07441406249995 114.681640625Q285.74335937499995 114.369140625 286.05097656249995 113.79296875Q286.35859374999995 113.216796875 286.35859374999995 112.396484375Q286.35859374999995 111.56640625 286.04609374999995 110.9658203125Q285.73359374999995 110.365234375 285.06464843749995 110.0380859375Q284.39570312499995 109.7109375 283.31171874999995 109.7109375H280.54804687499995Z" fill="#A9BFD8"/></svg>`;
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
        <p>${modo === "login" ? "Ingresa con tu correo y contraseña." : "Primer acceso: crea tu contraseña. Solo funciona para correos autorizados que aún no tienen una."}</p>
        <label for="lg_email">Correo<input id="lg_email" type="email" autocomplete="username" required></label>
        <label for="lg_pass">${modo === "login" ? "Contraseña" : "Contraseña nueva (mínimo 10 caracteres)"}<input id="lg_pass" type="password" autocomplete="${modo === "login" ? "current-password" : "new-password"}" required></label>
        ${modo === "login" ? "" : `<label for="lg_pass2">Repite la contraseña<input id="lg_pass2" type="password" autocomplete="new-password" required></label>`}
        <p class="err" id="lg_err" role="alert">${motivo || ""}</p>
        <button type="submit" id="lg_btn">${modo === "login" ? "Entrar" : "Crear contraseña y entrar"}</button>
        <button type="button" class="alt" id="lg_alt">${modo === "login" ? "¿Primera vez? Crea tu contraseña" : "Ya tengo contraseña"}</button></form>`;
      motivo = "";
      box.querySelector("#lg_alt").onclick = () => { modo = modo === "login" ? "primer" : "login"; draw(); };
      box.querySelector("form").onsubmit = async e => {
        e.preventDefault();
        const em = box.querySelector("#lg_email").value.trim(), pw = box.querySelector("#lg_pass").value, out = box.querySelector("#lg_err"), btn = box.querySelector("#lg_btn");
        if (!em || !pw) { out.textContent = "Escribe tu correo y contraseña."; return; }
        if (modo === "primer") { if (pw.length < 10) { out.textContent = "La contraseña debe tener al menos 10 caracteres."; return; } if (pw !== box.querySelector("#lg_pass2").value) { out.textContent = "Las contraseñas no coinciden."; return; } }
        btn.disabled = true; out.textContent = "";
        try {
          const r = await fetch("/api/" + (modo === "login" ? "login" : "primer-acceso"), { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: em, password: pw }) });
          const j = await r.json().catch(() => ({}));
          if (r.ok) { location.reload(); return; }
          out.textContent = j.error === "bloqueado" ? "Demasiados intentos. Espera 15 minutos." : j.error === "no_disponible" ? "Este correo no está habilitado para un primer acceso. Si es tu primera vez, pide a Luis que te habilite. Si ya creaste tu contraseña, usa «Ya tengo contraseña» o pide que te la reinicien." : j.error === "clave_corta" ? "La contraseña debe tener al menos 10 caracteres." : "Correo o contraseña incorrectos.";
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
