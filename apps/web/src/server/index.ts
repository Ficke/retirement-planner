import { serve } from '@hono/node-server';

import { app } from './app';

const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Web service listening on http://localhost:${info.port}`);
});

function shutdown(signal: string) {
  console.log(`Received ${signal}; shutting down`);
  server.close((error) => {
    if (error) {
      console.error('Failed to shut down cleanly:', error);
      process.exitCode = 1;
    }
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
