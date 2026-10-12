# ShiftLine

**Workforce Roster Planning & Work Order Staffing for Multi-Shift Operations.**

ShiftLine is a high-performance shift-roster planning and resource-allocation tool designed for multi-shift industrial and rail operations. Enter each team member's default shift, rest-day pair, rotation rules, and leave — the entire month calculates automatically with live headcounts, coverage warnings, fair auto-rotation, and work-order demand matching. It imports and exports the organization's existing `Line N_MMM-YYYY Roster` Excel layout.

- **Local-First Architecture:** Everything runs in the browser (IndexedDB). No external database or login required for the core app.
- **Enterprise & Copilot Compliant:** Fully configured for corporate environments where **Microsoft Copilot** and **GitHub Copilot** are the mandated AI tools. Zero reliance on disallowed third-party AI coding tools (Claude Code, ChatGPT, etc.).

---

## Quick Start (Run & Present)

### Option 1: 1-Click Presentation Launchers (No terminal required)
For managers, supervisors, and presentation meetings:
- **Windows:** Double-click [`start-app.bat`](file:///Users/imac/Desktop/Roster%20Management/shiftline/start-app.bat)
- **macOS:** Double-click [`start-app.command`](file:///Users/imac/Desktop/Roster%20Management/shiftline/start-app.command)

*This automatically starts the server and opens `http://localhost:5173` in your default browser.*

---

### Option 2: Running with GitHub Copilot (VS Code)
If presenting or reviewing code inside **VS Code** with the **GitHub Copilot** extension:

1. Open the `shiftline` project folder in VS Code.
2. In **GitHub Copilot Chat** (`Ctrl+Shift+I` on Windows / `Cmd+Shift+I` on Mac), ask Copilot:
   > `@workspace How do I start ShiftLine?`  
   > *or*  
   > `@workspace Run the web app`
3. GitHub Copilot will read the repository's [`.github/copilot-instructions.md`](file:///Users/imac/Desktop/Roster%20Management/shiftline/.github/copilot-instructions.md) and offer a 1-click button to run the task or execute:
   ```bash
   npm run dev
   ```
4. The web app opens automatically at `http://localhost:5173`.

---

### Option 3: Standard Terminal Commands

```bash
npm install          # Install dependencies
npm run dev          # Starts dev server & opens http://localhost:5173
npm test             # Runs 150 automated tests (including September 2026 sheet fidelity)
npm run build        # Compiles production bundle into dist/
```

---

## Using & Presenting with Copilot: Client FAQ

### Q: Can we open and present the software directly through Copilot?
**Direct Answer:**
1. **From Microsoft Copilot Web Chat (`copilot.microsoft.com`):**  
   Web chat in a browser cannot directly run OS terminal commands on your local computer to spin up a local server.
2. **From GitHub Copilot in VS Code:**  
   **YES!** You can prompt GitHub Copilot `@workspace Start ShiftLine`, and it will trigger the dev server task and open the browser.
3. **Presenting in Microsoft Edge with Copilot:**  
   **YES!** Double-click `start-app.bat`, and ShiftLine opens in Microsoft Edge. Open the **Copilot sidebar in Edge** side-by-side with ShiftLine. Copilot in Edge can read the live page, summarize shift headcounts, and assist supervisors during presentations.
4. **Data Analysis in Copilot:**  
   You can export the roster Excel file from ShiftLine and upload it directly into Microsoft Copilot Chat for automated management summaries.

👉 See the full guide: [**`COPILOT_PRESENTATION_GUIDE.md`**](file:///Users/imac/Desktop/Roster%20Management/shiftline/COPILOT_PRESENTATION_GUIDE.md)

---

## Copilot Demo Prompts (What to ask Copilot during a presentation)

### Questions to ask GitHub Copilot in VS Code:
- `@workspace How does the 5-priority rule cascade generate a month's roster?`
- `@workspace Explain how Line 4 and Line 6 share their staff pool for work orders.`
- `@workspace Run the test suite and verify cell-by-cell reproduction of the September sheet.`

### Questions to ask Microsoft Copilot in Microsoft Edge (with ShiftLine open):
- *"Summarize the staffing deficit visible on this ShiftLine roster page."*
- *"Explain the night shift fairness distribution shown in the Insights panel."*

---

## System Architecture

```
.github/
  copilot-instructions.md # Corporate GitHub Copilot repository intelligence
.vscode/
  tasks.json              # 1-click VS Code tasks for Copilot & dev server
  launch.json             # Edge launch configuration
src/
  domain/                 # Pure scheduling engine (generator, rotation, validation, workloadLive)
  data/                   # Dexie IndexedDB schema & seeded Line 5 September 2026 data
  io/                     # Excel import (.xlsx) and branded Excel export
  features/               # Planner grid, People, Setup, Insights, Work Orders, Assistant
  app/                    # App state store, persistence, shift color tokens
server/                   # Optional Node + Express + MongoDB sync API (see server/README.md)
docs/                     # Client user guide (docs/guide.html)
COPILOT_PRESENTATION_GUIDE.md # Client presentation playbook for Copilot environments
```

---

## How a Month is Built (Scheduling Logic)

For every person and calendar day, the shift is resolved by the **first matching rule**:

1. **Cell Hand Edit:** A manual cell override painted directly on the grid.
2. **Leave Block:** A scheduled leave/vacation or status covering the date (`LV`, `FLRT`, etc.).
3. **Rest Days:** One of the person's assigned 2-day rest weekdays $\rightarrow$ `-` (day off).
4. **Rotation Rule:** A defined rotation rule active across that date range.
5. **Default Shift:** The person's assigned default shift (`M`, `E`, `N`).

*Hand edits are stored separately from generated cells, ensuring regeneration never destroys supervisor overrides.*

---

## Shift Codes & Headcounts

- `M` — Morning (min headcount: 2)
- `E` — Evening (min headcount: 2)
- `N` — Night (min headcount: 3)
- `GS` — General Shift (administrative / support)
- `P` — Project Shift
- `-` — Rest Day / Day Off
- `LV` — Leave Status
- `FLRT` — First Line Response Team

Minimum headcount standards and shift codes are fully customizable under **Setup → Shift Codes**.

---

## Keyboard Shortcuts

- `M` `E` `N` `G` `P` — Paint selected shift onto active cell
- `-` — Paint day off
- Arrow Keys — Navigate grid
- `Ctrl+Z` / `Ctrl+Shift+Z` (`Cmd+Z` / `Cmd+Shift+Z`) — Undo / Redo
- `Esc` — Deselect active paint brush
- `Ctrl+/` — Toggle in-app assistant widget
