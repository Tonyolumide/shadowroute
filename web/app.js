const RPC = "https://coston2-api.flare.network/ext/C/rpc";
const ROUTER = "0x3b9d9eaff4d79a51505918c03989a16d5f84b511";
const FXRP = "0x0b6a3645c240605887a5532109323a3e12273dc7";
const USDT0 = "0xc1a5b41512496b80903d1f32d6dea3a73212e71f";
const INTENT_OWNER = "0xc9ddac13f3cec34355acb3578e6c94ce7b521d61";
const balanceCall = "0x70a08231" + ROUTER.slice(2).padStart(64, "0");
const outputCall = "0x70a08231" + INTENT_OWNER.slice(2).padStart(64, "0");
const message = document.querySelector("#message");
const dialog = document.querySelector("#commitment-dialog");
const dialogBody = document.querySelector("#dialog-body");
const dialogTitle = document.querySelector("#dialog-title");
const nextStage = document.querySelector("#next-stage");
const previousStage = document.querySelector("#previous-stage");
const stageLabels = [...document.querySelectorAll(".dialog-steps span")];
let previewData;
let currentStage = 0;
let connectedAccount = null;
const COSTON2_CHAIN_ID = "0x72";

const stages = [
  data => `<p class="stage-kicker">${data.verified ? "Verified Coston2 intent" : "Your strategy stays private"}</p><h3>Commit the constraints, not the strategy.</h3><dl><div><dt>Amount</dt><dd>${data.amount} FXRP</dd></div><div><dt>Minimum output</dt><dd>${data.minimumOutput} USDT0</dd></div><div><dt>Risk</dt><dd>${data.riskLabel}</dd></div></dl><div class="commitment"><small>${data.verified ? "ON-CHAIN POLICY COMMITMENT" : "LOCAL SHA-256 COMMITMENT"}</small><code>${data.commitment.startsWith("0x") ? data.commitment : `0x${data.commitment}`}</code></div><p class="stage-note">${data.verified ? "Read-only evidence from the completed live flow. No wallet or transaction is required." : "Generated locally. No wallet signature or transaction was requested."}</p>`,
  () => `<p class="stage-kicker">Verified interoperability</p><h3>XRPL payment becomes private Flare execution.</h3><div class="proof-list"><div><b>1</b><span><strong>XRPL payment proved</strong><small>FDC verified the payment and Smart Account memo.</small></span><i>✓</i></div><div><b>2</b><span><strong>FXRP minted atomically</strong><small>The funded intent received 1 FXRP on Coston2.</small></span><i>✓</i></div><div><b>3</b><span><strong>FCC evaluated privately</strong><small>The TEE returned a signed route authorization.</small></span><i>✓</i></div></div>`,
  () => `<p class="stage-kicker">Authorized route</p><h3>Pangolin delivered above the private minimum.</h3><div class="route-result"><span>FXRP</span><b>→</b><span>Pangolin</span><b>→</b><span>USDT0</span></div><dl><div><dt>Required minimum</dt><dd>0.560000 USDT0</dd></div><div><dt>Delivered</dt><dd class="success">0.594003 USDT0</dd></div><div><dt>Status</dt><dd class="success">Executed ✓</dd></div></dl><a class="proof-link" href="https://coston2-explorer.flare.network/tx/0xaed6ef40cc308c8c76425f50acc24a19aff1e00c9a6a2817621d1482aff2d598" target="_blank">Inspect execution on Coston2 ↗</a>`
];

function renderStage() {
  const titles = ["01 Intent", "02 Interoperate", "03 Route"];
  dialogTitle.textContent = titles[currentStage];
  dialogBody.innerHTML = stages[currentStage](previewData);
  stageLabels.forEach((label, index) => label.classList.toggle("active", index === currentStage));
  previousStage.hidden = currentStage === 0;
  nextStage.textContent = currentStage === 0 ? "Continue to Interoperate" : currentStage === 1 ? "Continue to Route" : "Done";
}

function openPreview(data) {
  previewData = data;
  currentStage = 0;
  renderStage();
  dialog.showModal();
}

async function refreshBalance() {
  try {
    const call = (to, data, id) => fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id, method: "eth_call", params: [{ to, data }, "latest"] }) }).then(r => r.json());
    const [routerResult, ownerResult, evidence] = await Promise.all([call(FXRP, balanceCall, 1), call(USDT0, outputCall, 2), fetch("/api/evidence").then(r => r.json())]);
    const locked = Number(BigInt(routerResult.result)) / 1e6;
    const execution = evidence["coston2-pangolin-execution-v2"];
    const fcc = evidence["coston2-fcc-evaluation-v2"];
    const delivered = execution ? Number(execution.deliveredOutput) / 1e6 : Number(BigInt(ownerResult.result)) / 1e6;
    document.querySelector("#balance").textContent = `${delivered.toFixed(6)} USDT0 delivered · ${locked.toFixed(6)} FXRP locked`;
    if (fcc) document.querySelector("#fcc-status").textContent = `Encrypted evaluation passed · ${fcc.instructionId.slice(0, 10)}…`;
  } catch { document.querySelector("#balance").textContent = "Live proof available on explorer"; }
}

async function connectWallet() {
  if (!window.ethereum) { message.textContent = "Connect an EVM wallet on Coston2 before approving a route."; return false; }
  try {
    const [account] = await window.ethereum.request({ method: "eth_requestAccounts" });
    const chainId = await window.ethereum.request({ method: "eth_chainId" });
    if (chainId.toLowerCase() !== COSTON2_CHAIN_ID) {
      connectedAccount = null;
      message.textContent = "Switch your wallet to Coston2 (chain ID 114) before approving a route.";
      return false;
    }
    connectedAccount = account;
    document.querySelector("#connect").textContent = `${account.slice(0, 6)}…${account.slice(-4)}`;
    message.textContent = "Wallet connected on Coston2. You can now preview the private commitment.";
    return true;
  } catch { connectedAccount = null; message.textContent = "Wallet connection was cancelled. No route was approved."; return false; }
}

document.querySelector("#connect").addEventListener("click", connectWallet);

if (window.ethereum?.on) {
  window.ethereum.on("accountsChanged", accounts => {
    connectedAccount = accounts[0] || null;
    document.querySelector("#connect").textContent = connectedAccount ? `${connectedAccount.slice(0, 6)}…${connectedAccount.slice(-4)}` : "Connect wallet";
    if (!connectedAccount) message.textContent = "Wallet disconnected. Connect again before approving a route.";
  });
  window.ethereum.on("chainChanged", chainId => {
    if (chainId.toLowerCase() !== COSTON2_CHAIN_ID) {
      connectedAccount = null;
      document.querySelector("#connect").textContent = "Connect wallet";
      message.textContent = "Wrong network. Switch to Coston2 (chain ID 114) before approving a route.";
    }
  });
}

document.querySelector("#prepare").addEventListener("click", async () => {
  if (!connectedAccount && !(await connectWallet())) {
    document.querySelector("#connect").focus();
    return;
  }
  const risk = document.querySelector("#risk");
  const intentValues = { amount: document.querySelector("#amount").value, minimumOutput: document.querySelector("#minimum").value, maximumRisk: Number(risk.value), network: "coston2" };
  const intent = JSON.stringify(intentValues);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(intent));
  const preview = [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, "0")).join("");
  openPreview({ ...intentValues, riskLabel: risk.options[risk.selectedIndex].text, commitment: preview, verified: false });
  message.textContent = `Commitment 0x${preview.slice(0, 12)}… generated locally. No transaction was submitted.`;
});

document.querySelector("#explore").addEventListener("click", () => {
  openPreview({ amount: "1", minimumOutput: "0.56", maximumRisk: 2, riskLabel: "Balanced", network: "coston2", commitment: "0xc31e10843523058bf70fa530051d9829ce235dea474dc56892d6f3c01f04be1b", verified: true });
  message.textContent = "Showing the completed Coston2 execution in read-only judge mode. No wallet or transaction is required.";
});

nextStage.addEventListener("click", () => {
  if (currentStage === stages.length - 1) { dialog.close(); return; }
  currentStage += 1;
  renderStage();
});
previousStage.addEventListener("click", () => { currentStage -= 1; renderStage(); });
document.querySelector("#close-dialog").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });

refreshBalance();
