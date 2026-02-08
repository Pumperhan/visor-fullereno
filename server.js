// ============================================================
// BACKEND — visor-fullereno
// Procesa archivos .out de ORCA y devuelve JSON
// José Ángel Arrocha Rojas — MIME UNACAR — 2025
// ============================================================

import express from "express";
import multer from "multer";
import fs from "fs/promises";
import cors from "cors";

const app = express();

// ============================================================
// 1️⃣ CORS — permite solicitudes desde tu dominio Hostinger
// ============================================================
app.use(
  cors({
    origin: [
      "https://www.fullerenoc28.sbs",
      "https://www.fullerenoc28.sbs/visor_de_outputs",
      "https://fullerenoc28.sbs",
      "https://fullerenoc28.sbs/visor_de_outputs",
    ],
    methods: ["POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);

// ============================================================
// 2️⃣ API key
// ============================================================
const API_KEY = "UEUNoWwtlV2AJg1WxkTvgdU4DYgxVPMkOr6Jyn6V";

// ============================================================
// 3️⃣ Configuración de subida temporal (60 MB máx.)
// ============================================================
const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 60 * 1024 * 1024 }, // 60 MB
});

// ============================================================
// Helpers
// ============================================================
function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function hypot3(a, b, c) {
  return Math.hypot(a ?? 0, b ?? 0, c ?? 0);
}

// ============================================================
// 4️⃣ Parser ORCA (geometría + energía + efield)
// ============================================================
function parseOrcaOut(text) {
  if (!text || typeof text !== "string") {
    return { atoms: [], energy: null, efield: null, siteIndex: null, adsorbateIdx: [] };
  }

  const lines = text.split(/\r?\n/);

  // -------------------------
  // A) PRIMER bloque de coordenadas (geometría inicial)
  // -------------------------
  let initialStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("CARTESIAN COORDINATES (ANGSTROEM)")) {
      initialStart = i + 2;  // dos líneas después del encabezado
      break;
    }
  }

  const initialAtoms = [];
  if (initialStart !== -1) {
    for (let i = initialStart; i < lines.length; i++) {
      const l = lines[i].trim();
      if (!l || l.startsWith("-")) break;
      const parts = l.split(/\s+/);
      if (parts.length >= 4) {
        const el = parts[0];
        const x = parseFloat(parts[1]);
        const y = parseFloat(parts[2]);
        const z = parseFloat(parts[3]);
        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
          initialAtoms.push({ el, x, y, z });
        }
      }
    }
  }

  // -------------------------
  // B) Coordenadas finales (último bloque útil)
  // -------------------------
  let geomStart = -1;

  // Buscar bloque posterior a "FINAL ENERGY EVALUATION..."
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].includes("FINAL ENERGY EVALUATION AT THE STATIONARY POINT")) {
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].includes("CARTESIAN COORDINATES (ANGSTROEM)")) {
          geomStart = j + 2;
          break;
        }
      }
      break;
    }
  }

  // Si no se encontró, usar el último bloque "CARTESIAN COORDINATES (ANGSTROEM)"
  if (geomStart === -1) {
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].includes("CARTESIAN COORDINATES (ANGSTROEM)")) {
        geomStart = i + 2;
        break;
      }
    }
  }

  const atoms = [];
  if (geomStart !== -1) {
    for (let i = geomStart; i < lines.length; i++) {
      const l = lines[i].trim();
      if (!l || l.startsWith("-")) break;
      const parts = l.split(/\s+/);
      if (parts.length >= 4) {
        const el = parts[0];
        const x = parseFloat(parts[1]);
        const y = parseFloat(parts[2]);
        const z = parseFloat(parts[3]);
        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
          atoms.push({ el, x, y, z });
        }
      }
    }
  }

  // -------------------------
  // C) Energía FINAL SINGLE POINT ENERGY
  // -------------------------
  let energy = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].includes("FINAL SINGLE POINT ENERGY")) {
      const tokens = lines[i].trim().split(/\s+/);
      const val = parseFloat(tokens[tokens.length - 1]);
      if (Number.isFinite(val)) energy = val;
      break;
    }
  }

  // -------------------------
  // D) Campo eléctrico externo (efield) en a.u.
  // -------------------------
  let efield = null;

  const float = "[-+]?\\d*\\.?\\d+(?:[Ee][-+]?\\d+)?";

  // 1) Línea con "E FIELD / EFIELD / Electric Field / EXTERNAL ELECTRIC FIELD" y 3 números
  const reVecInline = new RegExp(
    `\\b(?:E\\s*FIELD|EFIELD|E-FIELD|Electric\\s+Field|EXTERNAL\\s+ELECTRIC\\s+FIELD)\\b[^\\d-+]*(${float})\\s+(${float})\\s+(${float})`,
    "i"
  );

  // 2) Componentes Ex/Ey/Ez SOLO dentro de un bloque que hable de campo
  const reComponentLine = new RegExp(
    `\\b(?:Ex|Ey|Ez)\\b\\s*[:=]\\s*(${float})`,
    "i"
  );
  const reMag = new RegExp(`\\b\\|?E\\|?\\b\\s*[:=]\\s*(${float})`, "i");

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];

    // 1) Vector en una sola línea con palabras de campo
    const m1 = line.match(reVecInline);
    if (m1) {
      const ex = toNum(m1[1]);
      const ey = toNum(m1[2]);
      const ez = toNum(m1[3]);
      if (ex != null && ey != null && ez != null) {
        efield = { ex, ey, ez, mag: hypot3(ex, ey, ez) };
        break;
      }
    }

    // 2) Bloque con encabezado "EXTERNAL ELECTRIC FIELD", "ELECTRIC FIELD", "EFIELD", etc.
    if (
      /\b(EXTERNAL\s+ELECTRIC\s+FIELD|ELECTRIC\s+FIELD|EFIELD|E-FIELD)\b/i.test(
        line
      )
    ) {
      let ex = null, ey = null, ez = null, mag = null;

      // Miramos unas pocas líneas hacia abajo dentro del bloque de campo
      for (let k = i; k < Math.min(i + 8, lines.length); k++) {
        const lk = lines[k];

        // Por si el propio bloque incluye el vector en una sola línea
        const mk = lk.match(reVecInline);
        if (mk) {
          ex = toNum(mk[1]);
          ey = toNum(mk[2]);
          ez = toNum(mk[3]);
        }

        const mm = lk.match(reMag);
        if (mm) mag = toNum(mm[1]);

        if (/\bEx\b/i.test(lk)) {
          const c = lk.match(reComponentLine);
          if (c) ex = toNum(c[1]);
        }
        if (/\bEy\b/i.test(lk)) {
          const c = lk.match(reComponentLine);
          if (c) ey = toNum(c[1]);
        }
        if (/\bEz\b/i.test(lk)) {
          const c = lk.match(reComponentLine);
          if (c) ez = toNum(c[1]);
        }
      }

      if (ex != null && ey != null && ez != null) {
        efield = { ex, ey, ez, mag: mag ?? hypot3(ex, ey, ez) };
        break;
      }
    }
  }

  // -------------------------
  // E) Sitio de adsorción a partir de la GEOMETRÍA INICIAL
  //     – adsorbato al final (H2 o CO2)
  // -------------------------
  let siteIndex = null;
  let adsorbateIdx = [];

  if (initialAtoms.length >= 2) {
    const n = initialAtoms.length;

    // Intentamos identificar H2 (dos H al final)
    if (n >= 2) {
      const a1 = initialAtoms[n - 2];
      const a2 = initialAtoms[n - 1];
      if (a1.el === "H" && a2.el === "H") {
        adsorbateIdx = [n - 2, n - 1];
      }
    }

    // Si no es H2, intentamos CO2 (últimos 3: 1 C y 2 O, en cualquier orden)
    if (!adsorbateIdx.length && n >= 3) {
      const idxs = [n - 3, n - 2, n - 1];
      const els  = idxs.map(i => initialAtoms[i].el);
      const countC = els.filter(e => e === "C").length;
      const countO = els.filter(e => e === "O").length;
      if (countC === 1 && countO === 2) {
        adsorbateIdx = idxs;
      }
    }

    // Si conseguimos adsorbato al final, calculamos el centro y
    // el átomo más cercano del resto (fullereno)
    if (adsorbateIdx.length) {
      // Centro del adsorbato
      let center = null;

      // CO2: centro = carbono del adsorbato
      const idxC = adsorbateIdx.find(i => initialAtoms[i].el === "C");
      const nO   = adsorbateIdx.filter(i => initialAtoms[i].el === "O").length;

      if (idxC != null && nO === 2) {
        const cAt = initialAtoms[idxC];
        center = { x: cAt.x, y: cAt.y, z: cAt.z };
      } else if (
        adsorbateIdx.length === 2 &&
        initialAtoms[adsorbateIdx[0]].el === "H" &&
        initialAtoms[adsorbateIdx[1]].el === "H"
      ) {
        // H2: punto medio
        const a = initialAtoms[adsorbateIdx[0]];
        const b = initialAtoms[adsorbateIdx[1]];
        center = {
          x: 0.5 * (a.x + b.x),
          y: 0.5 * (a.y + b.y),
          z: 0.5 * (a.z + b.z),
        };
      } else {
        // Caso general: centro geométrico del adsorbato
        let sx = 0, sy = 0, sz = 0;
        for (const i of adsorbateIdx) {
          sx += initialAtoms[i].x;
          sy += initialAtoms[i].y;
          sz += initialAtoms[i].z;
        }
        const inv = 1 / adsorbateIdx.length;
        center = { x: sx * inv, y: sy * inv, z: sz * inv };
      }

      // Buscar átomo del "fullereno" más cercano al centro:
      // asumimos que el fullereno ocupa todos los átomos antes del adsorbato
      const firstAds = Math.min(...adsorbateIdx);
      if (firstAds > 0 && center) {
        let bestD = Infinity;
        let bestIdx = null;

        for (let i = 0; i < firstAds; i++) {
          const a = initialAtoms[i];
          const d = Math.hypot(
            a.x - center.x,
            a.y - center.y,
            a.z - center.z
          );
          if (d < bestD) {
            bestD = d;
            bestIdx = i;
          }
        }

        siteIndex = bestIdx;
      }
    }
  }
  // -------------------------
  // F) Normal local en la GEOMETRÍA INICIAL (normal0)
  //     Se calcula SOLO si se detectó adsorbato y siteIndex
  // -------------------------
  let normal0 = null;

  if (siteIndex != null && adsorbateIdx.length && initialAtoms.length) {

    const firstAds = Math.min(...adsorbateIdx);

    // Centro del adsorbato (mismas reglas que usaste para el sitio)
    let center = null;
    const idxC = adsorbateIdx.find(i => initialAtoms[i].el === "C");
    const nO   = adsorbateIdx.filter(i => initialAtoms[i].el === "O").length;

    if (idxC != null && nO === 2) {
      const cAt = initialAtoms[idxC];
      center = { x: cAt.x, y: cAt.y, z: cAt.z };
    } else if (
      adsorbateIdx.length === 2 &&
      initialAtoms[adsorbateIdx[0]].el === "H" &&
      initialAtoms[adsorbateIdx[1]].el === "H"
    ) {
      const a = initialAtoms[adsorbateIdx[0]];
      const b = initialAtoms[adsorbateIdx[1]];
      center = { x: 0.5*(a.x+b.x), y: 0.5*(a.y+b.y), z: 0.5*(a.z+b.z) };
    } else {
      let sx=0,sy=0,sz=0;
      for (const i of adsorbateIdx) { sx+=initialAtoms[i].x; sy+=initialAtoms[i].y; sz+=initialAtoms[i].z; }
      const inv = 1/adsorbateIdx.length;
      center = { x:sx*inv, y:sy*inv, z:sz*inv };
    }

    // Elegir 2 vecinos del sitio por distancia (NO por bonds)
    const a0 = initialAtoms[siteIndex];

    const cand = [];
    for (let i = 0; i < firstAds; i++) {
      if (i === siteIndex) continue;
      const ai = initialAtoms[i];
      const d = Math.hypot(ai.x - a0.x, ai.y - a0.y, ai.z - a0.z);
      cand.push({ i, d });
    }
    cand.sort((u,v)=>u.d-v.d);

    if (cand.length >= 2) {
      const p1 = initialAtoms[cand[0].i];
      const p2 = initialAtoms[cand[1].i];

      const v1 = { x: p1.x - a0.x, y: p1.y - a0.y, z: p1.z - a0.z };
      const v2 = { x: p2.x - a0.x, y: p2.y - a0.y, z: p2.z - a0.z };

      // cross v1 x v2
      let nx = v1.y*v2.z - v1.z*v2.y;
      let ny = v1.z*v2.x - v1.x*v2.z;
      let nz = v1.x*v2.y - v1.y*v2.x;

      const norm = Math.hypot(nx,ny,nz);
      if (norm > 1e-12) {
        nx /= norm; ny /= norm; nz /= norm;

        // orientar hacia el adsorbato
        if (center) {
          const dir = { x: center.x - a0.x, y: center.y - a0.y, z: center.z - a0.z };
          const dot = nx*dir.x + ny*dir.y + nz*dir.z;
          if (dot < 0) { nx=-nx; ny=-ny; nz=-nz; }
        }

        normal0 = { x: nx, y: ny, z: nz };
      }
    }
  }

  return { atoms, energy, efield, siteIndex, adsorbateIdx, normal0 };
}

// ============================================================
// 5️⃣ Endpoint principal
// ============================================================
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const key = req.body.apikey || req.body.api_key || "";
    if (!key || key !== API_KEY) {
      if (req.file?.path) {
        try {
          await fs.unlink(req.file.path);
        } catch {}
      }
      return res
        .status(403)
        .json({ success: false, msg: "Acceso no autorizado" });
    }

    if (!req.file?.path) {
      return res
        .status(400)
        .json({ success: false, msg: "No se recibió archivo" });
    }

    const text = await fs.readFile(req.file.path, "utf-8");
    const { atoms, energy, efield, siteIndex, adsorbateIdx, normal0 } = parseOrcaOut(text);

    // Eliminar el archivo temporal
    try {
      await fs.unlink(req.file.path);
    } catch {}

    // Enviar respuesta
    return res.json({ success: true, atoms, energy, efield, siteIndex, adsorbateIdx, normal0 });
  } catch (err) {
    if (req.file?.path) {
      try {
        await fs.unlink(req.file.path);
      } catch {}
    }
    return res
      .status(500)
      .json({ success: false, msg: err?.message || "Error interno" });
  }
});

// ============================================================
// 6️⃣ Servidor activo
// ============================================================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`✅ visor-fullereno activo en puerto ${PORT}`));
