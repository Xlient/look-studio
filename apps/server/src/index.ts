import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { createRuntimeContainer } from "./container.ts";
import { envNumber } from "./env.ts";

const port = envNumber("PORT", 3001);

serve({ fetch: createApp(createRuntimeContainer()).fetch, port }, () => {
  console.log(`look-studio server listening on http://localhost:${port}`);
});
