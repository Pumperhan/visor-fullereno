
import express from "express";
import multer from "multer";
import fs from "fs/promises";

const app = express();

// --- CORS mínimo para permitir uso desde el navegador ---
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// --- API key ---
const API_KEY = "UEUNoWwtlV2AJg1WxkTvgdU4DYgxVPMkOr6Jyn6V";

// --- Multer (límite 60 MB) ---
const upload = multer({ dest: "uploads/", limits: { fileSize: 60 * 1024 * 1024 } });

// --- Parser ORCA inline (coordenadas finales + energía) ---
function parseOrcaOut(text) {
  if (!text || typeof text !== "string") return { atoms: [], energy: null };
  const lines = text.split(/\r?\n/);
  let geomStart = -1;

  // Preferir bloque final clásico
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

  // Si no, último ciclo de optimización
  if (geomStart === -1) {
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].includes("GEOMETRY OPTIMIZATION CYCLE")) {
        for (let j = i; j < lines.length; j++) {
          if (lines[j].includes("CARTESIAN COORDINATES (ANGSTROEM)")) {
            geomStart = j + 2;
            break;
          }
        }
        break;
      }
    }
  }

  // Si no, último bloque de coordenadas disponible
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

// --- Endpoint principal ---
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    // Validar API key (viene en multipart form-data)
    const key = (req.body && req.body.api_key) || "";
    if (!key || key !== API_KEY) {
      if (req.file?.path) { try { await fs.unlink(req.file.path); } catch {} }
      return res.status(403).json({ success: false, msg: "Acceso no autorizado" });
    }

    if (!req.file?.path) {
      return res.status(400).json({ success: false, msg: "No se recibió archivo" });
    }

    const text = await fs.readFile(req.file.path, "utf-8");
    const { atoms, energy } = parseOrcaOut(text);

    // Borrar el archivo temporal antes de responder
    try { await fs.unlink(req.file.path); } catch {}

    // Responder directamente con JSON (no se guarda en disco)
    return res.json({ success: true, atoms, energy });
  } catch (err) {
    // Intentar limpiar si quedó archivo temporal
    if (req.file?.path) { try { await fs.unlink(req.file.path); } catch {} }
    return res.status(500).json({ success: false, msg: err?.message || "Error interno" });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`visor-fullereno activo en puerto ${PORT}`));
