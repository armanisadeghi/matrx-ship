// Custom entrypoint for Docker production mode.
// Database migrations and seeding are handled by Next.js instrumentation hook
// (src/instrumentation.ts) which runs automatically on server start.
//
// This file simply starts the Next.js standalone server.

process.env.HOSTNAME = process.env.HOSTNAME || "0.0.0.0";
process.env.PORT = process.env.PORT || "3000";

require("./.next/standalone/server.js");
