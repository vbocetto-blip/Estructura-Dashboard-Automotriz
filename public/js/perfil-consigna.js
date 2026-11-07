/* Perfil de consignación · Ansar Automotriz
   Una sola fuente de verdad: lo usa el formulario público (/consigna.html) para mostrar el perfil en vivo
   y el servidor (/api/lead-consigna) para guardar el perfil, el puntaje y la guía del consignador.
   Todo lo que ve el cliente está en `cliente`; lo interno (puntaje, objeciones, alertas) en `interno`. */

export const OPC = {
  estado: ["impecable", "detalles", "reparar"],
  publicado: ["no", "reciente", "parado"],
  cuando: ["mes", "1a3", "viendo"],
  motivo: ["cambio", "dinero", "nouso", "otro"],
  prioridad: ["precio", "rapidez", "tramites", "seguridad"],
  titular: ["si", "familiar", "no"],
  prenda: ["no", "si", "nose"],
  cambio: ["si", "quizas", "no"],
  modalidad: ["presencial", "virtual", "llamada"],
  franja: ["manana", "tarde", "sabado"]
};

export const TXT = {
  estado: { impecable: "impecable", detalles: "con detalles menores", reparar: "necesita reparaciones" },
  publicado: { no: "sin publicar", reciente: "publicado hace menos de 1 mes", parado: "publicado hace más de 1 mes" },
  cuando: { mes: "vende este mes", "1a3": "vende en 1 a 3 meses", viendo: "está viendo opciones" },
  motivo: { cambio: "quiere cambiar de auto", dinero: "necesita el dinero", nouso: "ya no lo usa", otro: "otro motivo" },
  prioridad: { precio: "prioriza el mejor precio", rapidez: "prioriza vender rápido", tramites: "no quiere hacer trámites", seguridad: "prioriza la seguridad" },
  titular: { si: "a su nombre", familiar: "de un familiar", no: "no está a su nombre" },
  prenda: { no: "sin prenda", si: "con prenda", nose: "no sabe si tiene prenda" },
  cambio: { si: "quiere recibir otro auto", quizas: "quizás recibe otro auto", no: "" },
  modalidad: { presencial: "trae el auto a Ansar", virtual: "parte a distancia (fotos y videollamada)", llamada: "quiere que lo llamen primero" },
  franja: { manana: "en la mañana", tarde: "en la tarde", sabado: "el sábado" }
};

const clp = n => "$" + Math.round(n).toLocaleString("es-CL");
const auto = d => [d.marca, d.modelo].filter(Boolean).join(" ") + (d.anio ? " " + d.anio : "");

/* Arquetipos, en orden de prioridad: el primero que calza define la conversación. */
const ARQ = [
  { id: "estancado", si: d => d.publicado === "parado",
    cliente: { nombre: "Listo para delegar", plan: "Ya lo intentaste por tu cuenta: nosotros lo publicamos, atendemos a los interesados y hacemos los trámites." },
    interno: { nombre: "Aviso estancado", motor: "CONSIGNAR",
      valora: "Que por fin se venda, sin seguir atendiendo curiosos.",
      argumento: "Lleva más de un mes publicado: casi siempre es precio o exposición. Muéstrale cómo lo publicaría Ansar y acuerda un rango realista con la tasación.",
      objecion: ["Si no se vendió solo, ¿por qué con ustedes sí?", "Explica qué cambia (fotos, publicación, atención a interesados, financiamiento al comprador si aplica) y acuerden el precio con comparables. Sin prometer plazo."] } },
  { id: "explorador", si: d => d.cuando === "viendo",
    cliente: { nombre: "Explorando opciones", plan: "Sin compromiso: con una tasación referencial decides con un número real." },
    interno: { nombre: "Explorando", motor: "CONSIGNAR",
      valora: "Información clara antes de decidir.",
      argumento: "Ofrece la tasación referencial sin compromiso. No presiones: el objetivo de hoy es la visita, no la firma.",
      objecion: ["Todavía no estoy seguro de vender.", "No tiene que decidir hoy: la tasación es referencial y sin costo. Con el número decide. Si no agenda, seguimiento con fecha (día 3 y 7)."] } },
  { id: "cambio", si: d => d.motivo === "cambio" || d.cambio === "si",
    cliente: { nombre: "Va por su próximo auto", plan: "Vendemos el tuyo y te ayudamos a elegir el siguiente, en el mismo lugar." },
    interno: { nombre: "Cambia de auto", motor: "CONSIGNAR + RETOMA",
      valora: "Resolver la venta y la compra en un solo lugar.",
      argumento: "Amarra la consignación con su próximo auto: en la visita tasas el suyo y le muestras unidades disponibles que calcen, con cuota referencial si la pide.",
      objecion: ["Primero quiero ver qué auto me llevo.", "Lo ven en la misma visita: tasación del suyo y opciones disponibles. Cuota y tasación siempre referenciales."] } },
  { id: "liquidez", si: d => d.motivo === "dinero",
    cliente: { nombre: "Busca vender con agilidad", plan: "Te damos un rango de precio claro para que se venda lo antes posible." },
    interno: { nombre: "Necesita liquidez", motor: "CONSIGNAR",
      valora: "Tener el dinero pronto.",
      argumento: "Sé honesto: la consignación depende de encontrar comprador. Un precio de salida bien puesto es lo que más acelera. No prometas fecha.",
      objecion: ["¿Cuánto se demora en venderse?", "Depende del modelo y del precio. Con la tasación le das un rango y una estrategia de precio, sin prometer plazo."] } },
  { id: "delegador", si: d => d.prioridad === "tramites" || d.prioridad === "seguridad",
    cliente: { nombre: "Cero complicaciones", plan: "Tú firmas el mandato; nosotros publicamos, mostramos y hacemos los trámites." },
    interno: { nombre: "Quiere cero trámites", motor: "CONSIGNAR",
      valora: "Que otro se encargue de todo, con seguridad.",
      argumento: "Explica el mandato paso a paso: quién muestra el auto, cómo se filtra a los interesados y cómo y cuándo se le paga.",
      objecion: ["¿Es seguro dejar el auto?", "Muéstrale el mandato antes de firmar: qué cubre, quién puede mostrar el auto y cómo se le paga. Que lo lea con calma."] } },
  { id: "decidido", si: () => true,
    cliente: { nombre: "Vendedor decidido", plan: "Vamos directo: tasación y, si te acomoda el rango, dejamos todo listo para publicar." },
    interno: { nombre: "Vendedor decidido", motor: "CONSIGNAR",
      valora: "Avanzar rápido.",
      argumento: "Ve directo a la tasación y deja el mandato listo en la misma visita si acuerdan rango.",
      objecion: ["¿Por qué me tasan menos de lo que espero?", "Usa el framework TASA del Playbook: comparables reales y rango acordado, no un número impuesto."] } }
];

/* Puntaje 0-100. Pesos (v2, 7-nov-2026): urgencia 25 · puede firmar 20 · señal de consignación 20 · siguiente paso 20 · retoma 5 · contacto 10. */
export function puntaje(d) {
  const det = [];
  det.push(["urgencia", { mes: 25, "1a3": 15, viendo: 5 }[d.cuando] || 0]);
  const firma = d.titular === "si" ? (d.prenda === "no" ? 20 : 14) : d.titular === "familiar" ? 10 : 0;
  det.push(["puede firmar", firma]);
  const senal = ({ parado: 12, reciente: 8, no: 4 }[d.publicado] || 0) + ({ tramites: 8, seguridad: 8, rapidez: 5, precio: 4 }[d.prioridad] || 0);
  det.push(["señal de consignación", senal]);
  det.push(["siguiente paso", { presencial: d.franja ? 20 : 16, virtual: 14, llamada: 6 }[d.modalidad] || 0]);
  det.push(["retoma", { si: 5, quizas: 3 }[d.cambio] || 0]);
  det.push(["contacto", /^569\d{8}$/.test(d.tel || "") && d.comuna ? 10 : d.tel ? 5 : 0]);
  const total = det.reduce((a, x) => a + x[1], 0);
  return { puntaje: total, puntajeDet: det.map(x => `${x[0]} ${x[1]}`).join(" + "), etiqueta: total >= 75 ? "CALIENTE" : total >= 50 ? "TIBIO" : "FRÍO" };
}

/* Lo que falta para que el mandato quede listo para firmar. */
export function checklist(d) {
  return [
    { k: "titular", t: "Quien firma es el dueño", ok: d.titular === "si" },
    { k: "prenda", t: "Prenda aclarada", ok: d.prenda === "no" },
    { k: "estado", t: "Estado del auto declarado", ok: !!d.estado },
    { k: "precio", t: "Expectativa de precio conocida", ok: !!d.precioEsperado },
    { k: "visita", t: d.cita ? "Cita agendada por el cliente" : "Tasación con día propuesto", ok: !!d.cita || ((d.modalidad === "presencial" || d.modalidad === "virtual") && !!d.franja) },
    { k: "docs", t: "Documentos pedidos (padrón, anotaciones, revisión técnica, permiso)", ok: false },
    { k: "rango", t: "Rango de precio acordado en la tasación", ok: false }
  ];
}

/* Dónde queda el precio que espera el cliente frente a la mediana de avisos parecidos (radar Ansar). */
export function posicionPrecio(precio, m) {
  if (!precio || !m || !m.mediana) return null;
  const dif = Math.round((precio / m.mediana - 1) * 100);
  const n = m.nCercanos >= 3 ? m.nCercanos : m.nModelo;
  const zona = dif > 8 ? "sobre" : dif < -8 ? "bajo" : "en";
  return { dif, zona, n,
    txtCliente: zona === "en" ? "Tu precio está en línea con el mercado." : `Tu precio está ${Math.abs(dif)}% ${zona} la mediana de avisos parecidos.`,
    txtInterno: zona === "en" ? `está en la mediana de ${n} avisos parecidos (${clp(m.mediana)})` : `está ${Math.abs(dif)}% ${zona} la mediana de ${n} avisos parecidos (${clp(m.mediana)})` };
}

export function perfilConsigna(d) {
  d = d || {};
  const a = ARQ.find(x => x.si(d));
  const cl = checklist(d), hechos = cl.filter(x => x.ok).length;
  const avance = Math.round(hechos / cl.length * 100);
  const rasgos = [];
  if (d.marca || d.modelo) rasgos.push(auto(d));
  if (d.km) rasgos.push(Number(d.km).toLocaleString("es-CL") + " km");
  ["estado", "publicado", "cuando", "motivo", "prioridad", "titular", "prenda", "cambio"].forEach(k => { const t = TXT[k][d[k]]; if (t) rasgos.push(t); });

  const alertas = [];
  const vh = d.vehiculo;
  if (vh && vh.estado === "desconocido") alertas.push(`Vehículo no verificado: escribió “${vh.original || auto(d)}” y no calza con ninguna marca conocida${d.tipoDeclarado ? " (dijo que es " + d.tipoDeclarado + ")" : ""}. Confirma marca, modelo y versión en la primera llamada.`);
  else if (vh && vh.estado === "marca") alertas.push(`Modelo no reconocido: ${vh.marca} “${d.modelo}”${d.tipoDeclarado ? ", dijo que es " + d.tipoDeclarado : ""}. Confirma modelo y versión antes de tasar.`);
  if (d.mercado && d.mercado.nivel === "tipo") alertas.push(`Sin avisos de su modelo: se le comparó con ${d.mercado.n} ${d.mercado.tipo || "autos"} de años cercanos${d.mercado.similares && d.mercado.similares.length ? " (" + d.mercado.similares.map(s => s.auto).join(", ") + ")" : ""}.`);
  if (d.km && d.mercado && d.mercado.kmMediana) { const r = Math.round((d.km / d.mercado.kmMediana - 1) * 100); if (Math.abs(r) >= 15) alertas.push(`Kilometraje ${Math.abs(r)}% ${r < 0 ? "bajo" : "sobre"} la mediana de los parecidos (${Number(d.mercado.kmMediana).toLocaleString("es-CL")} km): ${r < 0 ? "úsalo como argumento de precio" : "considéralo en la tasación"}.`); }
  if (d.titular === "no") alertas.push("No está a su nombre: confirma quién firma (el dueño o alguien con poder) antes de agendar.");
  if (d.titular === "familiar") alertas.push("Es de un familiar: que venga el titular a firmar o alguien con poder.");
  if (d.prenda === "si" || d.prenda === "nose") alertas.push("Pide el certificado de anotaciones para ver la prenda antes de la tasación.");
  if (d.estado === "reparar") alertas.push("Necesita reparaciones: se informa al comprador y se considera en la tasación.");
  if ((d.cambio === "si" || d.cambio === "quizas") && a.id !== "cambio") alertas.push("También le interesa recibir otro auto: lleva a la visita 2 o 3 unidades disponibles que calcen (RETOMA).");
  const pos = posicionPrecio(d.precioEsperado, d.mercado);
  if (pos) alertas.push(`Espera ${clp(d.precioEsperado)}: ${pos.txtInterno}. El cliente ya vio este dato en el formulario.`);
  else if (d.precioEsperado) alertas.push(`Espera ${clp(d.precioEsperado)}: revísalo contra comparables antes de hablar de precio.`);

  const nom = String(d.nombre || "").trim().split(/\s+/)[0];
  const fr = TXT.franja[d.franja] || "";
  let pregunta, paso, equipo;
  if (d.cuando === "viendo") {
    pregunta = `¿Te sirve una tasación referencial sin compromiso para que decidas con un número real?`;
    paso = "Ofrecer tasación sin compromiso; si no agenda, seguimiento en 3 días.";
  } else if (d.cita && d.modalidad === "presencial") {
    const cuando = `${fechaLarga(d.cita.fecha)} a las ${d.cita.hora}`;
    pregunta = `¿Me confirmas que vienes el ${cuando} a tasar tu auto?`;
    paso = `Confirmar hoy la cita del ${cuando} y pedir los documentos por WhatsApp.`;
  } else if (d.cita && d.modalidad === "virtual") {
    const cuando = `${fechaLarga(d.cita.fecha)} a las ${d.cita.hora}`;
    pregunta = `¿Te confirmo la videollamada del ${cuando}? Si puedes, mándame antes 4 fotos del auto y una del tablero.`;
    paso = `Confirmar la videollamada del ${cuando}, pedir fotos y luego agendar la visita para firmar.`;
  } else if (d.modalidad === "presencial") {
    pregunta = `¿Qué día de esta semana te acomoda traerlo a tasar${fr ? " " + fr : ""}?`;
    paso = `Confirmar día y hora de tasación presencial${fr ? " (" + fr + ")" : ""} y pedir los documentos por WhatsApp.`;
  } else if (d.modalidad === "virtual") {
    pregunta = `¿Me mandas 4 fotos (frente, atrás y costados) y una del tablero con el kilometraje?`;
    paso = `Pedir fotos, dar rango referencial y agendar la visita para firmar${fr ? " (" + fr + ")" : ""}.`;
  } else {
    pregunta = `¿A qué hora te puedo llamar hoy?`;
    paso = "Llamar hoy, precalificar y proponer dos horarios de tasación.";
  }
  equipo = d.modalidad === "presencial" ? "Piso" : "Virtual";
  const apertura = yo => `Hola${nom ? " " + nom : ""}, ${yo ? "soy " + yo + " de" : "te escribo de"} Ansar Automotriz. Recibimos tu solicitud para vender tu ${auto(d) || "auto"}. ${pregunta} La tasación es referencial hasta revisar el auto.`;

  let pasoCliente;
  if (d.cita && d.modalidad === "presencial") pasoCliente = `Tasación en Ansar el ${fechaLarga(d.cita.fecha)} a las ${d.cita.hora}. Te escribimos por WhatsApp para confirmarla.`;
  else if (d.cita && d.modalidad === "virtual") pasoCliente = `Videollamada el ${fechaLarga(d.cita.fecha)} a las ${d.cita.hora}. Te escribimos por WhatsApp para confirmarla.`;
  else if (d.modalidad === "presencial") pasoCliente = `Tasación en Ansar${fr ? " " + fr : ""}. Te escribimos por WhatsApp para confirmar la hora.`;
  else if (d.modalidad === "virtual") pasoCliente = "Te pedimos unas fotos por WhatsApp, te damos un rango referencial y coordinamos la visita para firmar.";
  else if (d.modalidad === "llamada") pasoCliente = "Te llamamos en horario de atención para resolver tus dudas.";
  else pasoCliente = "";

  return {
    version: 2,
    arquetipo: a.id,
    cliente: { nombre: a.cliente.nombre, plan: a.cliente.plan, rasgos, avance, paso: pasoCliente },
    interno: {
      nombre: a.interno.nombre, motor: a.interno.motor + ((d.cambio === "si" || d.cambio === "quizas") && a.id !== "cambio" ? " + RETOMA" : ""), valora: a.interno.valora, argumento: a.interno.argumento,
      objecion: a.interno.objecion[0], respuesta: a.interno.objecion[1],
      proximoPaso: paso, equipo, alertas, checklist: cl, avance,
      pregunta, aperturaBase: apertura("")
    },
    apertura
  };
}

/* ---------- Agenda de tasaciones ----------
   Horario por defecto (SUPUESTO, editable en el panel → Agenda → Horario de atención):
   lunes a viernes 10:00–19:00, sábado 10:00–14:00, citas de 1 hora, 2 cupos por hora, 14 días hacia adelante,
   mínimo 2 horas de anticipación. Feriados fijos cargados como bloqueos. */
export const HORARIO_DEF = {
  dias: { 1: ["10:00", "19:00"], 2: ["10:00", "19:00"], 3: ["10:00", "19:00"], 4: ["10:00", "19:00"], 5: ["10:00", "19:00"], 6: ["10:00", "14:00"] },
  duracion: 60, cupos: 2, diasAdelante: 14, anticipacionMin: 120,
  bloqueos: ["2026-12-08", "2026-12-25", "2027-01-01"]
};
const DIA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const aMin = h => { const [a, b] = String(h).split(":").map(Number); return a * 60 + (b || 0); };
const aHora = m => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
const sumaDias = (f, n) => { const [y, m, d] = f.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const diaSemana = f => { const [y, m, d] = f.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
export const fechaLarga = f => { const [y, m, d] = f.split("-").map(Number); return `${DIA[diaSemana(f)]} ${d} de ${MES[m - 1]}`; };
export const fechaCorta = f => { const [, m, d] = f.split("-").map(Number); return `${DIA[diaSemana(f)].slice(0, 3)} ${d} ${MES[m - 1].slice(0, 3)}`; };
/* Hora local de La Serena, "YYYY-MM-DDTHH:MM", sin depender de la zona del servidor. */
export function ahoraChile(fecha = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(fecha).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
export function normHorario(c) {
  c = c && typeof c === "object" ? c : {};
  const dias = {}; const src = c.dias && typeof c.dias === "object" ? c.dias : HORARIO_DEF.dias;
  for (const k of Object.keys(src)) { const v = src[k]; if (Array.isArray(v) && /^\d\d:\d\d$/.test(v[0]) && /^\d\d:\d\d$/.test(v[1]) && aMin(v[1]) > aMin(v[0])) dias[k] = [v[0], v[1]]; }
  const num = (v, d, lo, hi) => { const n = parseInt(v, 10); return n >= lo && n <= hi ? n : d; };
  return { dias, duracion: num(c.duracion, HORARIO_DEF.duracion, 15, 240), cupos: num(c.cupos, HORARIO_DEF.cupos, 1, 20),
    diasAdelante: num(c.diasAdelante, HORARIO_DEF.diasAdelante, 1, 60), anticipacionMin: num(c.anticipacionMin, HORARIO_DEF.anticipacionMin, 0, 2880),
    bloqueos: Array.isArray(c.bloqueos) ? c.bloqueos.filter(x => /^\d{4}-\d\d-\d\d$/.test(x)) : HORARIO_DEF.bloqueos };
}
/* tomados: { "YYYY-MM-DD HH:MM": cantidad de citas activas } */
export function diasDisponibles(cfg, ahora, tomados = {}) {
  cfg = normHorario(cfg); const hoy = ahora.slice(0, 10), limite = aMin(ahora.slice(11)) + cfg.anticipacionMin, out = [];
  for (let i = 0; i <= cfg.diasAdelante; i++) {
    const f = sumaDias(hoy, i), r = cfg.dias[diaSemana(f)];
    if (!r || cfg.bloqueos.includes(f)) continue;
    const horas = [];
    for (let m = aMin(r[0]); m + cfg.duracion <= aMin(r[1]); m += cfg.duracion) {
      const h = aHora(m), pasado = i === 0 ? m < limite : false, lleno = (tomados[f + " " + h] || 0) >= cfg.cupos;
      if (i * 1440 + m < limite) continue;
      horas.push({ hora: h, libre: !pasado && !lleno });
    }
    if (horas.length) out.push({ fecha: f, horas });
  }
  return out;
}
export function citaValida(cfg, fecha, hora, ahora, tomados) {
  return diasDisponibles(cfg, ahora, tomados).some(d => d.fecha === fecha && d.horas.some(h => h.hora === hora && h.libre));
}
export const franjaDe = cita => !cita ? "" : diaSemana(cita.fecha) === 6 ? "sabado" : aMin(cita.hora) < 13 * 60 ? "manana" : "tarde";
