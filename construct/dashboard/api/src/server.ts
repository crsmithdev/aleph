import { createApp } from './app.js';
import { config } from './config.js';

const app = await createApp();
await app.listen({ port: config.port, host: config.host });
