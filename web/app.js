const RPC = "https://coston2-api.flare.network/ext/C/rpc";
const ROUTER = "0x3b9d9eaff4d79a51505918c03989a16d5f84b511";
const FXRP = "0x0b6a3645c240605887a5532109323a3e12273dc7";
const USDT0 = "0xc1a5b41512496b80903d1f32d6dea3a73212e71f";
const INTENT_OWNER = "0xc9ddac13f3cec34355acb3578e6c94ce7b521d61";
const balanceCall = "0x70a08231" + ROUTER.slice(2).padStart(64, "0");
const outputCall = "0x70a08231" + INTENT_OWNER.slice(2).padStart(64, "0");
const message = document.querySelector("#message");

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

document.querySelector("#connect").addEventListener("click", async () => {
  if (!window.ethereum) { message.textContent = "Install an EVM wallet to connect to Coston2."; return; }
  try {
    const [account] = await window.ethereum.request({ method: "eth_requestAccounts" });
    document.querySelector("#connect").textContent = `${account.slice(0, 6)}…${account.slice(-4)}`;
  } catch { message.textContent = "Wallet connection was cancelled."; }
});

document.querySelector("#prepare").addEventListener("click", async () => {
  const intent = JSON.stringify({ amount: document.querySelector("#amount").value, minimumOutput: document.querySelector("#minimum").value, maximumRisk: Number(document.querySelector("#risk").value), network: "coston2" });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(intent));
  const preview = [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, "0")).join("");
  message.innerHTML = `Local commitment preview <strong>${preview.slice(0, 12)}…</strong> · no transaction was submitted. <a href="https://coston2-explorer.flare.network/tx/0xaed6ef40cc308c8c76425f50acc24a19aff1e00c9a6a2817621d1482aff2d598" target="_blank">Open the completed live execution ↗</a>`;
});

refreshBalance();
