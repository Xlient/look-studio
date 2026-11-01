import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { avatarQueue, createRuntimeContainer } from "./container.ts";
import { envNumber } from "./env.ts";

const port = envNumber("PORT", 3001);
// Cloud Run allows 10 s after SIGTERM; aborting builds before then lets them delete their Meshy tasks.
const SHUTDOWN_GRACE_MS = 7_000;

const server = serve({ fetch: createApp(createRuntimeContainer()).fetch, port }, () => {
  console.log(`look-studio server listening on http://localhost:${port}`);
});

process.once("SIGTERM", () => {
  server.close();
  void avatarQueue.shutdown(SHUTDOWN_GRACE_MS).finally(() => process.exit(0));
});
