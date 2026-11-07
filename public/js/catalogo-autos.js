/* Catálogo de marcas y modelos vendidos en Chile, con su tipo de carrocería.
   Sirve para: reconocer lo que escribe el cliente, corregir errores de tipeo y, si el modelo no existe,
   comparar con autos del mismo tipo. Se puede ampliar: agregar "Modelo": "tipo" a la marca que corresponda.
   Tipos: hatch · sedan · suv · pickup · van · minivan · coupe */
export const TIPOS = { hatch: "hatchback", sedan: "sedán", suv: "SUV", pickup: "camioneta", van: "furgón", minivan: "minivan", coupe: "deportivo" };

export const CATALOGO = {
  "Toyota": { "Yaris": "sedan", "Yaris Sport": "hatch", "Yaris Cross": "suv", "Corolla": "sedan", "Corolla Cross": "suv", "Etios": "sedan", "Agya": "hatch", "Raize": "suv", "Rush": "suv", "RAV4": "suv", "Fortuner": "suv", "4Runner": "suv", "Land Cruiser Prado": "suv", "Land Cruiser": "suv", "Hilux": "pickup", "Tundra": "pickup", "Prius": "hatch", "C-HR": "suv", "Hiace": "van", "86": "coupe", "GR86": "coupe", "Supra": "coupe", "Camry": "sedan", "Tercel": "sedan", "Starlet": "hatch" },
  "Chevrolet": { "Spark": "hatch", "Sail": "sedan", "Onix": "sedan", "Prisma": "sedan", "Cruze": "sedan", "Aveo": "sedan", "Sonic": "hatch", "Groove": "suv", "Tracker": "suv", "Captiva": "suv", "Equinox": "suv", "Blazer": "suv", "Traverse": "suv", "Tahoe": "suv", "Trailblazer": "suv", "Spin": "minivan", "Montana": "pickup", "Colorado": "pickup", "D-Max": "pickup", "Silverado": "pickup", "N300": "van", "N400": "van", "Camaro": "coupe" },
  "Hyundai": { "Grand i10": "hatch", "i10": "hatch", "i20": "hatch", "Accent": "sedan", "Elantra": "sedan", "Veloster": "coupe", "Venue": "suv", "Creta": "suv", "Kona": "suv", "Tucson": "suv", "Santa Fe": "suv", "Palisade": "suv", "Staria": "van", "H-1": "van", "Porter": "pickup" },
  "Kia": { "Morning": "hatch", "Picanto": "hatch", "Rio": "hatch", "Rio 5": "hatch", "Soluto": "sedan", "Cerato": "sedan", "Sonet": "suv", "Seltos": "suv", "Sportage": "suv", "Sorento": "suv", "Carnival": "minivan", "Niro": "suv", "Frontier": "pickup" },
  "Nissan": { "March": "hatch", "Versa": "sedan", "V-Drive": "sedan", "Sentra": "sedan", "Tiida": "hatch", "Kicks": "suv", "Qashqai": "suv", "X-Trail": "suv", "Murano": "suv", "Pathfinder": "suv", "Navara": "pickup", "NP300": "pickup", "Frontier": "pickup", "Terrano": "pickup", "NV350": "van", "Urvan": "van" },
  "Mazda": { "Mazda2": "hatch", "Mazda3": "sedan", "Mazda6": "sedan", "CX-3": "suv", "CX-30": "suv", "CX-5": "suv", "CX-50": "suv", "CX-60": "suv", "CX-9": "suv", "CX-90": "suv", "BT-50": "pickup", "MX-5": "coupe" },
  "Suzuki": { "Alto": "hatch", "Celerio": "hatch", "S-Presso": "hatch", "Swift": "hatch", "Baleno": "hatch", "Dzire": "sedan", "Ciaz": "sedan", "Ignis": "suv", "Vitara": "suv", "Grand Vitara": "suv", "Grand Nomade": "suv", "S-Cross": "suv", "Jimny": "suv", "Ertiga": "minivan", "XL7": "suv", "Fronx": "suv", "APV": "van" },
  "Ford": { "Fiesta": "hatch", "Focus": "hatch", "Ka": "hatch", "Fusion": "sedan", "EcoSport": "suv", "Escape": "suv", "Territory": "suv", "Kuga": "suv", "Edge": "suv", "Explorer": "suv", "Expedition": "suv", "Bronco": "suv", "Ranger": "pickup", "Maverick": "pickup", "F-150": "pickup", "Transit": "van", "Mustang": "coupe" },
  "Volkswagen": { "Gol": "hatch", "Up": "hatch", "Polo": "hatch", "Virtus": "sedan", "Voyage": "sedan", "Jetta": "sedan", "Golf": "hatch", "Vento": "sedan", "T-Cross": "suv", "Nivus": "suv", "Taos": "suv", "Tiguan": "suv", "Touareg": "suv", "Saveiro": "pickup", "Amarok": "pickup", "Crafter": "van", "Transporter": "van" },
  "Peugeot": { "208": "hatch", "2008": "suv", "301": "sedan", "308": "hatch", "3008": "suv", "408": "sedan", "5008": "suv", "Partner": "van", "Rifter": "minivan", "Expert": "van", "Boxer": "van", "Landtrek": "pickup" },
  "Citroën": { "C3": "hatch", "C3 Aircross": "suv", "C4": "hatch", "C4 Cactus": "suv", "C5 Aircross": "suv", "C-Elysée": "sedan", "Berlingo": "van", "Jumpy": "van", "Jumper": "van" },
  "Renault": { "Kwid": "hatch", "Clio": "hatch", "Sandero": "hatch", "Logan": "sedan", "Symbol": "sedan", "Stepway": "hatch", "Duster": "suv", "Captur": "suv", "Arkana": "suv", "Koleos": "suv", "Oroch": "pickup", "Alaskan": "pickup", "Kangoo": "van", "Express": "van", "Master": "van" },
  "Honda": { "Fit": "hatch", "City": "sedan", "Civic": "sedan", "Accord": "sedan", "WR-V": "suv", "HR-V": "suv", "ZR-V": "suv", "CR-V": "suv", "Pilot": "suv" },
  "Mitsubishi": { "Mirage": "hatch", "ASX": "suv", "Eclipse Cross": "suv", "Outlander": "suv", "Montero": "suv", "Montero Sport": "suv", "L200": "pickup", "Katana": "pickup" },
  "Subaru": { "Impreza": "hatch", "XV": "suv", "Crosstrek": "suv", "Forester": "suv", "Outback": "suv", "Evoltis": "suv", "WRX": "sedan" },
  "Jeep": { "Renegade": "suv", "Compass": "suv", "Commander": "suv", "Cherokee": "suv", "Grand Cherokee": "suv", "Wrangler": "suv", "Gladiator": "pickup" },
  "RAM": { "700": "pickup", "1000": "pickup", "1500": "pickup", "2500": "pickup", "Rampage": "pickup" },
  "Dodge": { "Journey": "suv", "Durango": "suv", "Challenger": "coupe", "Ram": "pickup" },
  "Fiat": { "Mobi": "hatch", "Argo": "hatch", "Cronos": "sedan", "Pulse": "suv", "Fastback": "suv", "Strada": "pickup", "Toro": "pickup", "Fiorino": "van", "Ducato": "van" },
  "Chery": { "QQ": "hatch", "Arrizo 5": "sedan", "Tiggo": "suv", "Tiggo 2": "suv", "Tiggo 2 Pro": "suv", "Tiggo 3": "suv", "Tiggo 4": "suv", "Tiggo 4 Pro": "suv", "Tiggo 7": "suv", "Tiggo 7 Pro": "suv", "Tiggo 8": "suv", "Tiggo 8 Pro": "suv" },
  "MG": { "MG3": "hatch", "MG5": "sedan", "MG GT": "sedan", "ZS": "suv", "ZX": "suv", "HS": "suv", "RX5": "suv", "MG4": "hatch" },
  "Great Wall": { "Wingle": "pickup", "Wingle 5": "pickup", "Wingle 7": "pickup", "Poer": "pickup", "Voleex C30": "sedan", "M4": "suv", "H6": "suv" },
  "Haval": { "Jolion": "suv", "H6": "suv", "Dargo": "suv", "H2": "suv" },
  "Changan": { "Alsvin": "sedan", "CS15": "suv", "CS35": "suv", "CS35 Plus": "suv", "CS55": "suv", "CS55 Plus": "suv", "CX70": "suv", "UNI-T": "suv", "UNI-K": "suv", "Hunter": "pickup", "MD201": "van" },
  "JAC": { "S2": "suv", "S3": "suv", "JS2": "suv", "JS3": "suv", "JS4": "suv", "JS6": "suv", "JS8": "suv", "T6": "pickup", "T8": "pickup", "T9": "pickup", "Sunray": "van", "Refine": "van" },
  "Geely": { "GX3": "suv", "Coolray": "suv", "Azkarra": "suv", "Okavango": "suv", "Emgrand": "sedan" },
  "Jetour": { "X70": "suv", "X70 Plus": "suv", "Dashing": "suv", "T2": "suv" },
  "Omoda": { "C5": "suv", "E5": "suv" },
  "Jaecoo": { "7": "suv" },
  "BYD": { "Dolphin": "hatch", "Dolphin Mini": "hatch", "Seal": "sedan", "Yuan Plus": "suv", "Song Plus": "suv", "Tang": "suv", "Shark": "pickup" },
  "DFSK": { "Glory 500": "suv", "Glory 580": "suv", "600": "suv", "C31": "pickup", "C35": "van" },
  "Maxus": { "T60": "pickup", "T90": "pickup", "D60": "suv", "G10": "van", "V80": "van", "Deliver 9": "van" },
  "SsangYong": { "Tivoli": "suv", "Korando": "suv", "Rexton": "suv", "Actyon": "pickup", "Stavic": "minivan", "Musso": "pickup", "Grand Musso": "pickup" },
  "Kaiyi": { "X3": "suv", "X3 Pro": "suv", "E5": "sedan" },
  "BAIC": { "X25": "suv", "X35": "suv", "X55": "suv", "BJ40": "suv" },
  "Foton": { "Tunland": "pickup", "View": "van", "Midi": "van" },
  "Skoda": { "Fabia": "hatch", "Rapid": "sedan", "Octavia": "sedan", "Kamiq": "suv", "Karoq": "suv", "Kodiaq": "suv" },
  "BMW": { "Serie 1": "hatch", "Serie 2": "coupe", "Serie 3": "sedan", "Serie 5": "sedan", "X1": "suv", "X2": "suv", "X3": "suv", "X4": "suv", "X5": "suv", "X6": "suv" },
  "Mercedes-Benz": { "Clase A": "hatch", "Clase C": "sedan", "Clase E": "sedan", "GLA": "suv", "GLB": "suv", "GLC": "suv", "GLE": "suv", "Sprinter": "van", "Vito": "van" },
  "Audi": { "A1": "hatch", "A3": "sedan", "A4": "sedan", "Q2": "suv", "Q3": "suv", "Q5": "suv", "Q7": "suv" },
  "Volvo": { "XC40": "suv", "XC60": "suv", "XC90": "suv", "S60": "sedan" },
  "Land Rover": { "Evoque": "suv", "Range Rover Evoque": "suv", "Discovery Sport": "suv", "Defender": "suv", "Range Rover Sport": "suv" },
  "Mini": { "Cooper": "hatch", "Countryman": "suv", "John Cooper Works": "hatch" },
  "Porsche": { "Macan": "suv", "Cayenne": "suv", "911": "coupe" },
  "Lexus": { "UX": "suv", "NX": "suv", "RX": "suv" },
  "Opel": { "Corsa": "hatch", "Astra": "hatch", "Mokka": "suv", "Crossland": "suv", "Grandland": "suv", "Combo": "van" },
  "DS": { "DS 3": "suv", "DS 7": "suv" },
  "Jaguar": { "F-Pace": "suv", "E-Pace": "suv", "XE": "sedan" }
};
/* Cómo lo escribe la gente → marca oficial */
const ALIAS_MARCA = { "chevy": "Chevrolet", "vw": "Volkswagen", "volkswagen": "Volkswagen", "mercedes": "Mercedes-Benz", "mercedesbenz": "Mercedes-Benz", "benz": "Mercedes-Benz",
  "citroen": "Citroën", "greatwall": "Great Wall", "gwm": "Great Wall", "landrover": "Land Rover", "rangerover": "Land Rover", "ssang": "SsangYong", "ssangyong": "SsangYong", "kgm": "SsangYong", "dongfeng": "DFSK", "mazda": "Mazda" };

const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
function lev(a, b) {
  if (a === b) return 0; if (!a.length) return b.length; if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) { const cur = [i]; for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  return prev[b.length];
}
/* Busca el mejor parecido: exacto, empieza igual, o con pocos errores de tipeo. */
function mejor(q, opciones) {
  const n = norm(q); if (!n) return null;
  let best = null;
  for (const o of opciones) {
    const m = norm(o); let s;
    if (m === n) s = 0;
    else if (m.startsWith(n) && n.length >= 2) s = .3 + (m.length - n.length) * .02;
    else if (n.startsWith(m) && m.length >= 2) s = .4 + (n.length - m.length) * .05;
    else { const d = lev(n, m), tol = n.length <= 4 ? 1 : n.length <= 7 ? 2 : 3; if (d > tol) continue; s = 1 + d; }
    if (!best || s < best.s) best = { o, s };
  }
  return best;
}
export const marcas = () => Object.keys(CATALOGO);
export const modelosDe = marca => Object.keys(CATALOGO[marca] || {});
/* Resultado: { marca, modelo, tipo, estado } con estado:
   "exacto" · "corregido" (había un error de tipeo) · "marca" (marca real, modelo no reconocido) · "desconocido" */
export function reconocer(marcaTxt, modeloTxt) {
  const nm = norm(marcaTxt);
  let marca = ALIAS_MARCA[nm] || null, corregido = false;
  if (!marca) { const b = mejor(marcaTxt, marcas()); if (b) { marca = b.o; corregido = b.s > 0; } }
  if (!marca) return { marca: null, modelo: null, tipo: null, estado: "desconocido" };
  if (norm(marca) !== nm && !ALIAS_MARCA[nm]) corregido = true;
  const b = mejor(modeloTxt, modelosDe(marca));
  if (!b) return { marca, modelo: null, tipo: null, estado: "marca", marcaCorregida: corregido };
  return { marca, modelo: b.o, tipo: CATALOGO[marca][b.o], estado: corregido || b.s > 0 ? "corregido" : "exacto" };
}
/* Para clasificar avisos del radar por tipo, aunque vengan mal escritos. */
export function tipoDe(marcaTxt, modeloTxt) { const r = reconocer(marcaTxt, modeloTxt); return r.tipo || null; }
