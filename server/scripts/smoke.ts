/**
 * End-to-end smoke test against an in-memory MongoDB.
 * Run: npx tsx scripts/smoke.ts
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const mongo = await MongoMemoryServer.create();
const PORT = 4321;

const server = spawn('npx', ['tsx', 'src/index.ts'], {
  cwd: path.join(here, '..'),
  env: {
    ...process.env,
    PORT: String(PORT),
    MONGODB_URI: mongo.getUri('shiftline'),
    JWT_SECRET: 'smoke-test-secret',
    ADMIN_EMAIL: 'sup@example.com',
    ADMIN_PASSWORD: 'supervisor1',
    CORS_ORIGINS: 'http://localhost:5173',
    GROQ_API_KEY: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true,
});
server.stdout.on('data', (d) => process.stdout.write('[api] ' + d));
server.stderr.on('data', (d) => process.stderr.write('[api!] ' + d));

const base = `http://127.0.0.1:${PORT}`;
for (let i = 0; i < 40; i++) {
  try { if ((await fetch(base + '/health')).ok) break; } catch { /* not up yet */ }
  await new Promise((r) => setTimeout(r, 500));
}

let failures = 0;
const check = (name: string, ok: boolean, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failures++;
};

// ---- login -------------------------------------------------------------
const bad = await fetch(base + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'sup@example.com', password: 'wrong' }) });
check('wrong password rejected', bad.status === 401);

const login = await (await fetch(base + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'sup@example.com', password: 'supervisor1' }) })).json();
check('login returns token', typeof login.token === 'string' && login.user.role === 'supervisor');
const H = { 'content-type': 'application/json', authorization: `Bearer ${login.token}` };

const noAuth = await fetch(base + '/employees');
check('unauthenticated request rejected', noAuth.status === 401);

// ---- push the seed data as a backup -----------------------------------
// Build the backup shape from the web app's seed module.
const seed = await import('../../frontend/src/data/seed.ts');
const backup = {
  lines: seed.SEED_LINES, codes: seed.SEED_CODES, employees: seed.SEED_EMPLOYEES, leave: seed.SEED_LEAVE, rosters: [],
  settings: { theme: 'dark', activeLineId: 'line5', activeYear: 2026, activeMonth: 9, weekendDays: [5, 6], maxConsecutive: 6 },
};
const push = await (await fetch(base + '/sync', { method: 'POST', headers: H, body: JSON.stringify(backup) })).json();
check('sync push accepted', push.ok && push.employees === 22, JSON.stringify(push));

const pull = await (await fetch(base + '/sync', { headers: H })).json();
check('sync pull returns everything', pull.employees.length === 22 && pull.codes.length === seed.SEED_CODES.length && pull.settings.activeLineId === 'line5');

// ---- roster ------------------------------------------------------------
const sept = await (await fetch(base + '/rosters/line5/2026/9', { headers: H })).json();
check('September generated from rules', Object.keys(sept.roster.cells).length === 22);
check('headcount rows computed', sept.days.length === 30 && sept.days[0].total.M === 4);
check('validator finds the 25–26 Sept Night gap', sept.issues.filter((i: any) => i.rule === 'below-minimum').length === 2);
const fixture = JSON.parse(readFileSync(path.join(here, '../../frontend/src/domain/__tests__/september-2026.fixture.json'), 'utf8'));
const matches = Object.entries(fixture.grid).every(([id, codes]) => JSON.stringify(sept.roster.cells[id].map((c: any) => c.code)) === JSON.stringify(codes));
check('server roster matches the client\'s sheet cell-for-cell', matches);

// ---- edit a cell -------------------------------------------------------
const edited = await (await fetch(base + '/rosters/line5/2026/9/cell', { method: 'POST', headers: H, body: JSON.stringify({ employeeId: 'e02', dayIndex: 0, code: 'N' }) })).json();
check('cell edit applied and marked manual', edited.cells.e02[0].code === 'N' && edited.cells.e02[0].source === 'manual');
const again = await (await fetch(base + '/rosters/line5/2026/9', { headers: H })).json();
check('edit persisted across reload', again.roster.cells.e02[0].code === 'N');

// ---- generate keeps / drops overrides ---------------------------------
const kept = await (await fetch(base + '/rosters/line5/2026/9/generate', { method: 'POST', headers: H, body: JSON.stringify({ respectOverrides: true }) })).json();
check('generate keeps hand edits by default', kept.cells.e02[0].code === 'N');
const dropped = await (await fetch(base + '/rosters/line5/2026/9/generate', { method: 'POST', headers: H, body: JSON.stringify({ respectOverrides: false }) })).json();
check('generate can drop hand edits', dropped.cells.e02[0].code === 'M');

// ---- rotate -------------------------------------------------------------
const prev = await (await fetch(base + '/rosters/line5/2026/9/rotate?aggressiveness=1', { headers: H })).json();
check('rotation preview targets October', prev.target.month === 10 && Object.keys(prev.result.assignments).length === 22);
check('rotation moves long-term night staff off nights', ['e10', 'e11', 'e12', 'e13'].every((id) => prev.result.assignments[id] !== 'N'));
const applied = await (await fetch(base + '/rosters/line5/2026/9/rotate', { method: 'POST', headers: H, body: JSON.stringify({ aggressiveness: 1 }) })).json();
const oct = await (await fetch(base + '/rosters/line5/2026/10', { headers: H })).json();
check('October built from the applied rotation', applied.target.month === 10 && oct.roster.cells.e10[0].code === prev.result.assignments.e10);

// ---- AI without key ----------------------------------------------------
const ai = await fetch(base + '/ai/ask', { method: 'POST', headers: H, body: JSON.stringify({ lineId: 'line5', year: 2026, month: 9, question: 'who is short?' }) });
const aiBody = await ai.json();
check('AI without GROQ_API_KEY fails clearly', ai.status === 502 && /GROQ_API_KEY/.test(aiBody.error));

// ---- audit --------------------------------------------------------------
const log = await (await fetch(base + '/audit', { headers: H })).json();
check('audit log records the edits', log.some((r: any) => r.action === 'roster.cell' && r.by === 'sup@example.com'), `${log.length} entries`);

// ---- viewer role --------------------------------------------------------
await fetch(base + '/auth/users', { method: 'POST', headers: H, body: JSON.stringify({ email: 'view@example.com', password: 'viewer123', role: 'viewer' }) });
const v = await (await fetch(base + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'view@example.com', password: 'viewer123' }) })).json();
const vEdit = await fetch(base + '/rosters/line5/2026/9/cell', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${v.token}` }, body: JSON.stringify({ employeeId: 'e02', dayIndex: 1, code: 'N' }) });
const vRead = await fetch(base + '/rosters/line5/2026/9', { headers: { authorization: `Bearer ${v.token}` } });
check('viewer can read but not edit', vRead.ok && vEdit.status === 403);

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
try { process.kill(-server.pid!, 'SIGTERM'); } catch { server.kill(); }
await mongo.stop();
process.exit(failures ? 1 : 0);
