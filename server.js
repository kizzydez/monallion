// server.js
// ───────────────────────────────────────────────────────────────
// Backend for Monallion multipage frontend
// ───────────────────────────────────────────────────────────────

import dotenv from "dotenv";
dotenv.config();

import path from "path";
import express from "express";
import cors from "cors";
import multer from "multer";
import { parse as csvParse } from "csv-parse/sync";
import mongoose from "mongoose";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import { fileURLToPath } from "url";
import { ethers } from "ethers";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MONGO = process.env.MONGO_URI || "mongodb+srv://IRE:Eedrees16041604@ac-abc123.xdzjly6.mongodb.net/gravilionaire?retryWrites=true&w=majority";

const allowedOrigins = [
  "https://test-monallion.netlify.app",   // your frontend
  "http://localhost:3000"                 // for local dev
];

// ── DB Models ──────────────────────────────────────────────────
mongoose.set("strictQuery", false);

mongoose.connect(MONGO, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log("✅ MongoDB connected");
}).catch(err => {
  console.error("❌ MongoDB connection error:", err.message);
});

// Schemas
const QuestionSchema = new mongoose.Schema(
  {
    question: String,
    answers: [{ id: String, text: String }],
    correct: String,
    difficulty: String,
    category: String,
    source: String,
    tags: [String],
    hash: String,
  },
  { timestamps: true }
);
QuestionSchema.index({ question: "text", source: "text", tags: "text" });
const Question = mongoose.model("Question", QuestionSchema);

const LeaderboardSchema = new mongoose.Schema(
  {
    wallet: { type: String, index: true },
    winnings: { type: Number, default: 0 },
    games: { type: Number, default: 0 },
  },
  { timestamps: true }
);
const Leaderboard = mongoose.model("Leaderboard", LeaderboardSchema);

// ── Helpers ───────────────────────────────────────────────────
function questionHash(q) {
  return crypto
    .createHash("sha256")
    .update(
      (q.question || "") +
        (q.answers || []).map((a) => a.text || "").join("|") +
        (q.correct || "")
    )
    .digest("hex");
}

function validateQuestion(q) {
  return (
    q &&
    typeof q.question === "string" &&
    q.question.trim().length > 0 &&
    Array.isArray(q.answers) &&
    q.answers.length === 4 &&
    q.answers.every(a => a.id && a.text && typeof a.text === "string") &&
    typeof q.correct === "string" &&
    ["A", "B", "C", "D"].includes(q.correct.toUpperCase())
  );
}

async function upsertQuestion(q) {
  const doc = {
    question: q.question.trim(),
    answers: q.answers.map(a => ({
      id: a.id.toUpperCase(),
      text: a.text.trim()
    })),
    correct: q.correct.toUpperCase(),
    difficulty: q.difficulty || "medium",
    category: q.category || "",
    source: q.source || "",
    tags: q.tags || [],
    hash: questionHash(q),
  };
  await Question.updateOne({ hash: doc.hash }, { $set: doc }, { upsert: true });
}

// ── App Middleware ─────────────────────────────────────────────
const app = express();

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    } else {
      return callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logger
app.use((req, _res, next) => {
  console.log(`[${req.method}] ${req.url}`);
  next();
});

// Rate limit faucet
const faucetLimiter = rateLimit({
  windowMs: 4 * 60 * 60 * 1000,
  max: 1,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Rate limit exceeded. Try again later." },
});

// ── Blockchain Configuration ──────────────────────────────────
const RPC_URL = process.env.RPC_URL || "https://monad-testnet.drpc.org";
const PRIVATE_KEY = process.env.PRIVATE_KEY || "0xYOUR_TEST_PRIVATE_KEY";
const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS || "0x02dF50F4D8f65CB24eaFa5496ef576955342f6D7";
const GAME_CONTRACT_ADDRESS = process.env.GAME_CONTRACT || "0xDf666c5684c689b744FAB49287a4e6c809d6726A";

// ABIs
const TOKEN_ABI = [
  "function approve(address spender,uint256 value) public returns(bool)",
  "function balanceOf(address owner) public view returns(uint256)",
  "function transfer(address to,uint256 value) public returns(bool)",
  "function allowance(address owner,address spender) public view returns(uint256)",
  "function decimals() public view returns(uint8)"
];

const GAME_ABI = [
  "function entryFee() view returns (uint256)",
  "function startGame() external",
  "function endGame() external",
  "function tryAgain() external",
  "function recordWinnings(address player, uint256 amount) external",
  "function withdrawWinnings() external",
  "function hasActiveTicket(address player) view returns (bool)",
  "function contractBalance() external view returns (uint256)",
  "event GameStarted(address indexed player, uint256 fee)",
  "event GameOver(address indexed player, uint256 payout)",
  "event WinningsRecorded(address indexed player, uint256 amount)",
  "event WinningsWithdrawn(address indexed player, uint256 amount)"
];

// Initialize ethers
let provider, wallet, faucetContract, tokenContract, gameContract;
try {
  provider = new ethers.JsonRpcProvider(RPC_URL);
  wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  tokenContract = new ethers.Contract(TOKEN_ADDRESS, TOKEN_ABI, wallet);
  gameContract = new ethers.Contract(GAME_CONTRACT_ADDRESS, GAME_ABI, wallet);
  console.log("✅ Ethers initialized successfully");
} catch (e) {
  console.error("❌ Failed to initialize ethers:", e.message);
}

// ── API Routes ────────────────────────────────────────────────
app.get("/api/health", async (_req, res) => {
  try {
    const dbStatus = mongoose.connection.readyState === 1 ? "connected" : "disconnected";
    res.json({ ok: true, db: dbStatus, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ ok: false, error: "Health check failed" });
  }
});

app.get("/api/config", (_req, res) => {
  res.json({
    ok: true,
    chainIdHex: process.env.CHAIN_ID_HEX || "0x40d8",
    tokenSymbol: process.env.TOKEN_SYMBOL || "QUIZ",
    token: {
      address: TOKEN_ADDRESS,
      decimals: Number(process.env.TOKEN_DECIMALS || 18),
    },
    contract: GAME_CONTRACT_ADDRESS,
  });
});

    app.post("/api/some-endpoint", async (req, res) => {
  try {
    const { address } = req.body;

    if (!address) {
      return res.status(400).json({ error: "Address is required" });
    }

    if (!ethers.isAddress(address)) {
      return res.status(400).json({ error: "Invalid Ethereum address" });
    }

    // your logic here
    res.json({ ok: true, address });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
});

// Upload questions JSON
app.post("/api/questions/upload", async (req, res) => {
  try {
    const payload = req.body;
    if (!Array.isArray(payload))
      return res.status(400).json({ error: "expected an array" });

    const results = { inserted: 0, duplicates: 0, invalid: 0 };
    for (const q of payload) {
      if (!validateQuestion(q)) {
        results.invalid++;
        continue;
      }
      const hash = questionHash(q);
      const exists = await Question.findOne({ hash }, "_id").lean();
      if (exists) {
        results.duplicates++;
        continue;
      }
      await upsertQuestion(q);
      results.inserted++;
    }
    res.json(results);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server error" });
  }
});

// Upload questions CSV
const upload = multer({ storage: multer.memoryStorage() });
app.post("/api/questions/upload-csv", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "missing file" });
    const text = req.file.buffer.toString("utf8");
    const records = csvParse(text, { columns: true, skip_empty_lines: true });

    let results = { inserted: 0, duplicates: 0, invalid: 0 };
    for (const r of records) {
      const q = {
        question: r.question,
        answers: [
          { id: "A", text: r.answerA || "" },
          { id: "B", text: r.answerB || "" },
          { id: "C", text: r.answerC || "" },
          { id: "D", text: r.answerD || "" },
        ],
        correct: (r.correct || "").toString().trim(),
        difficulty: r.difficulty || "medium",
        category: r.category || "",
        source: r.source || "",
        tags: (r.tags || "")
          .split("|")
          .map((s) => s.trim())
          .filter(Boolean),
      };

      if (!validateQuestion(q)) {
        results.invalid++;
        continue;
      }
      const hash = questionHash(q);
      const exists = await Question.findOne({ hash }, "_id").lean();
      if (exists) {
        results.duplicates++;
        continue;
      }
      await upsertQuestion(q);
      results.inserted++;
    }
    res.json(results);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Random questions
app.get("/api/questions/random", async (req, res) => {
  try {
    const count = Math.min(50, Math.max(1, parseInt(req.query.count || "15")));
    
    // Check if we have enough questions
    const totalQuestions = await Question.countDocuments();
    if (totalQuestions < count) {
      // For localhost, return mock questions if database is empty
      const mockQuestions = Array.from({length: count}, (_, i) => ({
        question: `Sample question ${i+1}`,
        answers: [
          { id: "A", text: "Answer A" },
          { id: "B", text: "Answer B" },
          { id: "C", text: "Answer C" },
          { id: "D", text: "Answer D" }
        ],
        correct: "A"
      }));
      return res.json({ count: mockQuestions.length, questions: mockQuestions });
    }
    
    const docs = await Question.aggregate([{ $sample: { size: count } }]);
    
    const formattedQuestions = docs.map(q => ({
      question: q.question,
      answers: q.answers,
      correct: q.correct
    }));
    
    res.json({ count: formattedQuestions.length, questions: formattedQuestions });
  } catch (err) {
    console.error("Error fetching random questions:", err);
    
    // Return mock questions on error for localhost
    const mockQuestions = Array.from({length: 15}, (_, i) => ({
      question: `Sample question ${i+1}`,
      answers: [
        { id: "A", text: "Answer A" },
        { id: "B", text: "Answer B" },
        { id: "C", text: "Answer C" },
        { id: "D", text: "Answer D" }
      ],
      correct: "A"
    }));
    res.json({ count: mockQuestions.length, questions: mockQuestions });
  }
});

// Leaderboard
app.post("/api/game/complete", async (req, res) => {
  try {
    const { wallet, payout = 0 } = req.body;
    if (!wallet) return res.status(400).json({ error: "wallet required" });

    const win = Math.max(0, Number(payout || 0));
    await Leaderboard.updateOne(
      { wallet: wallet.toLowerCase() },
      { $inc: { winnings: win, games: 1 } },
      { upsert: true }
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/leaderboard", async (_req, res) => {
  try {
    const top = await Leaderboard.find().sort({ winnings: -1 }).limit(100).lean();
    const players = top.map((p, i) => ({
      rank: i + 1,
      wallet: p.wallet,
      wins: p.games || 0,
      payout: p.winnings || 0,
    }));
    res.json({ ok: true, players });
  } catch (err) {
    // Return mock leaderboard for localhost
    res.json({ 
      ok: true, 
      players: [
        { rank: 1, wallet: "0x1234...abcd", wins: 10, payout: 500000 },
        { rank: 2, wallet: "0x5678...efgh", wins: 8, payout: 250000 },
        { rank: 3, wallet: "0x9012...ijkl", wins: 5, payout: 100000 }
      ] 
    });
  }
});

app.get("/api/profile/:wallet", async (req, res) => {
  try {
    const wallet = (req.params.wallet || "").toLowerCase();
    if (!wallet) return res.status(400).json({ error: "wallet required" });
    const p = await Leaderboard.findOne({ wallet }).lean();
    res.json({
      ok: true,
      wallet,
      games: p?.games || 0,
      winnings: p?.winnings || 0,
      tier:
        (p?.winnings || 0) >= 500000
          ? "diamond"
          : (p?.winnings || 0) >= 100000
          ? "gold"
          : (p?.winnings || 0) >= 10000
          ? "silver"
          : "bronze",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── WITHDRAWAL ENDPOINTS ──────────────────────────────────────

// Check contract balance endpoint
app.get("/api/contract/balance", async (req, res) => {
  try {
    // For local testing, return a simulated balance
    if (!PRIVATE_KEY || PRIVATE_KEY === "0xYOUR_TEST_PRIVATE_KEY") {
      return res.json({ 
        balance: 1000000, // 1,000,000 OGMN simulated balance
        ok: true 
      });
    }
    
    // Production: check real contract balance
    const balance = await tokenContract.balanceOf(GAME_CONTRACT_ADDRESS);
    res.json({ 
      balance: Number(ethers.formatUnits(balance, 18)),
      ok: true 
    });
  } catch (error) {
    console.error("Balance check error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Withdrawal endpoint - handles REAL token transfers
app.post("/api/withdraw", async (req, res) => {
  try {
    const { wallet, amount } = req.body;

    if (!wallet || !amount) {
      return res.status(400).json({ error: "Wallet and amount required" });
    }

    if (!ethers.isAddress(wallet)) {
      return res.status(400).json({ error: "Invalid wallet address" });
    }

    // Check winnings stored in DB
    const player = await Leaderboard.findOne({ wallet: wallet.toLowerCase() });
    if (!player || player.winnings < amount) {
      return res.status(400).json({ error: "Insufficient winnings" });
    }

    // Call contract: record winnings
    const tx = await gameContract.recordWinnings(wallet, amount);
    const receipt = await tx.wait();

    if (receipt.status === 1) {
      // Reduce DB balance only after blockchain success
      await Leaderboard.updateOne(
        { wallet: wallet.toLowerCase() },
        { $inc: { winnings: -amount } }
      );

      res.json({
        success: true,
        message: `Winnings of ${amount} QUIZ recorded. Player can withdraw.`,
        txHash: tx.hash
      });
    } else {
      throw new Error("Transaction failed");
    }
  } catch (error) {
    console.error("Withdrawal error:", error);
    res.status(500).json({ error: error.message });
  }
});


// Admin endpoint to fund the game contract
app.post("/api/admin/fund-contract", async (req, res) => {
  try {
    const { amount } = req.body;
    
    if (!amount) {
      return res.status(400).json({ error: "Amount required" });
    }

    // For local testing
    if (!PRIVATE_KEY || PRIVATE_KEY === "0xYOUR_TEST_PRIVATE_KEY") {
      console.log(`Simulated: Contract funded with ${amount} QUIZ tokens`);
      return res.json({ 
        success: true, 
        message: `Contract funded with ${amount} QUIZ tokens (simulated)`
      });
    }

    // Production: Transfer tokens to game contract
    const decimals = await tokenContract.decimals();
    const amountInWei = ethers.parseUnits(amount.toString(), decimals);
    
    const tx = await tokenContract.transfer(GAME_CONTRACT_ADDRESS, amountInWei, {
      gasLimit: 100000
    });
    
    const receipt = await tx.wait();
    
    if (receipt.status === 1) {
      res.json({ 
        success: true, 
        message: `Contract funded with ${amount} QUIZ tokens`,
        txHash: tx.hash
      });
    } else {
      throw new Error("Funding transaction failed");
    }
  } catch (error) {
    console.error("Funding error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ── Static frontend pages ──────────────────────────────────────
app.use(express.static(__dirname, { extensions: ["html"] }));

app.get("/paystart", (_req, res) => res.sendFile(path.join(__dirname, "paystart.html")));
app.get("/leaderboard", (_req, res) => res.sendFile(path.join(__dirname, "topplayer.html")));
app.get("/profile", (_req, res) => res.sendFile(path.join(__dirname, "profile.html")));
app.get("/faucet", (_req, res) => res.sendFile(path.join(__dirname, "faucet.html")));
app.get("/game", (_req, res) => res.sendFile(path.join(__dirname, "gamepage.html")));

// 404 handler for API routes
app.use(/^\/api\/.*/, (_req, res) => {
  res.status(404).json({ error: "not found" });
});

// Fallback → home.html
app.use((req, res, next) => {
  if (req.method !== "GET") return next();
  if (req.path.startsWith("/api")) return next();
  res.sendFile(path.join(__dirname, "home.html"));
});

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Something went wrong!" });
});

const PORT = process.env.PORT || 8081;
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});




