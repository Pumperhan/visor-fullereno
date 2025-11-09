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
app.use(cors({
  origin: [
    "https://www.fullerenoc28.sbs",
    "https://www.fullerenoc28.sbs/visor_de_outputs",
    "https://fullerenoc28.sbs",
    "https://fullerenoc28.sbs/visor_de_outputs"
  ],
  methods: ["POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"]
}));

// ============================================================
// 2️⃣ API key
// ============================================================
const API_KEY = "UEUNoWwtlV2AJg1WxkTvgdU4DYgxVPMkOr6Jyn6V";

// ============================================================
// 3️⃣ Configuración de subida temporal (60 MB máx.)
// ============================================================
const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 60 * 1024 * 1024 } // 60 MB
});

// ============================================================
// 4️⃣ Parser ORCA (geometría + energía)
// ============================================================
function parseOrcaOut(text) {
  if (!text || typeof text !== "string") return { atoms: [], energy: null };
  const lines = text.split(/\r?\n/);
  let geomStart = -1;

  // Buscar bloque final
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

  // Si no, último bloque de coordenadas
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
      if (!l || l.startsWith('-')) break;
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

  let energy = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].includes("FINAL SINGLE POINT ENERGY")) {
      const tokens = lines[i].trim().split(/\s+/);
      const val = parseFloat(tokens[tokens.length - 1]);
      if (Number.isFinite(val)) { energy = val; }
      break;
    }
  }

  return { atoms, energy };
}

// ============================================================
// 5️⃣ Endpoint principal
// ============================================================
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const key = req.body.apikey || req.body.api_key || "";
    if (!key || key !== API_KEY) {
      if (req.file?.path) { try { await fs.unlink(req.file.path); } catch {} }
      return res.status(403).json({ success: false, msg: "Acceso no autorizado" });
    }

    if (!req.file?.path) {
      return res.status(400).json({ success: false, msg: "No se recibió archivo" });
    }

    const text = await fs.readFile(req.file.path, "utf-8");
    const { atoms, energy } = parseOrcaOut(text);

    // Eliminar el archivo temporal
    try { await fs.unlink(req.file.path); } catch {}

    // Enviar respuesta
    return res.json({ success: true, atoms, energy });
  } catch (err) {
    if (req.file?.path) { try { await fs.unlink(req.file.path); } catch {} }
    return res.status(500).json({ success: false, msg: err?.message || "Error interno" });
  }
});

// ============================================================
// 6️⃣ Servidor activo
// ============================================================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`✅ visor-fullereno activo en puerto ${PORT}`));
