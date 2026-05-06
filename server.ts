import express from "express";
import { createServer as createViteServer } from "vite";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import "dotenv/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper for SHA-256 hashing
function calculateHash(data: any): string {
  const dataString = JSON.stringify(data);
  return crypto.createHash('sha256').update(dataString).digest('hex');
}

async function startServer() {
  const app = express();
  const PORT = 3000;
  
  // Security: Admin Password from env or fallback
  const ADMIN_CODE = process.env.ADMIN_PASSWORD || "NCKH_V2X_2026";

  app.use(express.json());

  // Auth Middleware for protected routes
  const requireAuth = (req: any, res: any, next: any) => {
    const code = req.headers['x-admin-code'];
    if (code === ADMIN_CODE) {
      next();
    } else {
      res.status(403).json({ error: "Unauthorized: Invalid Access Code" });
    }
  };

  const dataDir = path.join(__dirname, "data");
  const dbPath = path.join(dataDir, "db.json");
  const blocksPath = path.join(dataDir, "blocks.json");
  
  // Ensure data directory exists
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir);
  }
  
  // Initialize db.json with sample data if it doesn't exist
  if (!fs.existsSync(dbPath)) {
    const initialReports = [
      {
        id: "INIT_001",
        name: "Lái xe bình thường (Normal Driving)",
        timestamp: new Date().toLocaleTimeString(),
        data: {
          accel: "0.02G",
          heading: "180.0°",
          lat: 21.0285,
          lng: 105.8542,
          v2x: "DSRC_ACTIVE",
          hash: "sha256_initial_sample_data"
        },
        status: "NORMAL",
        createdAt: new Date().toISOString()
      }
    ];
    fs.writeFileSync(dbPath, JSON.stringify({ reports: initialReports }, null, 2));
  }

  // Initialize blocks.json with Genesis Block if it doesn't exist
  if (!fs.existsSync(blocksPath)) {
    const genesisBlock = {
      index: 0,
      timestamp: Date.now(),
      messages: [{
        id: "GENESIS_MSG",
        type: "SYSTEM_INIT",
        content: "V2X Blockchain Network Started"
      }],
      previousHash: "0",
      hash: "7e5e7e_GENESIS_BLOCK_SHA256",
      nonce: 100
    };
    fs.writeFileSync(blocksPath, JSON.stringify({ blocks: [genesisBlock] }, null, 2));
  }

  // API Route: Get all reports
  app.get("/api/reports", (req, res) => {
    try {
      if (!fs.existsSync(dbPath)) return res.json([]);
      const data = JSON.parse(fs.readFileSync(dbPath, "utf-8"));
      res.json(data.reports || []);
    } catch (error) {
      res.status(500).json({ error: "Failed to read database" });
    }
  });

  // API Route: Save a report (PROTECTED)
  app.post("/api/reports", requireAuth, (req, res) => {
    try {
      const newReport = req.body;
      const data = JSON.parse(fs.readFileSync(dbPath, "utf-8"));
      data.reports = data.reports || [];
      data.reports.unshift(newReport);
      
      // Limit to 200 records
      if (data.reports.length > 200) data.reports = data.reports.slice(0, 200);
      
      fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
      res.status(201).json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to save to database" });
    }
  });

  // API Route: Get all blocks
  app.get("/api/blocks", (req, res) => {
    try {
      if (!fs.existsSync(blocksPath)) return res.json([]);
      const data = JSON.parse(fs.readFileSync(blocksPath, "utf-8"));
      res.json(data.blocks || []);
    } catch (error) {
      res.status(500).json({ error: "Failed to read blocks" });
    }
  });

  // API Route: Save a block (Mining/Hashing logic on server) (PROTECTED)
  app.post("/api/blocks", requireAuth, (req, res) => {
    try {
      const { messages, previousHash, index } = req.body;
      const data = JSON.parse(fs.readFileSync(blocksPath, "utf-8"));
      
      // Create new block structure
      const newBlock: any = {
        index: index !== undefined ? index : data.blocks.length,
        timestamp: Date.now(),
        messages: messages || [],
        previousHash: previousHash || (data.blocks.length > 0 ? data.blocks[data.blocks.length - 1].hash : "0"),
        nonce: Math.floor(Math.random() * 1000000)
      };

      // Server-side SHA-256 Hashing for security
      newBlock.hash = calculateHash(newBlock);
      
      data.blocks.push(newBlock);
      fs.writeFileSync(blocksPath, JSON.stringify(data, null, 2));
      
      res.status(201).json({ success: true, block: newBlock });
    } catch (error) {
      res.status(500).json({ error: "Failed to save block" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      const indexPath = path.join(distPath, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send("Build artifacts not found.");
      }
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
