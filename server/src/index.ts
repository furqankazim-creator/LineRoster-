import cors from 'cors';
import express from 'express';
import mongoose from 'mongoose';

import { seedAdmin } from './auth.ts';
import { config } from './config.ts';
import { aiRouter } from './routes/ai.ts';
import { auditRouter } from './routes/audit.ts';
import { authRouter } from './routes/auth.ts';
import { collabRouter, seedCollabInMongo } from './routes/collab.ts';
import { codesRouter, employeesRouter, leaveRouter, linesRouter, settingsRouter } from './routes/data.ts';
import { rostersRouter } from './routes/rosters.ts';
import { seedMongoIfEmpty, syncRouter } from './routes/sync.ts';

const app = express();
app.use(cors({ origin: config.corsOrigins }));
app.use(express.json({ limit: '10mb' }));

app.get('/health', (_req, res) => res.json({ ok: true, ai: Boolean(config.groqApiKey), aiPublic: config.aiPublic }));

app.use('/api/collab', collabRouter);
app.use('/auth', authRouter);
app.use('/lines', linesRouter);
app.use('/codes', codesRouter);
app.use('/employees', employeesRouter);
app.use('/leave', leaveRouter);
app.use('/settings', settingsRouter);
app.use('/rosters', rostersRouter);
app.use('/sync', syncRouter);
app.use('/audit', auditRouter);
app.use('/ai', aiRouter);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

async function main() {
  let connected = false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 4000 });
      connected = true;
      break;
    } catch (err: any) {
      if (attempt < 3 && (config.mongoUri.includes('127.0.0.1') || config.mongoUri.includes('localhost'))) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      if (!config.mongoUri.includes('127.0.0.1') && !config.mongoUri.includes('localhost')) {
        console.warn(`\n⚠️  Could not connect to remote MongoDB cluster: ${err?.message}`);
        console.warn('🔄 Falling back to local persistent MongoDB at mongodb://127.0.0.1:27018/shiftline...\n');
        await mongoose.connect('mongodb://127.0.0.1:27018/shiftline');
        connected = true;
        break;
      } else {
        throw err;
      }
    }
  }
  console.log('MongoDB connected');
  await seedAdmin();
  await seedCollabInMongo();
  await seedMongoIfEmpty();
  const server = app.listen(config.port, '0.0.0.0', () => console.log(`LineRoster API on http://localhost:${config.port}`));
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `\nPort ${config.port} is already used by another program on this machine.\n` +
        `  Start with a different port, e.g.  PORT=${config.port + 1} npm run dev\n` +
        `  and set VITE_API_URL=http://localhost:${config.port + 1} for the web app (.env.development).\n`,
      );
      process.exit(1);
    }
    throw err;
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
