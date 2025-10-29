require("dotenv").config();
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import path from "path";
import { dbService } from "./database";
import { tracker } from "./tracker";

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "../public")));

// Initialize database and tracker
async function initializeApp() {
  try {
    await dbService.initialize();
    tracker.initialize();
    console.log("✅ Application initialized successfully");
  } catch (error) {
    console.error("❌ Failed to initialize application:", error);
    throw error;
  }
}

// API Routes

/**
 * GET /api/status - Get tracker status
 */
app.get("/api/status", (req, res) => {
  res.json({
    isRunning: tracker.isTrackerRunning(),
    addresses: tracker.getAddresses(),
  });
});

/**
 * POST /api/addresses - Set addresses to track
 */
app.post("/api/addresses", (req, res) => {
  try {
    const { addresses } = req.body;
    
    console.log('\n' + '📥 '.repeat(30));
    console.log('RECEIVED ADDRESSES FROM WEB INTERFACE:');
    console.log('📥 '.repeat(30));
    
    if (!Array.isArray(addresses)) {
      console.log('❌ Error: Addresses must be an array');
      return res.status(400).json({ error: "Addresses must be an array" });
    }

    // Filter out empty addresses
    const validAddresses = addresses.filter(addr => addr && addr.trim().length > 0);
    
    if (validAddresses.length === 0) {
      console.log('❌ Error: No valid addresses provided');
      return res.status(400).json({ error: "At least one valid address is required" });
    }

    validAddresses.forEach((addr, index) => {
      console.log(`   Input Field ${index + 1}: ${addr}`);
    });
    console.log('\n➡️  Passing addresses to tracker...');
    
    tracker.setAddresses(validAddresses);
    
    console.log('✅ Addresses successfully configured!\n');
    
    res.json({ 
      success: true, 
      message: "Addresses updated successfully",
      addresses: validAddresses
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/start - Start tracking
 */
app.post("/api/start", async (req, res) => {
  try {
    const result = await tracker.start();
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/stop - Stop tracking
 */
app.post("/api/stop", async (req, res) => {
  try {
    const result = await tracker.stop();
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/transactions - Get transactions with pagination and date filtering
 */
app.get("/api/transactions", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const fromDate = req.query.fromDate as string;
    const toDate = req.query.toDate as string;
    
    const [transactions, total] = await Promise.all([
      dbService.getTransactions(limit, offset, fromDate, toDate),
      dbService.getTransactionCount(fromDate, toDate)
    ]);
    
    res.json({
      transactions,
      total,
      limit,
      offset,
      fromDate: fromDate || null,
      toDate: toDate || null
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET / - Serve the main HTML page
 */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("Server error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n⏸️  Shutting down gracefully...');
  await tracker.stop();
  await dbService.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n⏸️  Shutting down gracefully...');
  await tracker.stop();
  await dbService.close();
  process.exit(0);
});

// Start server
async function main() {
  try {
    await initializeApp();
    
    app.listen(PORT, () => {
      console.log(`🚀 Server is running on http://localhost:${PORT}`);
      console.log(`📊 Open your browser to view the dashboard`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

main();

