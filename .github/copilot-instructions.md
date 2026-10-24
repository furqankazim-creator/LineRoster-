# GitHub Copilot Custom Instructions for RailOPS

## Project Identity & Purpose
**RailOPS** is a high-performance, local-first workforce roster and shift planning system designed for multi-shift industrial and rail operations (5-on / 2-off shift cycles, Morning/Evening/Night rotations, and work order crew allocations).

- **Core Web Application**: Built with React 18, TypeScript, Vite, Tailwind CSS, Framer Motion, and Dexie (IndexedDB). Fully local-first: data is stored in the browser's IndexedDB without requiring external cloud databases or logins.
- **Enterprise & Copilot Compliant**: Designed to operate cleanly within strict corporate environments where Microsoft Copilot and GitHub Copilot are the sole permitted AI assistants.

---

## How to Run & Present RailOPS

When the user asks how to run, launch, or present RailOPS, always provide these commands:

1. **Development Server (Auto-opens in default browser)**:
   ```bash
   npm run dev
   ```
   - Runs Vite dev server at `http://localhost:5173`.
   - `vite.config.ts` has `server.open: true`, so it opens the browser immediately.

2. **Automated Test Suite**:
   ```bash
   npm test
   ```
   - Runs 150+ Vitest unit and regression tests, verifying the scheduling generator, fairness calculations, and cell-by-cell Excel fidelity.

3. **Production Build**:
   ```bash
   npm run build
   ```
   - Compiles TypeScript and creates a production-ready static bundle in `dist/`.

4. **1-Click Launchers for Non-Technical Users & Presentations**:
   - macOS: Double-click `start-app.command`
   - Windows: Double-click `start-app.bat`

---

## Domain Architecture & Core Logic

When answering questions about the scheduling engine or work order calculations, follow the exact system architecture:

### 1. Month Generation Rule Cascade (`frontend/src/domain/generator.ts`)
For any given person and day, the shift code is determined by the **first matching rule** in this strict priority:
1. **Hand Edit**: Manual override painted on that cell (preserved separately so regenerations never destroy overrides).
2. **Leave Block**: Active leave/status covering that date (`LV`, training, etc.).
3. **Rest Days**: The person's assigned 2-day rest pair (e.g. Sat/Sun, Fri/Sat) produces a day off (`-`).
4. **Rotation Rule**: Mid-month rotation date range override.
5. **Default Shift**: The employee's baseline shift (`M` Morning, `E` Evening, `N` Night).

### 2. Standard Shift Codes
- `M`: Morning shift (default minimum headcount: 2)
- `E`: Evening shift (default minimum headcount: 2)
- `N`: Night shift (default minimum headcount: 3)
- `GS`: General shift (daytime administrative/support)
- `P`: Project shift
- `-`: Rest day / scheduled day off
- `LV`: Leave status (vacation/medical)
- `FLRT`: First Line Response Team

### 3. Work Orders ↔ Planner Integration (`frontend/src/domain/workloadLive.ts`)
- **Demand Calculation**: Work order demand is driven by line standards (`Setup → Resource Standards`) or manual row overrides.
- **Pool Grouping**: Line 5 has its own dedicated roster team. Line 4 and Line 6 operate as one unified shared pool.
- **Coverage Status**:
  - `OK`: Fully staffed.
  - `SHORT`: Partial staff assigned, fewer than required.
  - `UNASSIGNED`: No eligible staff free on that shift.
  - `NO_ROSTER`: Line has no active roster configured.
  - `UNPLACED`: Invalid date or line code in imported file.
- **Buffer Formula**: `Available on Shift − Required Demand`. If buffer < 0, a Staff Deficit warning is flagged.

---

## Copilot Presentation & Demonstration Tips

When helping the user present this software to stakeholders or managers:
1. **In VS Code (GitHub Copilot)**:
   - Guide the presenter to use `@workspace Start RailOPS` or run task `Start RailOPS (Open Web App)`.
   - Copilot can explain any function or test directly to the client during a live code review.
2. **In Microsoft Edge / Browser (Microsoft Copilot)**:
   - The presenter can keep Microsoft Copilot open in Edge's side panel alongside `http://localhost:5173`.
   - Copilot in Edge can read the live web page, summarize headcount balances, and explain roster rules.
3. **Excel Import/Export Verification**:
   - The user can export the roster via **Export Excel** and upload it directly into Microsoft Copilot Chat to demonstrate enterprise data analysis.

