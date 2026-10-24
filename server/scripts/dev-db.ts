/**
 * Starts the API against local persistent MongoDB that saves data across restarts.
 *
 * Honours MONGODB_URI from server/.env: if that MongoDB is already listening
 * (e.g. the system service on 27017), it is used as-is; otherwise a private
 * mongod is spawned on the port in the URI with data under server/data/db.
 */
import 'dotenv/config';
import { execSync, spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import mongoose from 'mongoose';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONGODB_URI = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27018/shiftline';
let activeMongoUri = MONGODB_URI;
let isLocalMongo = false;
let parsedHostname = '';

try {
  const parsedUri = new URL(MONGODB_URI);
  parsedHostname = parsedUri.hostname;
  isLocalMongo =
    parsedUri.protocol === 'mongodb:' &&
    (parsedUri.hostname === '127.0.0.1' || parsedUri.hostname === 'localhost');
} catch {
  isLocalMongo = true;
}

const dbDir = path.resolve(__dirname, '../data/db');

// Function to check if a port is accepting TCP connections
function isPortReady(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createConnection(port, '127.0.0.1');
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('error', () => { s.destroy(); resolve(false); });
  });
}

// Function to check if MongoDB is actually responding to queries
async function isMongoAlive(port: number, timeoutMs = 1200): Promise<boolean> {
  let conn: mongoose.Connection | null = null;
  try {
    conn = await mongoose.createConnection(`mongodb://127.0.0.1:${port}/admin`, {
      serverSelectionTimeoutMS: timeoutMs,
      connectTimeoutMS: timeoutMs,
    }).asPromise();
    if (conn.db) {
      await conn.db.admin().ping();
      return true;
    }
    return false;
  } catch {
    return false;
  } finally {
    if (conn) {
      try { await conn.close(); } catch {}
    }
  }
}

let mongodProc: ReturnType<typeof spawn> | null = null;

if (!isLocalMongo) {
  console.log(`Checking remote MongoDB cluster (${parsedHostname})...`);
  let remoteOk = false;
  try {
    const conn = await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 3000 });
    await conn.disconnect();
    remoteOk = true;
    console.log(`✓ Connected to remote MongoDB cluster (${parsedHostname}).`);
  } catch (err: any) {
    console.warn(`\n⚠️  Could not connect to MongoDB Atlas cluster (${parsedHostname}):`);
    console.warn(`   ${err?.message || 'Server selection timeout (IP address is not whitelisted).'}`);
    console.warn(`💡 To use Atlas: add your current IP address (or 0.0.0.0/0) in MongoDB Atlas Network Access.`);
    console.warn(`🔄 Automatically starting local persistent MongoDB fallback on port 27018...\n`);
  }

  if (!remoteOk) {
    activeMongoUri = 'mongodb://127.0.0.1:27018/shiftline';
    isLocalMongo = true;
  }
}

if (isLocalMongo) {
  const activeParsed = new URL(activeMongoUri);
  const mongoPort = Number(activeParsed.port || 27017);
  const alreadyUp = await isMongoAlive(mongoPort);

  if (alreadyUp) {
    console.log(`Using MongoDB already running on port ${mongoPort}.`);
  } else {
    // If something is occupying the port but not responding as MongoDB, free it
    if (await isPortReady(mongoPort)) {
      try {
        execSync(`fuser -k ${mongoPort}/tcp`, { stdio: 'ignore' });
        await new Promise((r) => setTimeout(r, 400));
      } catch {}
    }

    fs.mkdirSync(dbDir, { recursive: true });
    // Clean stale locks if no mongod process is running
    for (const lock of ['mongod.lock', 'WiredTiger.lock']) {
      const p = path.join(dbDir, lock);
      if (fs.existsSync(p)) {
        try { fs.unlinkSync(p); } catch {}
      }
    }
    console.log(`Starting native MongoDB server on port ${mongoPort} (data: ${dbDir})...`);
    mongodProc = spawn(process.env.MONGOD_BIN ?? '/usr/bin/mongod', [
      '--dbpath', dbDir,
      '--port', String(mongoPort),
      '--nounixsocket',
      '--bind_ip', '127.0.0.1',
      '--logpath', path.join(dbDir, 'mongod.log'),
    ], {
      stdio: 'ignore',
      detached: false,
    });
    // A missing or unrunnable mongod must not crash the script; the readiness
    // check below then falls back to MongoMemoryServer.
    mongodProc.on('error', (err) => {
      console.warn(`Could not start native mongod: ${err.message}`);
    });

    // Wait for MongoDB to actually become ready and respond
    let ready = false;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 250));
      if (await isMongoAlive(mongoPort, 600)) {
        ready = true;
        break;
      }
    }
    if (!ready) {
      console.warn(`Native mongod on port ${mongoPort} didn't respond. Falling back to MongoMemoryServer...`);
      const { MongoMemoryServer } = await import('mongodb-memory-server');
      const memMongo = await MongoMemoryServer.create({ instance: { port: mongoPort } });
      activeMongoUri = memMongo.getUri('shiftline');
    }
  }
}

const apiPort = Number(process.env.PORT ?? 4400);
if (await isPortReady(apiPort)) {
  try {
    execSync(`fuser -k ${apiPort}/tcp`, { stdio: 'ignore' });
    await new Promise((r) => setTimeout(r, 400));
  } catch {}
}

console.log('MongoDB is ready! Starting LineRoster API...');

const localTsx = path.resolve(__dirname, '../node_modules/.bin/tsx');
const tsxBin = fs.existsSync(localTsx) ? localTsx : path.resolve(__dirname, '../../node_modules/.bin/tsx');
const child = spawn(tsxBin, ['src/index.ts'], {
  stdio: 'inherit',
  cwd: path.resolve(__dirname, '..'),
  env: {
    ...process.env,
    PORT: process.env.PORT ?? '4400',
    MONGODB_URI: activeMongoUri,
    JWT_SECRET: process.env.JWT_SECRET ?? 'shiftline-super-secret-jwt-key-2026-persistent',
    ADMIN_EMAIL: process.env.ADMIN_EMAIL ?? 'supervisor@example.com',
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ?? 'supervisor1',
    CORS_ORIGINS: process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174,http://127.0.0.1:5211',
    AI_PUBLIC: process.env.AI_PUBLIC ?? 'true',
  },
});

let cleaningUp = false;
const cleanup = async () => {
  if (cleaningUp) return;
  cleaningUp = true;
  try { child.kill('SIGTERM'); } catch {}
  if (mongodProc && !mongodProc.killed) {
    try {
      mongodProc.kill('SIGTERM');
      await Promise.race([
        new Promise((resolve) => mongodProc?.on('exit', resolve)),
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ]);
    } catch {}
  }
  process.exit(0);
};

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
child.on('exit', async (code) => {
  if (mongodProc && !mongodProc.killed) {
    try {
      mongodProc.kill('SIGTERM');
      await Promise.race([
        new Promise((resolve) => mongodProc?.on('exit', resolve)),
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ]);
    } catch {}
  }
  process.exit(code ?? 0);
});
