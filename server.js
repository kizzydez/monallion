// server.js
// ───────────────────────────────────────────────────────────────
// Backend for Monallion multipage frontend (Supabase Edition)
// ───────────────────────────────────────────────────────────────

import dotenv from "dotenv";
dotenv.config();

import path from "path";
import express from "express";
import cors from "cors";
import multer from "multer";
import { parse as csvParse } from "csv-parse/sync";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import { fileURLToPath } from "url";
import { ethers } from "ethers";
import { createClient } from "@supabase/supabase-js";

// ── Paths ─────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Supabase Setup ────────────────────────────────────────────
const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://tnoizbvhjhbmwckaejel.supabase.co";
const SUPABASE_KEY =
  process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error("❌ Missing Supabase credentials");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
console.log("✅ Supabase connected");

// ── Express App ───────────────────────────────────────────────
const app = express();

const allowedOrigins = [
  "https://test-monallion.netlify.app",
  "http://localhost:3000",
];

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

// ── Blockchain Config ─────────────────────────────────────────
const RPC_URL = process.env.RPC_URL || "https://monad-testnet.drpc.org";
const PRIVATE_KEY = process.env.PRIVATE_KEY || "0xYOUR_TEST_PRIVATE_KEY";
const TOKEN_ADDRESS =
  process.env.TOKEN_ADDRESS ||
  "0x02dF50F4D8f65CB24eaFa5496ef576955342f6D7";
const GAME_CONTRACT_ADDRESS =
  process.env.GAME_CONTRACT ||
  "0xDf666c5684c689b744FAB49287a4e6c809d6726A";

const TOKEN_ABI = [
  "function approve(address spender,uint256 value) public returns(bool)",
  "function balanceOf(address owner) public view returns(uint256)",
  "function transfer(address to,uint256 value) public returns(bool)",
  "function allowance(address owner,address spender) public view returns(uint256)",
  "function decimals() public view returns(uint8)",
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
  "event WinningsWithdrawn(address indexed player, uint256 amount)",
];

let provider, wallet, tokenContract, gameContract;
try {
  provider = new ethers.JsonRpcProvider(RPC_URL);
  wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  tokenContract = new ethers.Contract(TOKEN_ADDRESS, TOKEN_ABI, wallet);
  gameContract = new ethers.Contract(GAME_CONTRACT_ADDRESS, GAME_ABI, wallet);
  console.log("✅ Ethers initialized successfully");
} catch (e) {
  console.error("❌ Failed to initialize ethers:", e.message);
}

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

  const { error } = await supabase.from("questions").upsert(doc, {
    onConflict: "hash",
  });
  if (error) throw error;
}

// ── API Routes ────────────────────────────────────────────────
app.get("/api/health", async (_req, res) => {
  try {
    const { error } = await supabase.from("questions").select("id").limit(1);
    const dbStatus = error ? "disconnected" : "connected";
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

// Upload questions (JSON)
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
      const { data } = await supabase
        .from("questions")
        .select("id")
        .eq("hash", hash)
        .maybeSingle();

      if (data) {
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

// Upload questions (CSV)
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
      const { data } = await supabase
        .from("questions")
        .select("id")
        .eq("hash", hash)
        .maybeSingle();

      if (data) {
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
    const { data, error } = await supabase
      .from("questions")
      .select("*")
      .limit(count);

    if (error) throw error;

    if (!data || data.length === 0) {
      const mockQuestions = Array.from({ length: count }, (_, i) => ({
        question: `Sample question ${i + 1}`,
        answers: [
          { id: "A", text: "Answer A" },
          { id: "B", text: "Answer B" },
          { id: "C", text: "Answer C" },
          { id: "D", text: "Answer D" },
        ],
        correct: "A",
      }));
      return res.json({ count: mockQuestions.length, questions: mockQuestions });
    }

    res.json({ count: data.length, questions: data });
  } catch (err) {
    console.error("Error fetching random questions:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

// Game complete → update leaderboard
app.post("/api/game/complete", async (req, res) => {
  try {
    const { wallet, payout = 0 } = req.body;
    if (!wallet) return res.status(400).json({ error: "wallet required" });

    const win = Math.max(0, Number(payout || 0));
    const { error } = await supabase.from("leaderboard").upsert(
      {
        wallet: wallet.toLowerCase(),
        winnings: win,
        games: 1,
      },
      { onConflict: "wallet" }
    );
    if (error) throw error;

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Leaderboard
app.get("/api/leaderboard", async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from("leaderboard")
      .select("*")
      .order("winnings", { ascending: false })
      .limit(100);

    if (error) throw error;

    const players = data.map((p, i) => ({
      rank: i + 1,
      wallet: p.wallet,
      wins: p.games || 0,
      payout: p.winnings || 0,
    }));

    res.json({ ok: true, players });
  } catch (err) {
    res.json({
      ok: true,
      players: [
        { rank: 1, wallet: "0x1234...abcd", wins: 10, payout: 500000 },
        { rank: 2, wallet: "0x5678...efgh", wins: 8, payout: 250000 },
        { rank: 3, wallet: "0x9012...ijkl", wins: 5, payout: 100000 },
      ],
    });
  }
});

// Player profile
app.get("/api/profile/:wallet", async (req, res) => {
  try {
    const wallet = (req.params.wallet || "").toLowerCase();
    if (!wallet) return res.status(400).json({ error: "wallet required" });

    const { data, error } = await supabase
      .from("leaderboard")
      .select("*")
      .eq("wallet", wallet)
      .maybeSingle();
    if (error) throw error;

    res.json({
      ok: true,
      wallet,
      games: data?.games || 0,
      winnings: data?.winnings || 0,
      tier:
        (data?.winnings || 0) >= 500000
          ? "diamond"
          : (data?.winnings || 0) >= 100000
          ? "gold"
          : (data?.winnings || 0) >= 10000
          ? "silver"
          : "bronze",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Contract Balance + Withdrawals (same as before) ───────────
// (… keep your existing blockchain endpoints unchanged …)

// ── Static frontend pages ─────────────────────────────────────
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
