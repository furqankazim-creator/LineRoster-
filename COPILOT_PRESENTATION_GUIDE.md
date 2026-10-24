# Presenting LineRoster with Microsoft Copilot & GitHub Copilot

> **Enterprise Compliance Note:**  
> This guide is specially designed for corporate client environments where external AI tools (such as Claude Code, ChatGPT, Cursor, etc.) are restricted by IT security policy, and **Microsoft Copilot** and **GitHub Copilot** are the only approved AI assistants.

---

## 1. Executive Summary: Is it possible to open LineRoster from Copilot?

### The Question:
> *"When we go to present the software, can we go to Copilot and open LineRoster directly? Is this possible?"*

### The Direct Answer:
- **From Microsoft Copilot Web Chat (shown in the screenshot):**  
  **No, web chat cannot directly execute commands on your local PC.** Microsoft Copilot's web chat (`copilot.microsoft.com` or desktop app) runs in an isolated cloud environment and does not have access to your laptop's local terminal to run local servers or launch local ports (`localhost:5173`).
- **HOWEVER, YES — using the two approved corporate workflows below, you can seamlessly open, control, and present LineRoster with Copilot:**

| Method | Best For | How It Works |
|---|---|---|
| **Method A: GitHub Copilot in VS Code** | Technical Demo / Code Review | Open the project in VS Code, ask Copilot Chat `@workspace Start LineRoster`, and Copilot executes `npm run dev` and opens the browser. |
| **Method B: Microsoft Edge + Copilot Side Panel** | Executive / Business Presentation | Launch the app with the **1-Click Launcher** (`start-app.bat` or `start-app.command`), and present LineRoster in Microsoft Edge with Copilot open in the side panel. |
| **Method C: Copilot File & Roster Analysis** | Management & Analytics Demo | Export the roster to Excel (`.xlsx`) from LineRoster, drag-and-drop it into Microsoft Copilot (the screenshot chat UI), and let Copilot analyze shift balance and compliance! |

---

## 2. Method A: Open & Run via GitHub Copilot (VS Code)

In enterprise IT environments, **GitHub Copilot in VS Code** is the standard Microsoft-approved coding assistant. We have configured repository-level instructions (`.github/copilot-instructions.md`) and VS Code tasks (`.vscode/tasks.json`).

### Step-by-Step Walkthrough:
1. Open the project folder (`shiftline`) in **VS Code**.
2. Open **GitHub Copilot Chat** (`Ctrl+Shift+I` on Windows / `Cmd+Shift+I` on Mac).
3. Type any of these prompts into Copilot Chat:
   - `@workspace How do I start LineRoster?`
   - `@workspace Run the web app`
   - `@workspace Start the dev server`
4. GitHub Copilot will read `.github/copilot-instructions.md` and immediately:
   - Provide the exact command `npm run dev` with a 1-click **"Run in Terminal"** button.
   - Or trigger the integrated task **"Start LineRoster (Open Web App)"**.
5. The local server starts and automatically launches `http://localhost:5173` in your default browser!

### Questions you can ask GitHub Copilot during the demo:
- `@workspace Explain how the 5-priority roster generation cascade works.`
- `@workspace How are Line 4 and Line 6 grouped together for work orders?`
- `@workspace Run all test suites to verify roster fidelity against the September sheet.`

---

## 3. Method B: 1-Click Launch + Microsoft Edge Copilot (Executive Presentation)

For non-technical presentations (stakeholders, operations managers, shift supervisors), they should not have to type terminal commands.

### Step-by-Step Walkthrough:
1. **1-Click Launch**:
   - On **Windows**: Double-click `start-app.bat`
   - On **macOS**: Double-click `start-app.command`
   *(This starts the Vite server and automatically opens the browser at `http://localhost:5173`)*.
2. **Open Microsoft Copilot in Microsoft Edge**:
   - In Microsoft Edge, click the **Copilot button** (top-right corner) to open the Copilot side panel right next to LineRoster.
3. **Presenting Side-by-Side**:
   - The LineRoster Roster Planner is active on the left side of the screen.
   - Microsoft Copilot is open on the right side of the screen.
   - You can show the client how Copilot in Edge can read the active page, explain staffing deficits, and assist supervisors in real-time.

---

## 4. Method C: Using Microsoft Copilot Web Chat for Roster Analysis

If the client wants to use the **Microsoft Copilot Chat UI** shown in your screenshot (`copilot.microsoft.com`):

### How to showcase it to the client:
1. In LineRoster, click **Export Excel** (downloads the branded `Line N_MMM-YYYY Roster.xlsx` spreadsheet).
2. Go to **Microsoft Copilot** (the chat window shown in your screenshot).
3. Click the **+** (Attach) button in the prompt box and attach the exported `.xlsx` roster file.
4. Prompt Copilot:
   > *"Analyze this LineRoster workforce roster. Summarize the shift distribution between Morning, Evening, and Night, and highlight if any employee worked more night shifts than others."*
5. Microsoft Copilot will process the spreadsheet, calculate totals, and present an executive summary to your client!

---

## 5. Client Presentation Script (Sample 5-Minute Demo)

Follow this structured script during your meeting:

1. **Minute 1: The Problem & The Solution**
   - *"Today, supervisors spend hours manually filling out 600+ cells every month in Excel, risking unfair night-shift allocations and under-staffed work orders."*
   - *"LineRoster automates this with fair auto-rotation, live headcount validation, and instant Excel import/export."*
2. **Minute 2: Launching the App in the Client Environment**
   - Double-click `start-app.bat` (or use GitHub Copilot `@workspace Run`).
   - The browser opens instantly with the September Line 5 roster ready.
3. **Minute 3: Demonstrating the Planner & Live Engine**
   - Show how painting a shift or adding leave immediately recalculates daily minimum headcounts.
   - Demonstrate **Auto-rotate** and the **Fairness tab** (showing night shift spread across the team).
4. **Minute 4: Work Orders ↔ Planner Synchronization**
   - Navigate to the **Work Orders** page.
   - Show how demand from the 11-column Excel file matches against available Planner staff.
   - Show how an understaffed shift flags an alert and how fixing it on the Planner removes the deficit live.
5. **Minute 5: Enterprise Copilot Synergy**
   - Show how the project integrates with GitHub Copilot via `.github/copilot-instructions.md`.
   - Export the Excel sheet and analyze it in Microsoft Copilot to prove enterprise readiness and compliance.

