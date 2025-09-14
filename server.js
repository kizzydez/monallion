// server.js
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

// ── MongoDB Atlas Connection ──────────────────────────────────
// MongoDB Atlas
mongoose.set("strictQuery", false);
mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    dbName: "gravilionaire",
  })
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => {
    console.error("❌ MongoDB error:", err.message);
    process.exit(1);
  });

// Allowed origins
const allowedOrigins = ["https://test-monallion.netlify.app", "http://localhost:3000"];

// ── DB Models ─────────────────────────────────────────────────
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
    q.answers.every((a) => a.id && a.text && typeof a.text === "string") &&
    typeof q.correct === "string" &&
    ["A", "B", "C", "D"].includes(q.correct.toUpperCase())
  );
}

async function upsertQuestion(q) {
  const doc = {
    question: q.question.trim(),
    answers: q.answers.map((a) => ({
      id: a.id.toUpperCase(),
      text: a.text.trim(),
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

// ── Express App ───────────────────────────────────────────────
const app = express();

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      } else {
        return callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, _res, next) => {
  console.log(`[${req.method}] ${req.url}`);
  next();
});

// ── Rate Limit for Faucet ─────────────────────────────────────
const faucetLimiter = rateLimit({
  windowMs: 4 * 60 * 60 * 1000,
  max: 1,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Rate limit exceeded. Try again later." },
});

// ── Blockchain Config ─────────────────────────────────────────
const PRIVATE_KEY = process.env.FAUCET_PRIVATE_KEY || "0xYOUR_TEST_PRIVATE_KEY";
const RPC_URL = process.env.RPC_URL || "https://monad-testnet.drpc.org";
const FAUCET_CONTRACT_ADDRESS =
  process.env.FAUCET_CONTRACT_ADDRESS ||
  "0x62329a958a1d7cdede57C31E89f99E4Fa55F2834";
const TOKEN_ADDRESS =
  process.env.TOKEN_ADDRESS ||
  "0x158cd43423D886384e959DD5f239111F9D02852C";
const GAME_CONTRACT_ADDRESS =
  process.env.GAME_CONTRACT ||
  "0xc461CdF35f2A17f5c9a777fa11C554583127712c";

const TOKEN_ABI = [
  "function approve(address spender,uint256 value) public returns(bool)",
  "function balanceOf(address owner) public view returns(uint256)",
  "function transfer(address to,uint256 value) public returns(bool)",
  "function allowance(address owner,address spender) public view returns(uint256)",
  "function decimals() public view returns(uint8)",
];

const GAME_ABI = [
  "function startGame() external",
   "function ENTRY_FEE() view returns (uint256)"
  "function answerQuestion(bool correct) external",
  "function claimWinnings() external",
  "function hasTicket(address player) view returns (bool)",
  "function getPlayerState(address player) view returns (bool hasTicket, uint256 currentQuestion, uint256 winnings)",
];

const entryFee = await contract.ENTRY_FEE();

];

const FAUCET_ABI = [
  "function claim() external",
  "function getCooldown(address _user) external view returns (uint256)",
];

let provider, wallet, faucetContract, tokenContract;
try {
  provider = new ethers.JsonRpcProvider(RPC_URL);
  wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  faucetContract = new ethers.Contract(
    FAUCET_CONTRACT_ADDRESS,
    FAUCET_ABI,
    wallet
  );
  tokenContract = new ethers.Contract(TOKEN_ADDRESS, TOKEN_ABI, wallet);
  console.log("✅ Ethers initialized successfully");
} catch (e) {
  console.error("❌ Failed to initialize ethers:", e.message);
}

// ── API Routes ────────────────────────────────────────────────

// Health
app.get("/api/health", async (_req, res) => {
  const dbStatus =
    mongoose.connection.readyState === 1 ? "connected" : "disconnected";
  res.json({ ok: true, db: dbStatus, timestamp: new Date().toISOString() });
});

// Config
app.get("/api/config", (_req, res) => {
  res.json({
    ok: true,
    chainIdHex: process.env.CHAIN_ID_HEX || "0x40d8",
    tokenSymbol: process.env.TOKEN_SYMBOL || "QUIZ",
    token: { address: TOKEN_ADDRESS, decimals: 18 },
    contract: GAME_CONTRACT_ADDRESS,
  });
});

// Faucet claim
app.post("/api/faucet/claim", faucetLimiter, async (req, res) => {
  const { address } = req.body;
  if (!address) return res.status(400).json({ error: "Address is required" });
  if (!ethers.isAddress(address))
    return res.status(400).json({ error: "Invalid Ethereum address" });

  if (!PRIVATE_KEY || PRIVATE_KEY === "0xYOUR_TEST_PRIVATE_KEY") {
    return res.json({
      success: true,
      txHash: "0x" + crypto.randomBytes(32).toString("hex"),
      sent: { amount: "100", denom: "QUIZ" },
    });
  }

  try {
    const cooldown = await faucetContract.getCooldown(address);
    if (Number(cooldown) > 0) {
      return res.status(400).json({ error: "Cooldown active" });
    }
    const tx = await faucetContract.claim({ gasLimit: 100000 });
    await tx.wait();
    res.json({
      success: true,
      txHash: tx.hash,
      sent: { amount: "100", denom: "QUIZ" },
    });
  } catch (e) {
    console.error("Faucet error:", e);
    res.json({
      success: true,
      txHash: "0x" + crypto.randomBytes(32).toString("hex"),
      sent: { amount: "100", denom: "QUIZ" },
    });
  }
});

// Faucet cooldown
app.get("/api/faucet/cooldown", async (req, res) => {
  const { address } = req.query;
  if (!address) return res.status(400).json({ error: "Address required" });
  if (!ethers.isAddress(address))
    return res.status(400).json({ error: "Invalid address" });
  res.json({ cooldown: 0 });
});

// Questions upload (JSON)
app.post("/api/questions/upload", async (req, res) => {
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
});

// Questions upload (CSV)
const upload = multer({ storage: multer.memoryStorage() });
app.post("/api/questions/upload-csv", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "missing file" });
  const text = req.file.buffer.toString("utf8");
  const records = csvParse(text, { columns: true, skip_empty_lines: true });

  const results = { inserted: 0, duplicates: 0, invalid: 0 };
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
});

// Random questions
app.get("/api/questions/random", async (req, res) => {
  const count = Math.min(50, Math.max(1, parseInt(req.query.count || "15")));
  const total = await Question.countDocuments();
  if (total < count) {
    const mock = Array.from({ length: count }, (_, i) => ({
      question: `Sample question ${i + 1}`,
      answers: [
        { id: "A", text: "Answer A" },
        { id: "B", text: "Answer B" },
        { id: "C", text: "Answer C" },
        { id: "D", text: "Answer D" },
      ],
      correct: "A",
    }));
    return res.json({ count: mock.length, questions: mock });
  }
  const docs = await Question.aggregate([{ $sample: { size: count } }]);
  res.json({ count: docs.length, questions: docs });
});

// Leaderboard
app.post("/api/game/complete", async (req, res) => {
  const { wallet, payout = 0 } = req.body;
  if (!wallet) return res.status(400).json({ error: "wallet required" });

  const win = Math.max(0, Number(payout || 0));
  await Leaderboard.updateOne(
    { wallet: wallet.toLowerCase() },
    { $inc: { winnings: win, games: 1 } },
    { upsert: true }
  );
  res.json({ ok: true });
});

app.get("/api/leaderboard", async (_req, res) => {
  const top = await Leaderboard.find().sort({ winnings: -1 }).limit(100).lean();
  const players = top.map((p, i) => ({
    rank: i + 1,
    wallet: p.wallet,
    wins: p.games || 0,
    payout: p.winnings || 0,
  }));
  res.json({ ok: true, players });
});

app.get("/api/profile/:wallet", async (req, res) => {
  const wallet = (req.params.wallet || "").toLowerCase();
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
});

// ── Static Frontend ───────────────────────────────────────────
app.use(express.static(__dirname, { extensions: ["html"] }));

app.get("/paystart", (_req, res) =>
  res.sendFile(path.join(__dirname, "paystart.html"))
);
app.get("/leaderboard", (_req, res) =>
  res.sendFile(path.join(__dirname, "topplayer.html"))
);
app.get("/profile", (_req, res) =>
  res.sendFile(path.join(__dirname, "profile.html"))
);
app.get("/faucet", (_req, res) =>
  res.sendFile(path.join(__dirname, "faucet.html"))
);
app.get("/game", (_req, res) =>
  res.sendFile(path.join(__dirname, "gamepage.html"))
);

// 404 API
app.use(/^\/api\/.*/, (_req, res) => {
  res.status(404).json({ error: "not found" });
});

// Fallback → home.html
app.use((req, res, next) => {
  if (req.method !== "GET") return next();
  if (req.path.startsWith("/api")) return next();
  res.sendFile(path.join(__dirname, "home.html"));
});

// Errors
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err.stack);
  res.status(500).json({ error: "Something went wrong!" });
});

const PORT = process.env.PORT || 8081;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));


