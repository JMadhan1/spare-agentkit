import { app } from "./app.js";
import { config, missingConfig } from "./config.js";
import { engine } from "./engine.js";

const missing = missingConfig();
if (missing.length) {
  console.warn(`Spare is running with missing config: ${missing.join(", ")}. Set them in .env — see .env.example.`);
} else {
  void engine.maybeSweep();
}

app.listen(config.port, () => console.log(`Spare listening on http://localhost:${config.port}`));
