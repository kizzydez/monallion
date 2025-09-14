// app.js (ethers v5)

// Connect wallet
async function connectWallet() {
  if (!window.ethereum) {
    alert("Please install MetaMask or OKX Wallet!");
    return;
  }
  try {
    const provider = new ethers.providers.Web3Provider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    const signer = provider.getSigner();
    const address = await signer.getAddress();

    console.log("✅ Connected:", address);
    localStorage.setItem("wallet", address);

    updateWalletUI(address);
  } catch (err) {
    console.error("❌ Wallet connection failed:", err);
    alert("Wallet connection failed: " + err.message);
  }
}

// Disconnect wallet
function disconnectWallet() {
  localStorage.removeItem("wallet");

  // Reset UI
  updateWalletUI(null);

  // Close dropdown
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
  window.location.href = "/paystart"; // ✅ matches backend route
}

// --------------------
// Event Listeners
// --------------------
window.addEventListener("DOMContentLoaded", () => {
  // Restore wallet if already saved
  const saved = localStorage.getItem("wallet");
  updateWalletUI(saved);

  // Bind disconnect button
  const disconnectBtn = document.getElementById("disconnectBtn");
  if (disconnectBtn) {
    disconnectBtn.addEventListener("click", (e) => {
      e.preventDefault();
      disconnectWallet();
    });
  }

  // Bind Start Playing button
  const startBtn = document.getElementById("startGameBtn");
  if (startBtn) {
    startBtn.addEventListener("click", startGame);
  }
});

// Close dropdown when clicking outside
document.addEventListener("click", (e) => {
  const container = document.getElementById("walletContainer");
  if (container && !container.contains(e.target)) {
    container.classList.remove("active");
  }
});
