import { initBotId } from "botid/client/core";

// Vercel BotID (Basic mode only; free on all plans). Attaches the challenge
// solution to protected requests; the server verifies it with checkBotId().
initBotId({ protect: [{ path: "/api/test-drive", method: "POST" }] });
