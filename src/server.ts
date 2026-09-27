import express from "express";
import { runAgent } from "./agent.js";
import { config, missingConfig } from "./config.js";
import { engine } from "./engine.js";
import { wallet } from "./wallet.js";

const app = express();
app.use(express.json());
app.use(express.static("public"));

app.get("/api/status", async (_req, res) => {
  const missing = missingConfig();
  if (missing.length) return res.json({ configured: false, missing });
  const [walletUsdc, stashUsdc, ethBalance] = await Promise.all([
    wallet.usdcBalance(wallet.address),
    wallet.usdcBalance(config.stashAddress),
    wallet.ethBalance(),
  ]);
  res.json({
    configured: true,
    network: config.networkId,
    explorer: config.explorer,
    agentAddress: wallet.address,
    stashAddress: config.stashAddress,
    walletUsdc,
    stashUsdc,
    ethBalance,
    roundedUpToday: engine.state.roundedUpToday,
    caps: config.caps,
    rules: engine.state.rules,
  });
});

app.post("/api/rules", (req, res) => {
  const rules = String(req.body?.rules ?? "");
  engine.setRules(rules);
  res.json({ ok: true, rules: engine.state.rules });
});

app.get("/api/payments", (_req, res) => res.json(engine.state.payments.slice(0, 100)));
app.get("/api/sweeps", (_req, res) => res.json(engine.state.sweeps.slice(0, 20)));

app.post("/api/pay", async (req, res) => {
  try {
    res.json(await engine.pay(req.body ?? {}));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post("/api/sweep", async (_req, res) => {
  try {
    res.json(await engine.sweep());
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post("/api/agent", async (req, res) => {
  try {
    const instruction = String(req.body?.instruction ?? "");
    if (!instruction.trim()) return res.status(400).json({ error: "instruction is required" });
    res.json(await runAgent(instruction));
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// SSE stream so the dashboard updates live as payments and sweeps progress.
app.get("/api/stream", (req, res) => {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.write(": connected\n\n");
  const onUpdate = (payload: unknown) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
  engine.on("update", onUpdate);
  const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
  req.on("close", () => {
    clearInterval(ping);
    engine.off("update", onUpdate);
  });
});

const missing = missingConfig();
if (missing.length) {
  console.warn(`Spare is running with missing config: ${missing.join(", ")}. Set them in .env — see .env.example.`);
} else {
  void engine.maybeSweep();
}

app.listen(config.port, () => console.log(`Spare listening on http://localhost:${config.port}`));
