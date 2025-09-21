// app.js (ethers v5 + Monad Testnet auto-switch)

// Load env values (injected via build or inline <script> with data-env)
const MONAD_CHAIN_ID_HEX = "0x40d8"; // from .env (CHAIN_ID_HEX)
const MONAD_RPC_URL = "https://monad-testnet.drpc.org"; // from .env
const MONAD_CHAIN_NAME = "Monad Testnet"; // human-readable

// Connect wallet + ensure Monad Testnet
async function connectWallet() {
  if (!window.ethereum) {
    alert("Please install MetaMask or OKX Wallet!");
    return;
  }
  try {
    const provider = new ethers.providers.Web3Provider(window.ethereum);

    // Ask for wallet access
    await provider.send("eth_requestAccounts", []);

    // Ensure correct network
    await switchToMonad();

    const signer = provider.getSigner();
    const address = await signer.getAddress();

    console.log("✅ Connected:", address);
    localStorage.setItem("wallet", address);

    updateWalletUI(address);
  } catch (err) {
    console.error("❌ Wallet connection failed:", err);
    alert("Wallet connection failed: " + (err.message || err));
  }
}

// Switch user to Monad Testnet
async function switchToMonad() {
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: MONAD_CHAIN_ID_HEX }],
    });
    console.log("✅ Switched to Monad Testnet");
  } catch (switchError) {
    // If chain not added to wallet, add it
    if (switchError.code === 4902) {
      try {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: MONAD_CHAIN_ID_HEX,
              chainName: MONAD_CHAIN_NAME,
              nativeCurrency: {
                name: "Monad Testnet Token",
                symbol: "tMON", // adjust if different
                decimals: 18,
              },
              rpcUrls: [MONAD_RPC_URL],
              blockExplorerUrls: ["https://testnet.monadexplorer.com"], // adjust if you have official explorer
            },
          ],
        });
        console.log("✅ Monad Testnet added & switched");
      } catch (addError) {
        console.error("❌ Failed to add Monad Testnet:", addError);
        alert("Please manually add Monad Testnet to your wallet.");
      }
    } else {
      console.error("❌ Failed to switch network:", switchError);
    }
  }
}

// Disconnect wallet
function disconnectWallet() {
  localStorage.removeItem("wallet");
  updateWalletUI(null);

  const container = document.getElementById("walletContainer");
  if (container) container.classList.remove("active");

  console.log("🔌 Wallet disconnected");
}

// Update UI after connect/disconnect
function updateWalletUI(address) {
  const btn = document.querySelector(".connect-wallet-btn");
  if (btn) {
    if (address) {
      btn.textContent = " " + address.slice(0, 6) + "..." + address.slice(-4);
      btn.style.background = "linear-gradient(45deg,#4CAF50,#45a049)";
      btn.onclick = () => {
        const container = document.getElementById("walletContainer");
        if (container) container.classList.toggle("active");
      };
    } else {
      btn.textContent = "🔌 Connect Wallet";
      btn.style.background = "linear-gradient(45deg,#8b5cf6,#a78bfa)";
      btn.onclick = connectWallet;
    }
  }

  const walletAddrDisplay = document.getElementById("walletAddress");
  if (walletAddrDisplay) {
    walletAddrDisplay.textContent = address
      ? address.slice(0, 6) + "..." + address.slice(-4)
      : "Not Connected";
  }

  const shortAddr = document.getElementById("shortAddr");
  if (shortAddr) {
    shortAddr.textContent = address
      ? address.slice(0, 6) + "..." + address.slice(-4)
      : "—";
  }
}

// Handle Start Game button
function startGame() {
  const wallet = localStorage.getItem("wallet");
  if (!wallet) {
    alert("❌ Please connect your wallet first!");
    return;
  }
  window.location.href = "/paystart"; // ✅ backend route
}

// --------------------
// Event Listeners
// --------------------
window.addEventListener("DOMContentLoaded", () => {
  const saved = localStorage.getItem("wallet");
  updateWalletUI(saved);

  const disconnectBtn = document.getElementById("disconnectBtn");
  if (disconnectBtn) {
    disconnectBtn.addEventListener("click", (e) => {
      e.preventDefault();
      disconnectWallet();
    });
  }

  const startBtn = document.getElementById("startGameBtn");
  if (startBtn) {
    startBtn.addEventListener("click", startGame);
  }
});

document.addEventListener("click", (e) => {
  const container = document.getElementById("walletContainer");
  if (container && !container.contains(e.target)) {
    container.classList.remove("active");
  }
});
