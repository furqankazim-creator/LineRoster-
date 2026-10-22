const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const UPLOADS_DIR = '/home/ababeel/.gemini/antigravity/brain/2c1ba33c-3d0f-4215-96a2-c524c9616822/.user_uploaded';

function getB64(filename) {
  const filePath = path.join(UPLOADS_DIR, filename);
  if (!fs.existsSync(filePath)) {
    console.error("Missing file:", filePath);
    return "";
  }
  return fs.readFileSync(filePath).toString('base64');
}

const IMGS = {
  headerBanner: getB64('media_1792494062047_6822eeaa.png'),
  plannerL5: getB64('media_1792495823052_c5aa8ffb.png'),
  plannerL46: getB64('media_1792495844832_a0ad1bb6.png'),
  woCapacityCards: getB64('media_1792495864837_a95e98f6.png'),
  woMonthlyPlan: getB64('media_1792493538882_4c4b3e2a.png'),
  woPageFull: getB64('media_1792492276103_6731fcca.png'),
  excelPicker: getB64('media_1792484153788_30dd1efe.png'),
  shiftRulesModal: getB64('media_1792485623175_2d504dff.png'),
  headcountColors: getB64('media_1792490377401_71174198.png'),
  headcountPlain: getB64('media_1792490354220_ca2b3988.png'),
  statusCards: getB64('media_1792491789435_41d20fea.png'),
  openWoBtn: getB64('media_1792492823436_822fb7ed.png'),
  riyadhBadge: getB64('media_1792492773121_a4616e35.png')
};

// XML Escape helper
function escapeXml(unsafe) {
  if (typeof unsafe !== 'string') return '';
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Helpers for FODT generation
function pageHeader(sectionNum, sectionTitle, pageNum, pageTitle, subtitle) {
  return `
    <text:p text:style-name="SectionTag">${escapeXml(sectionNum)} · ${escapeXml(sectionTitle.toUpperCase())}</text:p>
    <text:p text:style-name="PageTitle">${escapeXml(pageNum)} · ${escapeXml(pageTitle)}</text:p>
    <text:p text:style-name="PageSubtitle">${escapeXml(subtitle)}</text:p>
  `;
}

function paragraph(text, isBold = false) {
  return `<text:p text:style-name="${isBold ? 'BodyBold' : 'BodyText'}">${escapeXml(text)}</text:p>`;
}

function bullet(boldPrefix, text) {
  return `<text:p text:style-name="BulletText"><text:span text:style-name="TextBold">• ${escapeXml(boldPrefix)}: </text:span>${escapeXml(text)}</text:p>`;
}

function callout(title, text, type = 'info') {
  let styleName = 'CalloutBox';
  let titleStyle = 'CalloutTitle';
  if (type === 'warning') {
    styleName = 'CalloutBoxWarning';
    titleStyle = 'CalloutTitleWarning';
  } else if (type === 'success') {
    styleName = 'CalloutBoxSuccess';
    titleStyle = 'CalloutTitleSuccess';
  }
  return `
    <table:table table:name="Callout_${Math.random().toString(36).substring(7)}" table:style-name="${styleName}">
      <table:table-column table:style-name="ColFullWidth"/>
      <table:table-row>
        <table:table-cell table:style-name="${styleName}Cell">
          <text:p text:style-name="${titleStyle}">${escapeXml(title)}</text:p>
          <text:p text:style-name="CalloutText">${escapeXml(text)}</text:p>
        </table:table-cell>
      </table:table-row>
    </table:table>
  `;
}

function imageEmbed(b64, widthCm, heightCm, caption = '') {
  if (!b64) return '';
  const frameName = `Img_${Math.random().toString(36).substring(7)}`;
  let captionXml = '';
  if (caption) {
    captionXml = `<text:p text:style-name="ImageCaption">Figure: ${escapeXml(caption)}</text:p>`;
  }
  return `
    <text:p text:style-name="ImageContainer">
      <draw:frame draw:name="${frameName}" text:anchor-type="paragraph" svg:width="${widthCm}cm" svg:height="${heightCm}cm" draw:style-name="ImgFrameStyle">
        <draw:image>
          <office:binary-data>${b64}</office:binary-data>
        </draw:image>
      </draw:frame>
    </text:p>
    ${captionXml}
  `;
}

function makeTable(headers, rows, colWidths = []) {
  const tableName = `Table_${Math.random().toString(36).substring(7)}`;
  let colsXml = '';
  if (colWidths.length > 0) {
    colWidths.forEach((w, i) => {
      colsXml += `<table:table-column table:style-name="ColCustom_${w.replace('.', '_')}"/>`;
    });
  } else {
    headers.forEach(() => {
      colsXml += `<table:table-column/>`;
    });
  }

  let headXml = '<table:table-header-rows><table:table-row>';
  headers.forEach(h => {
    headXml += `<table:table-cell table:style-name="TableHeadCell"><text:p text:style-name="TableHeadText">${escapeXml(h)}</text:p></table:table-cell>`;
  });
  headXml += '</table:table-row></table:table-header-rows>';

  let bodyXml = '';
  rows.forEach((r, idx) => {
    const isAlt = idx % 2 === 1;
    const cellStyle = isAlt ? 'TableCellAlt' : 'TableCell';
    bodyXml += '<table:table-row>';
    r.forEach(cell => {
      bodyXml += `<table:table-cell table:style-name="${cellStyle}"><text:p text:style-name="TableCellText">${escapeXml(cell)}</text:p></table:table-cell>`;
    });
    bodyXml += '</table:table-row>';
  });

  return `
    <table:table table:name="${tableName}" table:style-name="CustomDataTable">
      ${colsXml}
      ${headXml}
      ${bodyXml}
    </table:table>
  `;
}

// -------------------------------------------------------------
// DEFINITION OF ALL 30 PAGES
// -------------------------------------------------------------
const pages = [];

// ==================== PAGE 1 ====================
pages.push(`
  <text:p text:style-name="CoverSuperTag">ALSTOM TRANSPORT · RIYADH METRO PROJECT</text:p>
  <text:p text:style-name="CoverTitle">ShiftLine System Operations &amp; Manpower Allocation Guide</text:p>
  <text:p text:style-name="CoverSubtitle">Dual Roster Architecture, Capacity Balancing &amp; Work Order Execution Manual</text:p>
  
  <text:p text:style-name="CoverSpacerSmall"/>
  ${imageEmbed(IMGS.headerBanner, 17.5, 0.85, 'Official Alstom SLV Header Banner & Digital Board Integration')}
  <text:p text:style-name="CoverSpacerSmall"/>

  <table:table table:name="CoverMetaTable" table:style-name="CoverMetaTableStyle">
    <table:table-column table:style-name="ColHalf"/>
    <table:table-column table:style-name="ColHalf"/>
    <table:table-row>
      <table:table-cell table:style-name="CoverMetaCell">
        <text:p text:style-name="CoverMetaLabel">TARGET INFRASTRUCTURE</text:p>
        <text:p text:style-name="CoverMetaVal">Riyadh Metro Lines 4, 5 &amp; 6 (SLV Maintenance)</text:p>
        <text:p text:style-name="CoverMetaLabel">TOTAL WORKFORCE MONITORED</text:p>
        <text:p text:style-name="CoverMetaVal">61 Technicians (22 Solo Pool L5 + 39 Combined L4/6)</text:p>
        <text:p text:style-name="CoverMetaLabel">WORK ORDERS ENGINE</text:p>
        <text:p text:style-name="CoverMetaVal">Maximo Monthly Planning Integration (316 Orders / 790 MP)</text:p>
      </table:table-cell>
      <table:table-cell table:style-name="CoverMetaCell">
        <text:p text:style-name="CoverMetaLabel">DOCUMENT VERSION &amp; STATUS</text:p>
        <text:p text:style-name="CoverMetaVal">Version 2.4 — Official Operational Baseline</text:p>
        <text:p text:style-name="CoverMetaLabel">PUBLICATION &amp; RELEASE DATE</text:p>
        <text:p text:style-name="CoverMetaVal">October 2026 (Planning Cycle 2026–2027)</text:p>
        <text:p text:style-name="CoverMetaLabel">SECURITY &amp; COMPLIANCE LEVEL</text:p>
        <text:p text:style-name="CoverMetaVal">Alstom Restricted · Railway Safety Critical</text:p>
      </table:table-cell>
    </table:table-row>
  </table:table>

  <text:p text:style-name="CoverSpacerSmall"/>
  ${callout('OPERATIONAL MANDATE', 'This comprehensive 30-page reference document provides maintenance directors, shift supervisors, lead engineers, and roster planners with the complete operational principles, visual guidelines, mathematical formulations, and daily execution workflows powering ShiftLine across the Riyadh SLV Metro maintenance network.', 'info')}
`);

// ==================== PAGE 2 ====================
pages.push(`
  ${pageHeader('SECTION I', 'Executive Overview & Mission', '02', 'Executive Summary & Operational Mission', 'Bridging 24/7 railway shift rosters with Maximo maintenance work order capacity')}
  
  ${paragraph('ShiftLine is Alstom\'s custom-engineered intelligent roster and manpower capacity management platform, purpose-built for the Riyadh Metro Service Leader Vehicles (SLV) Maintenance Division covering Line 4 (Orange), Line 5 (Yellow), and Line 6 (Purple).')}

  ${bullet('The Operational Challenge', 'Balancing 61 specialized railway technicians across continuous round-the-clock shift cycles while simultaneously executing 316+ monthly preventive work orders under strict track possession time windows.')}
  ${bullet('The Traditional Bottleneck', 'Legacy spreadsheet rosters operated in total isolation from work order backlogs, resulting in blind spot fatigue violations, severe night shift overloads, and last-minute track possession cancellations.')}
  ${bullet('The ShiftLine Solution', 'A unified, real-time dual-engine platform combining an automated shift generation matrix (Planner) with an interactive Work Order Manpower balancing dashboard.')}

  ${callout('CORE SYSTEM PRINCIPLE', 'Every maintenance work order requires qualified technician hours; every rostered technician represents finite operational capacity. ShiftLine calculates the exact net buffer in real time so supervisors never dispatch an under-crewed possession or violate fatigue rest limits.', 'success')}

  ${paragraph('Key Architectural Pillars of ShiftLine:', true)}
  ${bullet('Dual Pool Hierarchy', 'Maintains dedicated independence for Line 5 (22 technicians) while managing a unified cross-line Combined Pool for Lines 4 & 6 (39 technicians).')}
  ${bullet('Four Operational Shift Families', 'Continuous coverage through Morning (M), Evening (E), Night (N), and General (GS) shifts with built-in 1-hour overlap windows for thorough shift handovers.')}
  ${bullet('Smart Insights & Deficit Engine', 'Real-time validation flags staffing shortages, overtime breaches, and shift sequence violations before monthly publication.')}
`);

// ==================== PAGE 3 ====================
pages.push(`
  ${pageHeader('SECTION I', 'Document Structure & Navigation', '03', 'Table of Contents & Guide Navigation', 'Visual roadmap of the 30 chapters across four dedicated operational modules')}
  
  ${paragraph('This operational manual is organized into four core functional sections. Maintenance planners and supervisors should refer directly to the relevant chapters based on their operational phase:')}

  ${makeTable(
    ['Section', 'Chapter Range', 'Primary Functional Area', 'Key Stakeholders'],
    [
      ['Section I: Architecture & Foundations', 'Pages 01 – 05', 'Lines, Pools, Shift Families & Operating Rules', 'Maintenance Directors, Planners'],
      ['Section II: The Planner Module', 'Pages 06 – 16', '31-Day Roster Matrix, Auto-Generation & Insights', 'Shift Supervisors, Roster Clerks'],
      ['Section III: Work Orders & Manpower', 'Pages 17 – 28', 'Maximo Import, Shift Capacity & Deficit Analysis', 'Work Planners, Dispatch Engineers'],
      ['Section IV: Dispatch, Audit & Checklists', 'Pages 29 – 30', 'Crew Locking, ERP Export & Daily Audit Steps', 'Operations Lead, Safety Officers']
    ],
    ['4.0', '3.0', '6.0', '4.5']
  )}

  <text:p text:style-name="CoverSpacerSmall"/>
  ${paragraph('Detailed Chapter Navigation Matrix:', true)}
  ${bullet('Pages 04-05', 'Pool Architecture (Solo vs Combined) and 24/7 Railway Shift Timings & Overlaps.')}
  ${bullet('Pages 06-08', 'Planner User Interface, Matrix Anatomy, and Shift Palette Brush Mode.')}
  ${bullet('Pages 09-11', 'Staff Rules, Priority Hierarchy, Auto-Generation Engine, and Fatigue Compliance.')}
  ${bullet('Pages 12-14', 'Live Headcount Bar, Shortfall Error Detection (11 vs 38 errors), and One-Click Auto-Cover.')}
  ${bullet('Pages 15-16', 'Leave Types, Saudi Labour Law 48-Hour Thresholds, and Excel Multi-Sheet Import.')}
  ${bullet('Pages 17-21', 'Work Orders Overview, Yellow Columns Dictionary, Dashboard Metrics & Crew Intensity.')}
  ${bullet('Pages 22-25', 'Railway Shift Classification, Status Tracking, Capacity Cards & Severe Overload Analysis.')}
  ${bullet('Pages 26-28', 'Date Timeline Navigation, Cross-Line Sharing, and Multi-Column Filtering.')}
  ${bullet('Pages 29-30', 'Specialist Crew Locking, Handover Protocol, and Monthly Audit Compliance Checklists.')}
`);

// ==================== PAGE 4 ====================
pages.push(`
  ${pageHeader('SECTION I', 'Line & Pool Hierarchy', '04', 'Line & Pool Hierarchy: Combined vs Solo Pools', 'Organizational allocation of 61 maintenance technicians across Riyadh Metro')}
  
  ${paragraph('Riyadh Metro SLV Maintenance operates with two distinct organizational models to balance physical depot constraints with operational agility across Lines 4, 5, and 6:')}

  ${makeTable(
    ['Pool Structure', 'Covered Lines', 'Total Staff', 'Depot Location', 'Operating Model & Mobility'],
    [
      ['Line 5 Solo Pool', 'Line 5 (Yellow Line)', '22 Technicians', 'Depot 5 (Dedicated)', 'Strictly segregated technicians dedicated solely to Line 5 rolling stock and wayside assets.'],
      ['Lines 4 & 6 Combined Pool', 'Line 4 (Orange) & Line 6 (Purple)', '39 Technicians', 'Shared Depot 4/6', 'Unified multi-skilled crew pool dynamically allocated across Lines 4 and 6 based on possession workload.']
    ],
    ['4.0', '3.5', '2.5', '3.0', '4.5']
  )}

  <text:p text:style-name="CoverSpacerSmall"/>
  ${paragraph('Why Line 5 Operates as an Independent Solo Pool:', true)}
  ${bullet('Geographical Separation', 'Line 5 operates underground along King Abdulaziz Road with its own independent maintenance depot and specialized rolling stock configuration.')}
  ${bullet('Dedicated Fleet Focus', 'Prevents cross-contamination of shift hours and ensures dedicated technicians maintain deep familiarity with Line 5 wayside signalling.')}

  <text:p text:style-name="CoverSpacerSmall"/>
  ${paragraph('Why Lines 4 & 6 Operate as a Combined Pool:', true)}
  ${bullet('Shared Infrastructure Synergy', 'Lines 4 and 6 share common track junctions, rolling stock platforms, and a centralized maintenance facility.')}
  ${bullet('Dynamic Manpower Absorption', 'A surge in heavy track grinding on Line 4 can be absorbed by Line 6 technicians without requiring external contractors or overtime exhaustion.')}

  ${callout('POINTER IN SHIFTLINE UI', 'In the top toolbar of both Planner and Work Orders, planners can instantaneously toggle between "Line 5" and "Line 4 & 6". The active roster, headcount bars, and capacity cards immediately re-render to reflect the selected pool.', 'info')}
`);

// ==================== PAGE 5 ====================
pages.push(`
  ${pageHeader('SECTION I', 'Shift Timings & Overlaps', '05', 'Shift Timings & Railway Operational Families', '24-hour round-the-clock coverage with seamless 1-hour handover windows')}
  
  ${paragraph('Railway maintenance requires unbroken round-the-clock vigilance. ShiftLine structures all technician schedules into four standardized operational shift families:')}

  ${makeTable(
    ['Shift Code', 'Shift Name', 'Working Hours', 'Duration', 'Primary Maintenance Activities & Railway Focus'],
    [
      ['M', 'Morning Shift', '06:00 – 15:00', '9.0 hrs (incl 1h break)', 'Station DCS monitoring, passenger service support, first-response corrective maintenance.'],
      ['E', 'Evening Shift', '14:00 – 23:00', '9.0 hrs (incl 1h break)', 'Station facilities, lighting, platform doors, pre-possession tool staging and safety briefing.'],
      ['N', 'Night Shift', '22:00 – 07:00', '9.0 hrs (incl 1h break)', 'Mainline track possessions, power isolation, Cat-3/4 heavy preventive maintenance, signalling testing.'],
      ['GS', 'General Shift', '08:00 – 17:00', '9.0 hrs (incl 1h break)', 'Workshop overhaul, component repairs, logistics, quality audits, tool calibration.']
    ],
    ['2.0', '2.5', '2.5', '2.5', '8.0']
  )}

  <text:p text:style-name="CoverSpacerSmall"/>
  ${paragraph('The 1-Hour Handover Overlap Philosophy:', true)}
  ${bullet('Morning to Evening Overlap (14:00 – 15:00)', 'Outgoing morning technicians conduct physical tool audits and brief incoming evening crews on active faults occurring during morning peak passenger hours.')}
  ${bullet('Evening to Night Overlap (22:00 – 23:00)', 'Critical safety briefing window: Evening crews hand over track possession clearances, traction power isolation certificates, and track safety equipment to the incoming night possession crews.')}

  ${callout('SAFETY CRITICAL RULE', 'No technician scheduled on Night Shift (N: 22:00–07:00) may be scheduled on Morning Shift (M: 06:00–15:00) the following day. A mandatory minimum 24-hour rest window is enforced by the auto-generation engine.', 'warning')}
`);

// ==================== PAGE 6 ====================
pages.push(`
  ${pageHeader('SECTION II', 'Planner Module Overview', '06', 'Planner Interface & Command Toolbar', 'The nerve center for viewing, generating, and fine-tuning monthly rosters')}
  
  ${paragraph('The ShiftLine Planner interface provides an end-to-end command dashboard designed for rapid month-long roster visualization, rule compliance, and manual fine-tuning:')}

  ${imageEmbed(IMGS.plannerL5, 17.5, 7.8, 'ShiftLine Planner Grid: Line 5 (September 2026, 22 Staff, 11 Shortfall Warnings)')}

  ${paragraph('Core Components of the Planner Command Bar:', true)}
  ${bullet('Month & Year Picker', 'Effortlessly switch between active planning periods (e.g., September 2026, November 2026). State is persisted across browser refreshes.')}
  ${bullet('Pool Switcher Tabs', 'One-click toggle between Line 5 Solo Pool (22 staff) and Lines 4 & 6 Combined Pool (39 staff).')}
  ${bullet('Auto-Generate Roster Button', 'Executes the 5-tier intelligent scheduling engine to balance shifts against staff rules in under 1 second.')}
  ${bullet('Interactive Brush Toggle', 'Activates "Paint Brush" mode for ultra-rapid cell assignment without opening repetitive dialogs.')}
  ${bullet('Import Excel & Export Actions', 'Facilitates seamless two-way interoperability with legacy Alstom operational spreadsheets.')}
`);

// ==================== PAGE 7 ====================
pages.push(`
  ${pageHeader('SECTION II', 'Roster Grid Anatomy', '07', 'Roster Grid Anatomy & Technician Matrix', 'Structure of the 31-day technician scheduling matrix')}
  
  ${paragraph('The central grid organizes technicians along the vertical axis and days of the month along the horizontal axis, providing total situational awareness:')}

  ${imageEmbed(IMGS.plannerL46, 17.5, 7.8, 'ShiftLine Planner Grid: Lines 4 & 6 (September 2026, 39 Staff, 38 Shortfall Warnings)')}

  ${paragraph('Anatomy of Grid Columns and Elements:', true)}
  ${bullet('Staff Identification Header (Sticky Left)', 'Displays technician Full Name, unique Alstom Employee ID, designated Primary Trade (Signalling, Track, Telecom), and primary line assignment.')}
  ${bullet('Day Columns (1 to 28/30/31)', 'Each day column displays the day number and weekday abbreviation (e.g., "1 Tue", "4 Fri"). Weekend rest days (Friday/Saturday) are visually highlighted.')}
  ${bullet('Monthly Summary Totals (Sticky Right)', 'Live recalculation of Working Shifts (M+E+N+GS), Scheduled Rest Days (OFF), Approved Leaves (AL+SL), and Total Accumulated Working Hours.')}
  ${bullet('Interactive Shift Cell', 'Displays current shift code with color coding. Clicking a cell opens the shift selector or paints the active palette brush code.')}
`);

// ==================== PAGE 8 ====================
pages.push(`
  ${pageHeader('SECTION II', 'Shift Palette & Brush Mode', '08', 'Shift Code Palette & Interactive Brush Tool', 'Rapid single-click roster editing and visual shift coding standards')}
  
  ${paragraph('To minimize administrative overhead, ShiftLine introduces the "Interactive Shift Brush", allowing supervisors to paint shift assignments across days and technicians instantaneously:')}

  ${makeTable(
    ['Code', 'Visual Badge Color', 'Shift Description', 'Typical Duty Scope & Application'],
    [
      ['M', 'Emerald Green (#10b981)', 'Morning Shift (06:00–15:00)', 'Station maintenance, DCS, corrective peak passenger support.'],
      ['E', 'Royal Blue (#2563eb)', 'Evening Shift (14:00–23:00)', 'Platform screen doors, station facilities, pre-night prep.'],
      ['N', 'Indigo / Purple (#6366f1)', 'Night Shift (22:00–07:00)', 'Mainline track possessions, rail grinding, interlocking testing.'],
      ['GS', 'Amber / Orange (#f59e0b)', 'General Shift (08:00–17:00)', 'Workshop overhauls, engineering office, training, logistics.'],
      ['OFF', 'Neutral Slate (#64748b)', 'Scheduled Rest Day', 'Mandatory 48-hour weekly rest window (Fri/Sat or Wed/Thu).'],
      ['AL', 'Rose / Red (#f43f5e)', 'Annual Leave', 'Approved paid annual vacation entitlement.'],
      ['SL / TR', 'Purple / Cyan (#a855f7)', 'Sick Leave / Training', 'Certified medical absence or technical training academy.']
    ],
    ['1.8', '3.5', '4.2', '8.0']
  )}

  <text:p text:style-name="CoverSpacerSmall"/>
  ${paragraph('How Interactive Brush Mode Operates:', true)}
  ${bullet('Step 1: Select Shift Code', 'Click any code button in the top palette (e.g., click "N" for Night Shift). The button highlights with an active glowing outline.')}
  ${bullet('Step 2: Paint the Grid', 'Click across any cells in the roster grid. Each clicked cell immediately updates to the selected shift code without requiring confirmation.')}
  ${bullet('Step 3: Instant Recalculation', 'The bottom Headcount Bar, Insights Panel, and technician monthly totals recalculate in real time as each cell is painted.')}

  ${callout('PRO TIP', 'To quickly assign a block of rest days, select "OFF" on the brush palette and click across Friday and Saturday for the entire maintenance gang in seconds.', 'info')}
`);

// ==================== PAGE 9 ====================
pages.push(`
  ${pageHeader('SECTION II', 'Technician Rules & Rest Pairs', '09', 'Technician Rules, Defaults & Rest Day Pairs', 'Configuring base technician profiles and Saudi Labour Law rest day pairings')}
  
  ${paragraph('Every technician profile in ShiftLine contains operational parameters that govern how shifts and rest days are automatically generated:')}

  ${imageEmbed(IMGS.shiftRulesModal, 9.5, 8.5, 'Staff Operational Rules & Shift Timings Configuration Dialog')}

  ${paragraph('Mandatory Rest Day Pairing Configurations:', true)}
  ${bullet('Pair A: Friday & Saturday (Standard Weekend Gang)', 'Assigned to 60% of the maintenance workforce to align with regional weekend customs and depot support schedules.')}
  ${bullet('Pair B: Wednesday & Thursday (Mid-Week Maintenance Gang)', 'Ensures robust technician coverage on weekends when passenger train service is intense.')}
  ${bullet('Pair C: Sunday & Monday (Depot Overhaul Gang)', 'Dedicated workshop technicians handling preventative component overhauls.')}

  ${callout('LABOUR REGULATION COMPLIANCE', 'Saudi Labour Law Article 98 requires two consecutive rest days (48 hours) for every five consecutive working days. ShiftLine enforces rest days strictly in pairs and alerts planners if single disjointed rest days are assigned.', 'warning')}
`);

// ==================== PAGE 10 ====================
pages.push(`
  ${pageHeader('SECTION II', 'Auto-Generation Priority Engine', '10', 'The Auto-Generation Engine & 5-Tier Priority Rules', 'Algorithmic hierarchy governing automatic monthly roster generation')}
  
  ${paragraph('When a planner clicks "Auto-Generate Roster", ShiftLine runs a deterministic 5-tier constraint solver to populate the 31-day grid without human error:')}

  ${makeTable(
    ['Priority Tier', 'Rule Type', 'Precedence Behavior', 'Can Be Overwritten?'],
    [
      ['Tier 1 (Highest)', 'Manual Overrides & Locked Cells', 'Any shift cell specifically painted or locked by the supervisor is permanently preserved.', 'NO — Absolute Precedence'],
      ['Tier 2', 'Approved Leaves (AL, SL, TR)', 'Technicians on approved leave are scheduled on leave code; no work shifts can be injected.', 'NO — Protected Status'],
      ['Tier 3', 'Mandatory Rest Day Pairs', 'Rest day pairs (e.g. Fri/Sat) are assigned according to the employee profile to ensure 48h rest.', 'Only by Tier 1 Overrides'],
      ['Tier 4', 'Forward Cyclic Rotation', 'Populates working days in cyclic sequence (M → E → N) while checking minimum headcount needs.', 'Yes — Adjusted for Coverage'],
      ['Tier 5 (Fallback)', 'Default Shift Profile', 'Fills any remaining unassigned working days with the technician\'s baseline contract shift.', 'Default Baseline']
    ],
    ['3.0', '3.5', '8.0', '3.0']
  )}

  <text:p text:style-name="CoverSpacerSmall"/>
  ${paragraph('Step-by-Step Generation Execution Flow:', true)}
  ${bullet('Phase 1: Lockdown & Leave Staging', 'The engine preserves all locked shifts and paints approved annual leave dates across the 31-day horizon.')}
  ${bullet('Phase 2: Rest Day Anchoring', 'The technician\'s assigned rest day pair is repeated across all 4 weeks of the month.')}
  ${bullet('Phase 3: Shift Allocation & Balancing', 'Working days are populated, continuously balancing the daily headcount bar against minimum required staffing.')}
  ${bullet('Phase 4: Sanity & Conflict Pass', 'The completed grid is audited for fatigue violations (e.g., Night shift immediately followed by Morning shift).')}
`);

// ==================== PAGE 11 ====================
pages.push(`
  ${pageHeader('SECTION II', 'Rotation & Fatigue Compliance', '11', 'Auto-Rotation & Fatigue Management', 'Biomedical circadian rhythm protection and railway fatigue limits')}
  
  ${paragraph('Railway maintenance is safety-critical. A fatigued technician operating an overhead catenary vehicle or testing an interlocking switch presents unacceptable risks. ShiftLine enforces strict circadian safety logic:')}

  ${bullet('Forward-Rotating Shift Sequences', 'Shift sequences must always rotate forward in time: Morning (06:00) → Evening (14:00) → Night (22:00) → Rest Days (OFF). Forward rotation follows human circadian biology.')}
  ${bullet('Strict Prohibition of Backward Rotation', 'The dangerous sequence of Night Shift (ends at 07:00) into Morning Shift (starts at 06:00 next day) is prohibited because it provides only 23 hours of elapsed time between shifts.')}
  ${bullet('Night Shift Ceiling (Maximum 4 Consecutive Nights)', 'Technicians may not be scheduled for more than 4 consecutive night shifts. On the 5th day, the engine forces a mandatory 48-hour rest block.')}
  ${bullet('Equitable Weekend Distribution', 'Over a 90-day rolling cycle, the auto-balancer ensures all technicians rotate equitably through weekend shifts rather than burdening the same junior technicians.')}

  ${callout('FATIGUE AUDIT LOG', 'If a supervisor manually forces a backward rotation (e.g., painting "M" directly following "N"), ShiftLine accepts the override but immediately displays a bright red fatigue violation badge in the Insights Panel.', 'warning')}

  <text:p text:style-name="CoverSpacerSmall"/>
  ${paragraph('Recommended Circadian 28-Day Shift Cycle Pattern:', true)}
  ${makeTable(
    ['Week', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
    [
      ['Week 1', 'Morning (M)', 'Morning (M)', 'Morning (M)', 'Morning (M)', 'REST (OFF)', 'REST (OFF)', 'Morning (M)'],
      ['Week 2', 'Evening (E)', 'Evening (E)', 'Evening (E)', 'Evening (E)', 'REST (OFF)', 'REST (OFF)', 'Evening (E)'],
      ['Week 3', 'Night (N)', 'Night (N)', 'Night (N)', 'Night (N)', 'REST (OFF)', 'REST (OFF)', 'Night (N)'],
      ['Week 4', 'General (GS)', 'General (GS)', 'General (GS)', 'General (GS)', 'REST (OFF)', 'REST (OFF)', 'General (GS)']
    ],
    ['2.5', '2.1', '2.1', '2.1', '2.1', '2.3', '2.3', '2.1']
  )}
`);

// ==================== PAGE 12 ====================
pages.push(`
  ${pageHeader('SECTION II', 'Live Headcount Bar', '12', 'Live Headcount Bar & Minimum Thresholds', 'Real-time daily staffing metrics and minimum threshold monitoring')}
  
  ${paragraph('Positioned directly beneath the 31-day roster grid is the Live Headcount Bar, continuously recalculating available staffing for every single day and shift:')}

  ${imageEmbed(IMGS.headcountColors, 17.5, 3.2, 'Live Headcount Bar showing Morning, Evening, and Night totals per day')}

  ${paragraph('Minimum Shift Headcount Requirements by Pool:', true)}
  ${makeTable(
    ['Operational Shift', 'Line 5 Solo Pool (22 Staff)', 'Lines 4 & 6 Combined Pool (39 Staff)', 'Operational Failure Consequence'],
    [
      ['Morning (M)', 'Minimum 4 Technicians', 'Minimum 7 Technicians', 'Inability to staff station first-response teams during peak passenger hours.'],
      ['Evening (E)', 'Minimum 3 Technicians', 'Minimum 6 Technicians', 'Delays in staging tools and issuing track possession safety certificates.'],
      ['Night (N)', 'Minimum 5 Technicians', 'Minimum 10 Technicians', 'Mandatory cancellation of mainline track possessions due to insufficient track safety gang.']
    ],
    ['3.5', '4.5', '5.0', '4.5']
  )}

  <text:p text:style-name="CoverSpacerSmall"/>
  ${paragraph('Visual Status Color Codes:', true)}
  ${bullet('Green Badge (Optimal)', 'Assigned staffing equals or exceeds the required threshold with adequate safety margin.')}
  ${bullet('Yellow Badge (Tight)', 'Staffing exactly matches the minimum threshold. Any unexpected sick call will trigger a shortfall.')}
  ${bullet('Red Badge (Shortfall Alert)', 'Staffing is below the required threshold. Triggers an entry in the Insights Panel.')}
`);

// ==================== PAGE 13 ====================
pages.push(`
  ${pageHeader('SECTION II', 'Insights Panel & Shortfalls', '13', 'Insights Panel & Shortfall Detection Engine', 'Instant identification of staffing deficits across 31 calendar days')}
  
  ${paragraph('The Insights Panel provides maintenance planners with an automated discrepancy report, listing every instance where assigned staffing fails to meet operational thresholds:')}

  ${bullet('Real-World Case Study: Line 5 Solo Pool (September 2026)', 'The Insights Panel flagged exactly 11 shortfall errors in Line 5. Most occurred on Thursday nights where leave clustering reduced available night staff from the required 5 down to 3.')}
  ${bullet('Real-World Case Study: Lines 4 & 6 Combined Pool (September 2026)', 'The Insights Panel flagged 38 shortfall errors across Lines 4 & 6 due to 7 technicians being simultaneously scheduled for Annual Leave during school holidays.')}

  ${callout('INSIGHT ITEM BREAKDOWN', 'Each error entry in the Insights Panel explicitly details: [Date] + [Shift Type] + [Assigned vs Required Headcount] + [Deficit Count]. Clicking any error entry automatically scrolls the grid directly to that day and shift.', 'info')}

  <text:p text:style-name="CoverSpacerSmall"/>
  ${paragraph('Typical Causes of Operational Shortfalls:', true)}
  ${bullet('Leave Clustering', 'Multiple technicians in the same trade (e.g., three Interlocking Specialists) taking annual leave simultaneously.')}
  ${bullet('Rest Day Congestion', 'Over-allocating staff to Friday/Saturday rest pairs, leaving mid-week night shifts vulnerable.')}
  ${bullet('Unbalanced Rotation Transitions', 'Technicians transitioning from Night to Rest leaving a 24-hour vacuum in coverage.')}
`);

// ==================== PAGE 14 ====================
pages.push(`
  ${pageHeader('SECTION II', 'One-Click Shortfall Resolution', '14', 'One-Click Shortfall Resolution Engine', 'Intelligent automated candidate suggestion to eliminate roster deficits')}
  
  ${paragraph('Rather than forcing supervisors to manually scan 61 rows to find available technicians, ShiftLine features a smart candidate suggestion engine accessible directly from the Insights Panel:')}

  ${paragraph('How the "Show Who Can Cover" Algorithm Works:', true)}
  ${bullet('Criterion 1: Availability Check', 'The algorithm scans all technicians who are currently scheduled on "OFF" (Rest Day) or "GS" (General Shift) on the shortfall date.')}
  ${bullet('Criterion 2: Fatigue & Rest Interval Validation', 'It verifies that assigning the shift will not violate the mandatory 11-hour rest interval before their next shift or create a backward rotation.')}
  ${bullet('Criterion 3: Trade & Skill Matching', 'It prioritizes technicians holding the exact trade certification required by the short-staffed shift (e.g. Signalling vs Track).')}
  ${bullet('Criterion 4: Overtime Balancing', 'It ranks eligible candidates by lowest accumulated overtime hours during the month to ensure fair overtime distribution.')}

  ${callout('ONE-CLICK ACTION', 'Clicking "Assign & Resolve" beside any suggested candidate immediately updates the roster cell, converts their schedule to Extra Duty, removes the error from the Insights Panel, and turns the headcount badge green.', 'success')}

  <text:p text:style-name="CoverSpacerSmall"/>
  ${paragraph('Resolution Action Matrix:', true)}
  ${makeTable(
    ['Original Status', 'Target Shift', 'Resolution Action', 'Compensation Impact'],
    [
      ['OFF (Rest Day)', 'Night Shift (N)', 'Candidate called in for Night Duty', 'Extra Duty (Overtime at 1.5x hourly rate)'],
      ['GS (08:00–17:00)', 'Evening Shift (E)', 'Shift rescheduled from GS to E', 'Regular shift change (0 overtime, schedule swap)'],
      ['GS (08:00–17:00)', 'Night Shift (N)', 'Shift shifted with 24h rest prep', 'Regular shift change + night differential allowance']
    ],
    ['4.0', '3.5', '5.5', '4.5']
  )}
`);

// ==================== PAGE 15 ====================
pages.push(`
  ${pageHeader('SECTION II', 'Leave & Labour Law Compliance', '15', 'Leave Management & Labour Law Compliance', 'Tracking statutory leaves, extra duty hours, and Saudi Labour Law limits')}
  
  ${paragraph('ShiftLine maintains strict adherence to Saudi Labour Law (Royal Decree M/51) regarding maximum working hours, overtime compensation, and statutory leave allowances:')}

  ${imageEmbed(IMGS.statusCards, 17.5, 2.8, 'Technician Monthly Working Hours and Shift Summary Cards')}

  ${paragraph('Key Labour Law Parameters Enforced by ShiftLine:', true)}
  ${bullet('Standard Working Week Ceiling (Article 98)', 'Maximum 48 regular working hours per week (8 hours per day across 6 working days, or 9.6 hours across 5 working days). ShiftLine flags any technician exceeding 48 hours without authorized overtime.')}
  ${bullet('Ramadan Reduced Working Hours', 'ShiftLine includes an automatic Ramadan mode reducing maximum weekly working hours for Muslim staff to 36 hours (6 hours per day).')}
  ${bullet('Overtime Compensation Tracking (Article 107)', 'Any hours worked beyond baseline schedule or on designated rest days are logged into the "Extra Duty" column and tagged for 150% overtime payroll compensation.')}
  ${bullet('Statutory Annual Leave (Article 109)', 'Technicians are entitled to a minimum of 21 calendar days (increasing to 30 days after 5 continuous years). ShiftLine maintains a running balance.')}

  ${callout('PAYROLL EXPORT SAFETY', 'ShiftLine prevents unauthorized overtime by requiring supervisor authentication before any "Extra Duty" shift is exported to Alstom\'s SAP HR payroll integration.', 'info')}
`);

// ==================== PAGE 16 ====================
pages.push(`
  ${pageHeader('SECTION II', 'Excel Roster Import', '16', 'Excel Roster Import & Multi-Sheet Architecture', 'Importing legacy master rosters with multi-sheet detection and data validation')}
  
  ${paragraph('ShiftLine provides full bidirectional compatibility with Alstom\'s master operational spreadsheets through an intelligent Excel import pipeline:')}

  ${imageEmbed(IMGS.excelPicker, 11.5, 7.5, 'Sheet Picker Modal: Detecting "Line 5" and "Line 4 & 6" sheets')}

  ${paragraph('The 4-Step Excel Import Protocol:', true)}
  ${bullet('Step 1: Upload File', 'Drag and drop or select the Alstom monthly Excel workbook (e.g. "November Monthly Planning 1_ Line 5 _ 4&6.xlsx").')}
  ${bullet('Step 2: Sheet Detection', 'The workbook parser inspects all sheets. If separate sheets exist for "Line 5" and "Line 4 & 6", the interactive Sheet Picker modal prompts the user to select the target sheet.')}
  ${bullet('Step 3: Column Auto-Mapping', 'The parser automatically identifies employee name columns, Alstom ID columns, and day columns 1 through 31, normalizing non-standard headers.')}
  ${bullet('Step 4: Shift Code Normalization & Validation', 'Shift codes are converted to uppercase, whitespace is trimmed, and invalid codes are highlighted for correction before the database is committed.')}
`);

// ==================== PAGE 17 ====================
pages.push(`
  ${pageHeader('SECTION III', 'Work Orders & Manpower Module', '17', 'Work Orders & Manpower Module Overview', 'Bridging Maximo enterprise work orders with live technician capacity')}
  
  ${paragraph('The Work Orders & Manpower Module is ShiftLine\'s operational bridge connecting enterprise maintenance work orders (from IBM Maximo or SAP PM) directly to available technician capacity:')}

  ${imageEmbed(IMGS.woPageFull, 17.5, 8.2, 'ShiftLine Work Orders & Manpower Allocation Full Command Interface')}

  ${paragraph('Why Work Order Scheduling Demands Manpower Balancing:', true)}
  ${bullet('Eliminating Scheduling in a Vacuum', 'Planners previously assigned 15 work orders to a Tuesday night without knowing whether 4 or 12 technicians were on duty, causing frantic midnight cancellations.')}
  ${bullet('Dynamic Resource Consumption', 'Each work order specifies its required crew size (e.g., 2, 3, or 4 staff). ShiftLine aggregates demand by shift and compares it directly against the live roster.')}
  ${bullet('Real-Time Deficit Warnings', 'If a shift requires 18 technicians but only 10 are rostered, ShiftLine instantly flags an 8-person deficit with an overload badge (e.g., 180% Load).')}
`);

// ==================== PAGE 18 ====================
pages.push(`
  ${pageHeader('SECTION III', 'Mandatory Work Order Columns', '18', 'Mandatory Work Order Columns & Dictionary', 'The Yellow Headings standard for seamless Maximo data mapping')}
  
  ${paragraph('To ensure zero-error data ingestion from Alstom Maximo exports, ShiftLine enforces the standardized "Yellow Headings" data dictionary:')}

  ${makeTable(
    ['Column Name', 'Expected Format', 'Mandatory?', 'Description & Operational Significance'],
    [
      ['Line', 'Text ("Line 5", "Line 4", "Line 6")', 'YES', 'Defines the railway line and routes the order to the correct pool.'],
      ['Work Order #', 'Alphanumeric (e.g. WO-90421)', 'YES', 'Unique Maximo work order identifier for audit traceability.'],
      ['Description / System', 'Text (e.g. Point Machine PM)', 'YES', 'Maintenance activity scope; determines required trade specialty.'],
      ['Scheduled Date', 'Date (DD/MM/YYYY)', 'YES', 'Target execution date; aligns with the corresponding roster day.'],
      ['Shift / Window', 'Text ("Night", "Morning", "Evening")', 'YES', 'Designated execution window governed by track possession rules.'],
      ['Required Manpower', 'Integer (e.g. 2, 3, 4)', 'YES', 'Minimum qualified crew size required to execute safely.'],
      ['Duration (Hours)', 'Decimal (e.g. 3.5, 4.0)', 'YES', 'Estimated track occupancy duration in hours.'],
      ['Status', 'Enum ("Completed", "Pending")', 'YES', 'Live execution tracking status for maintenance sign-off.']
    ],
    ['3.2', '3.8', '2.0', '8.5']
  )}

  <text:p text:style-name="CoverSpacerSmall"/>
  ${callout('YELLOW HEADINGS STANDARD', 'In Alstom master workbooks, these 8 columns are styled with yellow header backgrounds (#fef08a). ShiftLine\'s import engine automatically detects this styling and maps columns with 100% precision.', 'info')}
`);

// ==================== PAGE 19 ====================
pages.push(`
  ${pageHeader('SECTION III', 'Work Order Import Engine', '19', 'Work Order Import Workflow & Validation', 'Sanity verification, error handling, and pool routing during import')}
  
  ${paragraph('Importing hundreds of work orders requires robust error trapping to prevent corrupted data from distorting manpower capacity calculations:')}

  ${imageEmbed(IMGS.openWoBtn, 3.8, 1.1, 'Open Workorder Navigation Command')}

  ${paragraph('The 5-Stage Work Order Ingestion Pipeline:', true)}
  ${bullet('Stage 1: File Parsing & Format Recognition', 'Accepts .xlsx, .xls, and .csv formats. Reads raw data streams directly inside the secure browser sandbox.')}
  ${bullet('Stage 2: Schema Validation & Yellow Column Matching', 'Verifies that all 8 mandatory columns exist. If column headers vary slightly (e.g., "WO Number" instead of "Work Order #"), intelligent fuzzy matching reconciles the difference.')}
  ${bullet('Stage 3: Date Boundary Checking', 'Validates that work order scheduled dates fall strictly within the active planning month. Out-of-bounds dates are isolated into a quarantined review list.')}
  ${bullet('Stage 4: Manpower Sanity Bounds', 'Verifies that crew requirements are realistic (between 1 and 8 staff). If a corrupted entry reads "0" or "99", it defaults to 2 with a warning.')}
  ${bullet('Stage 5: Pool Segregation', 'Orders tagged "Line 5" route directly to the Line 5 database; orders tagged "Line 4" or "Line 6" merge into the Combined Pool.')}

  ${callout('AUDIT SAFETY', 'Work orders imported into ShiftLine are permanently linked to their source file hash, enabling maintenance auditors to trace any assigned task back to its exact Maximo release batch.', 'success')}
`);

// ==================== PAGE 20 ====================
pages.push(`
  ${pageHeader('SECTION III', 'Executive Dashboard: Monthly Plan', '20', 'Executive Dashboard: Monthly Work Order Plan', 'Macro KPIs: Total Work Orders, Total Manpower, and Execution Health')}
  
  ${paragraph('At the top of the Work Orders page, the Executive Dashboard synthesizes hundreds of individual work orders into high-level operational intelligence:')}

  ${imageEmbed(IMGS.woMonthlyPlan, 17.5, 7.6, 'Monthly Work Order Plan & Work Order Status KPI Cards')}

  ${paragraph('Understanding the Core KPI Cards:', true)}
  ${bullet('Total Work Orders (Total WO: 316 Orders)', 'The gross count of all scheduled maintenance interventions across the network for the active month.')}
  ${bullet('Total Manpower Demand (Total MP: 790 Technicians)', 'The cumulative sum of all required crew members across all 316 orders. Represents total technician-shifts required.')}
  ${bullet('Average Crew Intensity (2.5 staff/order)', 'The ratio of Total MP to Total WO, providing immediate insight into maintenance complexity.')}
  ${bullet('Completed Work Orders (120 Orders / 38%)', 'Work orders physically executed, verified by the shift supervisor, and signed off in the digital board.')}
  ${bullet('Pending Work Orders (196 Orders / 62%)', 'Upcoming scheduled interventions remaining to be executed in subsequent shift windows.')}
`);

// ==================== PAGE 21 ====================
pages.push(`
  ${pageHeader('SECTION III', 'Crew Intensity Formula', '21', 'Crew Intensity & Manpower Demand Formula', 'Mathematical modeling of maintenance task complexity')}
  
  ${paragraph('A crucial metric surfaced by ShiftLine is Crew Intensity, expressed as "(2.5 staff/order)". This chapter explains its mathematical basis and operational utility:')}

  ${callout('CREW INTENSITY MATHEMATICAL FORMULATION', 'Crew Intensity = ( Total Manpower Required ) / ( Total Number of Work Orders )\\n\\nIn our operational baseline: 790 Total MP / 316 Total WO = 2.50 Staff per Order', 'info')}

  ${paragraph('Why Crew Intensity Matters to Maintenance Directors:', true)}
  ${bullet('Task Complexity Benchmark', 'A standard facility maintenance contract typically runs at 1.2 to 1.5 staff/order (mostly solo or pair technicians). A railway mainline maintenance contract averaging 2.5 staff/order indicates heavy, safety-critical interventions requiring gang work.')}
  ${bullet('High-Intensity Systems (3.5 – 4.5 staff/order)', 'Mainline rail grinding, turnouts and crossover replacement, overhead catenary tensioning, and substation transformer inspections. These require specialized gangs including track safety controllers, watchmen, and certified craftsmen.')}
  ${bullet('Medium-Intensity Systems (2.0 – 2.5 staff/order)', 'Point machine preventative maintenance, axle counter calibration, and platform screen door drive belt replacements.')}
  ${bullet('Low-Intensity Systems (1.0 – 1.5 staff/order)', 'Station CCTV visual inspection, passenger information display reboot, and emergency light battery testing.')}

  <text:p text:style-name="CoverSpacerSmall"/>
  ${paragraph('Resource Forecasting Table by Crew Intensity:', true)}
  ${makeTable(
    ['Intervention Category', 'Monthly Orders', 'Average Intensity', 'Monthly Technician-Shifts', 'Primary Shift'],
    [
      ['Mainline Permanent Way (Track)', '58 Orders', '4.0 staff/order', '232 Technician-Shifts', 'Night Shift (N)'],
      ['Signalling & Interlocking', '112 Orders', '2.5 staff/order', '280 Technician-Shifts', 'Night Shift (N)'],
      ['Station Platform Doors (PSD)', '86 Orders', '2.0 staff/order', '172 Technician-Shifts', 'Evening Shift (E)'],
      ['DCS & Telecom Systems', '60 Orders', '1.8 staff/order', '106 Technician-Shifts', 'Morning Shift (M)']
    ],
    ['4.8', '2.5', '3.0', '4.2', '3.0']
  )}
`);

// ==================== PAGE 22 ====================
pages.push(`
  ${pageHeader('SECTION III', 'Railway Shift Classification', '22', 'Railway Shift Classification Engine', 'Safety-mandated rules for execution time windows and track possessions')}
  
  ${paragraph('In a high-capacity driverless metro system like Riyadh Metro, maintenance tasks are strictly constrained by passenger revenue operations:')}

  ${makeTable(
    ['Railway Asset Class', 'Mandatory Shift', 'Execution Window', 'Safety & Operational Rationale'],
    [
      ['Mainline Track & Switches', 'Night Shift (N)', '01:00 – 04:30 (Possession)', 'Track access is strictly prohibited while passenger trains operate. Requires traction power isolation and physical track shorting.'],
      ['Signalling & Axle Counters', 'Night Shift (N)', '01:30 – 04:30 (Possession)', 'Testing switch machines and interlocking routes requires commanding points to move, which would trip active passenger train ATS safety circuits.'],
      ['Station Platform Doors (PSD)', 'Evening Shift (E)', '14:00 – 23:00 (Station)', 'Conducted during non-peak station hours when individual door leaves can be isolated without disrupting passenger flow.'],
      ['Station DCS & Fare Gates', 'Morning Shift (M)', '06:00 – 15:00 (Station)', 'Supervising technicians observe passenger transaction flow in real time to diagnose fare gate jams and network latency.']
    ],
    ['4.0', '2.5', '3.5', '7.5']
  )}

  <text:p text:style-name="CoverSpacerSmall"/>
  ${paragraph('The ShiftLine Classification Engine in Action:', true)}
  ${bullet('Automated Work Order Tagging', 'When an order is imported, ShiftLine inspects the Description and Asset System. If it identifies keywords like "Point Machine", "Rail Grinding", or "Catenary", it automatically binds the order to Night Shift.')}
  ${bullet('Preventing Daytime Mainline Dispatch', 'The system throws an immediate validation alert if a user attempts to schedule a track work order during Morning or Evening shifts.')}
`);

// ==================== PAGE 23 ====================
pages.push(`
  ${pageHeader('SECTION III', 'Work Order Status Tracking', '23', 'Work Order Status & Execution Tracking', 'Real-time lifecycle monitoring: Scheduled, In-Progress, and Completed')}
  
  ${paragraph('Tracking work order execution status in real time is vital for shift supervisors during morning and evening handovers:')}

  ${makeTable(
    ['Work Order Status', 'UI Visual Indicator', 'Operational Definition', 'System Action on Capacity Buffer'],
    [
      ['Pending / Scheduled', 'Amber Badge (Pending)', 'Work order is planned and waiting for its scheduled date and shift window.', 'Deducts manpower from future shift capacity buffer.'],
      ['In Progress', 'Blue Pulsing Badge (Active)', 'Technicians are currently on site with active track possession or station permit.', 'Locks assigned crew; marks capacity as actively consumed.'],
      ['Completed', 'Green Check Badge (Done)', 'Work order physically completed, tested, signed off, and tools accounted for.', 'Releases technician capacity; updates executive completion KPI percentage.'],
      ['Cancelled / Deferred', 'Gray Strikethrough (Deferred)', 'Track possession was denied or spare parts unavailable; work order deferred.', 'Restores technician capacity back to the available shift pool.']
    ],
    ['3.5', '3.5', '5.5', '5.0']
  )}

  <text:p text:style-name="CoverSpacerSmall"/>
  ${paragraph('Shift Handover Protocol & Status Sign-Off:', true)}
  ${bullet('1. Physical Tool Reconciliation', 'Before an in-progress night possession order is marked "Completed", the shift lead must verify zero tools remain on track.')}
  ${bullet('2. Single-Click Status Toggle', 'The shift lead clicks the status badge directly in ShiftLine to transition the order from "In Progress" to "Completed".')}
  ${bullet('3. Digital Board Sync', 'The update instantly reflects on the executive APSYS Digital Board banner, updating completion rates for senior management.')}
`);

// ==================== PAGE 24 ====================
pages.push(`
  ${pageHeader('SECTION III', 'Shift Capacity Buffer Cards', '24', 'Shift Capacity & Net Resource Buffer Cards', 'Real-time calculation: Available Staff vs Required Manpower')}
  
  ${paragraph('The core breakthrough of ShiftLine is the Shift Capacity Buffer Card, displayed for every day across all three operational shifts:')}

  ${imageEmbed(IMGS.woCapacityCards, 17.5, 7.8, 'Shift Capacity Buffer Cards: Morning, Evening, and Night Manpower Balance')}

  ${paragraph('Anatomy of the Net Buffer Calculation Formula:', true)}
  ${callout('NET RESOURCE BUFFER FORMULA', 'Net Resource Buffer = ( Rostered Technicians on Duty ) - ( Sum of Manpower for Scheduled Orders )\\n\\nExample Night Shift: 8 Rostered Staff - 65 Required Staff = -57 DEFICIT (813% Load)', 'warning')}

  ${bullet('Top Metric: Available Technicians', 'Derived dynamically from the active Roster Grid. Reflects the exact number of technicians scheduled on duty for that specific date and shift.')}
  ${bullet('Middle Metric: Required Manpower', 'Calculated by summing the "Required Manpower" column of all work orders scheduled for that date and shift.')}
  ${bullet('Bottom Pill: Net Resource Buffer', 'Displays the final operational margin. A positive buffer represents spare capacity for emergency corrective work. A negative buffer indicates an unworkable deficit.')}
`);

// ==================== PAGE 25 ====================
pages.push(`
  ${pageHeader('SECTION III', 'Buffer Deficits & Overload Analysis', '25', 'Buffer Deficits & Overload Capacity Analysis', 'Understanding severe bottlenecks: 129%, 200%, and 813% Load')}
  
  ${paragraph('When maintenance demand exceeds rostered supply, ShiftLine generates high-visibility Overload Badges to demand supervisor intervention:')}

  ${makeTable(
    ['Overload Badge', 'Operational Scenario', 'Load Ratio', 'Underlying Cause & Recommended Mitigation'],
    [
      ['129% Load', 'Morning Shift (7 Available vs 9 Required)', '1.29x Demand', 'Minor deficit. Two technicians from General Shift (GS) can be reassigned to Morning Shift.'],
      ['200% Load', 'Evening Shift (6 Available vs 12 Required)', '2.00x Demand', 'Moderate bottleneck. Stacking of station door inspections. Reschedule non-critical orders to adjacent days.'],
      ['813% Load (CRITICAL)', 'Night Shift (8 Available vs 65 Required)', '8.13x Demand', 'Extreme crisis. 16 separate mainline work orders scheduled on a single night. Physically impossible to execute. Mandatory redistribution required.']
    ],
    ['3.0', '4.5', '2.2', '8.0']
  )}

  <text:p text:style-name="CoverSpacerSmall"/>
  ${paragraph('Why the "813% Load" Crisis Occurs in Legacy Planning:', true)}
  ${bullet('Batch Calendar Stacking', 'Maximo automated PM generators frequently schedule all monthly track maintenance on the "15th" of each month without checking resource availability.')}
  ${bullet('The ShiftLine Preventive Shield', 'Without ShiftLine, this 813% load would go undetected until night dispatch, resulting in 12 cancelled track possessions and severe Alstom SLA penalty fines.')}
  ${bullet('Resolution Action', 'The planner uses ShiftLine\'s drag-and-drop timeline to distribute the 16 orders evenly across Monday, Tuesday, Wednesday, and Thursday nights.')}
`);

// ==================== PAGE 26 ====================
pages.push(`
  ${pageHeader('SECTION III', 'Day-by-Day Timeline Navigation', '26', 'Day-by-Day Timeline & Bottleneck Navigation', 'Selecting dates, inspecting daily loads, and balancing monthly capacity')}
  
  ${paragraph('The Day-by-Day Timeline allows planners to navigate through the entire 31-day month, inspecting daily capacity health at a glance:')}

  ${makeTable(
    ['Timeline Date State', 'Visual Header Color', 'Capacity Condition', 'Supervisor Action Protocol'],
    [
      ['Green Date (Balanced)', 'Soft Emerald (#10b981)', 'Net buffer is positive (+2 or more staff in every shift).', 'Roster and work orders approved. No modifications required.'],
      ['Amber Date (Tight)', 'Soft Yellow (#f59e0b)', 'Net buffer is exactly zero in one shift.', 'Approve with caution. Advise lead technician that zero absenteeism is tolerated.'],
      ['Red Date (Critical Deficit)', 'Bright Crimson (#e11d48)', 'Net buffer is negative (overload badge active).', 'Action required: Reassign technicians from GS or reschedule work orders.']
    ],
    ['3.5', '3.5', '5.5', '5.0']
  )}

  <text:p text:style-name="CoverSpacerSmall"/>
  ${paragraph('Timeline Navigation Controls & Features:', true)}
  ${bullet('Date Selector Slider', 'Click any day button (1 through 31) to immediately focus the capacity cards and work order table on that specific date.')}
  ${bullet('Bottleneck Filter Toggle', 'Click "Show Only Deficit Days" to hide all balanced days and focus exclusively on dates with red overload badges.')}
  ${bullet('Quick Shift Filter (M, E, N)', 'Isolate work orders belonging exclusively to a single shift window for rapid dispatch briefing.')}
`);

// ==================== PAGE 27 ====================
pages.push(`
  ${pageHeader('SECTION III', 'Combined Pool Operations', '27', 'Cross-Line Combined Pool Operations (L4 & L6)', 'Managing shared multi-skilled technicians across Lines 4 and 6')}
  
  ${paragraph('The Combined Pool for Lines 4 & 6 presents unique operational opportunities and challenges that ShiftLine is specifically engineered to manage:')}

  ${makeTable(
    ['Operational Feature', 'Line 4 (Orange Line)', 'Line 6 (Purple Line)', 'Combined Pool Advantage'],
    [
      ['Route Length & Stations', '29.6 km (16 Stations)', '30.0 km (8 Stations)', 'Total 59.6 km monitored by unified roving maintenance gangs.'],
      ['Depot Location', 'Depot 4 (Shared Facility)', 'Depot 6 (Shared Facility)', 'Common tool stores, spare parts warehouse, and dispatch offices.'],
      ['Technician Fleet', '39 Multi-Skilled Technicians', '39 Multi-Skilled Technicians', 'Zero idle time: staff shift dynamically to whichever line holds active possession.']
    ],
    ['4.0', '4.0', '4.0', '5.5']
  )}

  <text:p text:style-name="CoverSpacerSmall"/>
  ${paragraph('Cross-Line Dispatch Rules in ShiftLine:', true)}
  ${bullet('Simultaneous Possession Balancing', 'When both Line 4 and Line 6 schedule track possessions on the same night, ShiftLine computes the combined night demand against the 39 available staff.')}
  ${bullet('Unified Certification Tracking', 'All 39 technicians hold track access certifications valid on both lines, allowing seamless roster interchanging without safety compliance violations.')}
  ${bullet('Depot Departure Staging', 'ShiftLine tags each assigned crew with their departure staging depot to ensure on-time transit to remote station work sites.')}
`);

// ==================== PAGE 28 ====================
pages.push(`
  ${pageHeader('SECTION III', 'Work Order Explorer & Filtering', '28', 'Work Order Explorer, Filtering & Search', 'Advanced multi-column filtering, search, and dynamic view customization')}
  
  ${paragraph('The lower section of the Work Orders module contains the Work Order Explorer, an enterprise-grade table for searching, filtering, and sorting hundreds of maintenance orders:')}

  ${paragraph('Explorer Search & Filtering Capabilities:', true)}
  ${bullet('Global Instant Search Bar', 'Search across all fields simultaneously by Work Order # (e.g. "WO-90421"), system keyword ("Interlocking"), station name, or technician name.')}
  ${bullet('Multi-Dimensional Filter Chips', 'Filter orders by Line (Line 5 vs Line 4&6), by Shift Window (Morning, Evening, Night), by Status (Completed, In Progress, Pending), or by Trade System.')}
  ${bullet('Multi-Column Sorting', 'Click any table header to sort chronologically by date, numerically by required manpower, or alphabetically by system.')}
  ${bullet('Column Visibility Customization', 'Toggle optional columns such as Maximo Asset ID, Estimated Cost, Risk Level, and Equipment Tag.')}

  ${callout('BULK SELECTION ACTIONS', 'Planners can select multiple work orders using table checkboxes to perform batch actions: Batch Reschedule Date, Batch Shift Reassignment, or Batch Mark Completed.', 'info')}
`);

// ==================== PAGE 29 ====================
pages.push(`
  ${pageHeader('SECTION IV', 'Crew Assignment & Locking', '29', 'Hand-Picked Crew Assignment & Manual Locking', 'Assigning specialist technicians and permanently protecting critical allocations')}
  
  ${paragraph('While automated algorithms balance numbers, critical railway safety requires placing specific licensed specialists on high-risk tasks:')}

  ${makeTable(
    ['High-Risk Maintenance Intervention', 'Required Technician Specialty', 'Licensing / Certification Requirement', 'Locking Action'],
    [
      ['Mainline Point Machine Replacement', 'Signalling Master Technician', 'Alstom Level-3 Interlocking Certification', 'Lock assigned technician in ShiftLine.'],
      ['Catenary Neutral Section Overhaul', 'High-Voltage Traction Specialist', 'Traction Power Isolation Officer (TPIO)', 'Lock assigned technician in ShiftLine.'],
      ['Axle Counter Head Replacement', 'Telecom & Signalling Tech', 'Alstom Wayside Safety Sign-Off License', 'Lock assigned technician in ShiftLine.']
    ],
    ['4.5', '4.0', '5.0', '4.0']
  )}

  <text:p text:style-name="CoverSpacerSmall"/>
  ${paragraph('How Manual Locking Works in ShiftLine:', true)}
  ${bullet('Hand-Picking Crew Members', 'Clicking "Assign Crew" on any work order opens the technician picker, displaying qualified on-duty staff.')}
  ${bullet('Engaging the Padlock Icon', 'Once assigned, the supervisor clicks the padlock icon on the work order row. The lock turns gold.')}
  ${bullet('Absolute Protection', 'Even if a user subsequently clicks "Auto-Generate Roster" or "Auto-Balance Workorders", locked crew assignments are 100% immune from modification.')}
`);

// ==================== PAGE 30 ====================
pages.push(`
  ${pageHeader('SECTION IV', 'Audits & Monthly Checklist', '30', 'Data Exporting, Backups & Complete System Audit Checklist', 'Operational readiness checklists, Alstom APSYS compliance, and ERP export')}
  
  ${paragraph('To ensure world-class operational reliability, maintenance supervisors must complete the following standard operating checklist throughout the monthly planning lifecycle:')}

  ${makeTable(
    ['Planning Phase', 'Timeline Target', 'Mandatory Operational Verification Steps', 'Sign-Off Authority'],
    [
      ['Phase 1: Ingestion', 'D - 10 Days', 'Import master Excel roster and Maximo monthly work order package. Verify 61 staff and ~316 orders mapped.', 'Roster Planner'],
      ['Phase 2: Roster Audit', 'D - 7 Days', 'Run Auto-Generate. Review Insights Panel. Resolve all shortfall errors using "Show Who Can Cover".', 'Shift Supervisor'],
      ['Phase 3: Capacity Balancing', 'D - 5 Days', 'Audit Shift Capacity Buffer cards. Eliminate all red overload badges (813% / 200% loads) by redistributing PM dates.', 'Maintenance Engineer'],
      ['Phase 4: Specialist Crew Lock', 'D - 3 Days', 'Hand-pick and lock certified master technicians to high-risk night track possession work orders.', 'Safety Lead Engineer'],
      ['Phase 5: Publication & Export', 'D - 1 Day', 'Export final PDF roster for depot notice boards. Push data to Alstom SAP HR and Maximo ERP.', 'Maintenance Director']
    ],
    ['3.2', '2.5', '8.5', '3.5']
  )}

  <text:p text:style-name="CoverSpacerSmall"/>
  ${callout('APSYS AUDIT COMPLIANCE STATEMENT', 'ShiftLine complies fully with Alstom APSYS (Alstom Production System) Quality Standards for Maintenance Planning, ensuring 100% traceability, zero fatigue violations, and complete track possession safety certification across Riyadh Metro Lines 4, 5, and 6.', 'success')}
`);

// -------------------------------------------------------------
// STYLES & TEMPLATE FOR FODT
// -------------------------------------------------------------
const fodtXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
  xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
  xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"
  xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"
  xmlns:xlink="http://www.w3.org/1999/xlink"
  xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"
  office:version="1.3" office:mimetype="application/vnd.oasis.opendocument.text">

  <office:font-face-decls>
    <style:font-face style:name="Liberation Sans" svg:font-family="&apos;Liberation Sans&apos;, &apos;Helvetica Neue&apos;, Arial, sans-serif"/>
    <style:font-face style:name="Liberation Mono" svg:font-family="&apos;Liberation Mono&apos;, monospace"/>
  </office:font-face-decls>

  <office:automatic-styles>
    <style:page-layout style:name="pmStandard">
      <style:page-layout-properties fo:page-width="21.0cm" fo:page-height="29.7cm"
        fo:margin-top="1.3cm" fo:margin-bottom="1.3cm" fo:margin-left="1.6cm" fo:margin-right="1.6cm"/>
      <style:header-style>
        <style:header-footer-properties fo:min-height="0.7cm" fo:margin-bottom="0.4cm" style:dynamic-spacing="false"/>
      </style:header-style>
      <style:footer-style>
        <style:header-footer-properties fo:min-height="0.7cm" fo:margin-top="0.4cm" style:dynamic-spacing="false"/>
      </style:footer-style>
    </style:page-layout>

    <!-- Header & Footer Styles -->
    <style:style style:name="HeaderStyle" style:family="paragraph">
      <style:text-properties fo:font-size="8pt" fo:color="#64748b" fo:font-family="Liberation Sans" fo:font-weight="bold"/>
      <style:paragraph-properties fo:border-bottom="0.5pt solid #cbd5e1" fo:padding-bottom="0.12cm"/>
    </style:style>
    <style:style style:name="FooterStyle" style:family="paragraph">
      <style:text-properties fo:font-size="8pt" fo:color="#64748b" fo:font-family="Liberation Sans"/>
      <style:paragraph-properties fo:border-top="0.5pt solid #cbd5e1" fo:padding-top="0.12cm" fo:text-align="end"/>
    </style:style>

    <!-- Page Break -->
    <style:style style:name="PageBreak" style:family="paragraph">
      <style:paragraph-properties fo:break-before="page"/>
    </style:style>

    <!-- Typography Styles -->
    <style:style style:name="CoverSuperTag" style:family="paragraph">
      <style:text-properties fo:font-size="9pt" fo:font-weight="bold" fo:color="#0284c7" fo:letter-spacing="0.15cm" fo:font-family="Liberation Sans"/>
      <style:paragraph-properties fo:margin-top="1.5cm" fo:margin-bottom="0.3cm" fo:text-align="center"/>
    </style:style>
    <style:style style:name="CoverTitle" style:family="paragraph">
      <style:text-properties fo:font-size="24pt" fo:font-weight="bold" fo:color="#0f2b48" fo:font-family="Liberation Sans"/>
      <style:paragraph-properties fo:line-height="115%" fo:margin-bottom="0.3cm" fo:text-align="center"/>
    </style:style>
    <style:style style:name="CoverSubtitle" style:family="paragraph">
      <style:text-properties fo:font-size="12pt" fo:color="#475569" fo:font-family="Liberation Sans"/>
      <style:paragraph-properties fo:margin-bottom="0.8cm" fo:text-align="center"/>
    </style:style>
    <style:style style:name="CoverSpacerSmall" style:family="paragraph">
      <style:paragraph-properties fo:margin-top="0.3cm" fo:margin-bottom="0.3cm"/>
    </style:style>

    <!-- Page Content Headings -->
    <style:style style:name="SectionTag" style:family="paragraph">
      <style:text-properties fo:font-size="7.5pt" fo:font-weight="bold" fo:color="#0284c7" fo:letter-spacing="0.1cm" fo:font-family="Liberation Sans"/>
      <style:paragraph-properties fo:margin-top="0.0cm" fo:margin-bottom="0.08cm"/>
    </style:style>
    <style:style style:name="PageTitle" style:family="paragraph">
      <style:text-properties fo:font-size="15pt" fo:font-weight="bold" fo:color="#0f2b48" fo:font-family="Liberation Sans"/>
      <style:paragraph-properties fo:line-height="110%" fo:margin-bottom="0.08cm"/>
    </style:style>
    <style:style style:name="PageSubtitle" style:family="paragraph">
      <style:text-properties fo:font-size="8.5pt" fo:color="#64748b" fo:font-style="italic" fo:font-family="Liberation Sans"/>
      <style:paragraph-properties fo:margin-bottom="0.25cm"/>
    </style:style>

    <!-- Body Styles -->
    <style:style style:name="BodyText" style:family="paragraph">
      <style:text-properties fo:font-size="8.5pt" fo:color="#1e293b" fo:font-family="Liberation Sans"/>
      <style:paragraph-properties fo:line-height="125%" fo:margin-bottom="0.18cm"/>
    </style:style>
    <style:style style:name="BodyBold" style:family="paragraph">
      <style:text-properties fo:font-size="8.5pt" fo:font-weight="bold" fo:color="#0f2b48" fo:font-family="Liberation Sans"/>
      <style:paragraph-properties fo:line-height="125%" fo:margin-top="0.15cm" fo:margin-bottom="0.12cm"/>
    </style:style>
    <style:style style:name="BulletText" style:family="paragraph">
      <style:text-properties fo:font-size="8.2pt" fo:color="#334155" fo:font-family="Liberation Sans"/>
      <style:paragraph-properties fo:line-height="120%" fo:margin-left="0.4cm" fo:margin-bottom="0.10cm"/>
    </style:style>
    <style:style style:name="TextBold" style:family="text">
      <style:text-properties fo:font-weight="bold" fo:color="#0f2b48"/>
    </style:style>

    <!-- Image & Caption Styles -->
    <style:style style:name="ImageContainer" style:family="paragraph">
      <style:paragraph-properties fo:text-align="center" fo:margin-top="0.12cm" fo:margin-bottom="0.08cm"/>
    </style:style>
    <style:style style:name="ImgFrameStyle" style:family="graphic">
      <style:graphic-properties fo:border="0.5pt solid #cbd5e1"/>
    </style:style>
    <style:style style:name="ImageCaption" style:family="paragraph">
      <style:text-properties fo:font-size="7.5pt" fo:color="#64748b" fo:font-style="italic" fo:font-family="Liberation Sans"/>
      <style:paragraph-properties fo:text-align="center" fo:margin-bottom="0.22cm"/>
    </style:style>

    <!-- Callout Box Styles -->
    <style:style style:name="CalloutBox" style:family="table">
      <style:table-properties fo:margin-top="0.15cm" fo:margin-bottom="0.25cm" table:align="margins"/>
    </style:style>
    <style:style style:name="CalloutBoxCell" style:family="table-cell">
      <style:table-cell-properties fo:background-color="#f0f9ff" fo:padding="0.22cm"
        fo:border-left="3.0pt solid #0284c7" fo:border-top="0.5pt solid #bae6fd"
        fo:border-right="0.5pt solid #bae6fd" fo:border-bottom="0.5pt solid #bae6fd"/>
    </style:style>
    <style:style style:name="CalloutTitle" style:family="paragraph">
      <style:text-properties fo:font-size="8pt" fo:font-weight="bold" fo:color="#0369a1" fo:font-family="Liberation Sans"/>
      <style:paragraph-properties fo:margin-bottom="0.08cm"/>
    </style:style>
    <style:style style:name="CalloutText" style:family="paragraph">
      <style:text-properties fo:font-size="8pt" fo:color="#0f172a" fo:font-family="Liberation Sans"/>
      <style:paragraph-properties fo:line-height="120%"/>
    </style:style>

    <!-- Warning Callout Box -->
    <style:style style:name="CalloutBoxWarning" style:family="table">
      <style:table-properties fo:margin-top="0.15cm" fo:margin-bottom="0.25cm" table:align="margins"/>
    </style:style>
    <style:style style:name="CalloutBoxWarningCell" style:family="table-cell">
      <style:table-cell-properties fo:background-color="#fff1f2" fo:padding="0.22cm"
        fo:border-left="3.0pt solid #e11d48" fo:border-top="0.5pt solid #fecdd3"
        fo:border-right="0.5pt solid #fecdd3" fo:border-bottom="0.5pt solid #fecdd3"/>
    </style:style>
    <style:style style:name="CalloutTitleWarning" style:family="paragraph">
      <style:text-properties fo:font-size="8pt" fo:font-weight="bold" fo:color="#be123c" fo:font-family="Liberation Sans"/>
      <style:paragraph-properties fo:margin-bottom="0.08cm"/>
    </style:style>

    <!-- Success Callout Box -->
    <style:style style:name="CalloutBoxSuccess" style:family="table">
      <style:table-properties fo:margin-top="0.15cm" fo:margin-bottom="0.25cm" table:align="margins"/>
    </style:style>
    <style:style style:name="CalloutBoxSuccessCell" style:family="table-cell">
      <style:table-cell-properties fo:background-color="#f0fdf4" fo:padding="0.22cm"
        fo:border-left="3.0pt solid #10b981" fo:border-top="0.5pt solid #bbf7d0"
        fo:border-right="0.5pt solid #bbf7d0" fo:border-bottom="0.5pt solid #bbf7d0"/>
    </style:style>
    <style:style style:name="CalloutTitleSuccess" style:family="paragraph">
      <style:text-properties fo:font-size="8pt" fo:font-weight="bold" fo:color="#047857" fo:font-family="Liberation Sans"/>
      <style:paragraph-properties fo:margin-bottom="0.08cm"/>
    </style:style>

    <!-- Cover Meta Table -->
    <style:style style:name="CoverMetaTableStyle" style:family="table">
      <style:table-properties fo:margin-top="0.4cm" fo:margin-bottom="0.4cm" table:align="margins"/>
    </style:style>
    <style:style style:name="CoverMetaCell" style:family="table-cell">
      <style:table-cell-properties fo:background-color="#f8fafc" fo:padding="0.35cm"
        fo:border="0.5pt solid #cbd5e1"/>
    </style:style>
    <style:style style:name="CoverMetaLabel" style:family="paragraph">
      <style:text-properties fo:font-size="7.5pt" fo:font-weight="bold" fo:color="#64748b" fo:font-family="Liberation Sans"/>
      <style:paragraph-properties fo:margin-bottom="0.05cm"/>
    </style:style>
    <style:style style:name="CoverMetaVal" style:family="paragraph">
      <style:text-properties fo:font-size="9pt" fo:font-weight="bold" fo:color="#0f2b48" fo:font-family="Liberation Sans"/>
      <style:paragraph-properties fo:margin-bottom="0.25cm"/>
    </style:style>

    <!-- Table Styles -->
    <style:style style:name="CustomDataTable" style:family="table">
      <style:table-properties fo:margin-top="0.15cm" fo:margin-bottom="0.25cm" table:align="margins"/>
    </style:style>
    <style:style style:name="TableHeadCell" style:family="table-cell">
      <style:table-cell-properties fo:background-color="#0f2b48" fo:padding="0.14cm" fo:border="0.5pt solid #0f2b48"/>
    </style:style>
    <style:style style:name="TableHeadText" style:family="paragraph">
      <style:text-properties fo:font-size="7.8pt" fo:font-weight="bold" fo:color="#ffffff" fo:font-family="Liberation Sans"/>
      <style:paragraph-properties fo:text-align="start"/>
    </style:style>
    <style:style style:name="TableCell" style:family="table-cell">
      <style:table-cell-properties fo:background-color="#ffffff" fo:padding="0.12cm" fo:border="0.5pt solid #cbd5e1"/>
    </style:style>
    <style:style style:name="TableCellAlt" style:family="table-cell">
      <style:table-cell-properties fo:background-color="#f8fafc" fo:padding="0.12cm" fo:border="0.5pt solid #cbd5e1"/>
    </style:style>
    <style:style style:name="TableCellText" style:family="paragraph">
      <style:text-properties fo:font-size="7.6pt" fo:color="#1e293b" fo:font-family="Liberation Sans"/>
      <style:paragraph-properties fo:line-height="115%"/>
    </style:style>

    <!-- Column Width Styles -->
    <style:style style:name="ColFullWidth" style:family="table-column">
      <style:table-column-properties style:column-width="17.8cm"/>
    </style:style>
    <style:style style:name="ColHalf" style:family="table-column">
      <style:table-column-properties style:column-width="8.9cm"/>
    </style:style>
    <style:style style:name="ColCustom_1_8" style:family="table-column">
      <style:table-column-properties style:column-width="1.8cm"/>
    </style:style>
    <style:style style:name="ColCustom_2_0" style:family="table-column">
      <style:table-column-properties style:column-width="2.0cm"/>
    </style:style>
    <style:style style:name="ColCustom_2_1" style:family="table-column">
      <style:table-column-properties style:column-width="2.1cm"/>
    </style:style>
    <style:style style:name="ColCustom_2_2" style:family="table-column">
      <style:table-column-properties style:column-width="2.2cm"/>
    </style:style>
    <style:style style:name="ColCustom_2_3" style:family="table-column">
      <style:table-column-properties style:column-width="2.3cm"/>
    </style:style>
    <style:style style:name="ColCustom_2_5" style:family="table-column">
      <style:table-column-properties style:column-width="2.5cm"/>
    </style:style>
    <style:style style:name="ColCustom_3_0" style:family="table-column">
      <style:table-column-properties style:column-width="3.0cm"/>
    </style:style>
    <style:style style:name="ColCustom_3_2" style:family="table-column">
      <style:table-column-properties style:column-width="3.2cm"/>
    </style:style>
    <style:style style:name="ColCustom_3_5" style:family="table-column">
      <style:table-column-properties style:column-width="3.5cm"/>
    </style:style>
    <style:style style:name="ColCustom_3_8" style:family="table-column">
      <style:table-column-properties style:column-width="3.8cm"/>
    </style:style>
    <style:style style:name="ColCustom_4_0" style:family="table-column">
      <style:table-column-properties style:column-width="4.0cm"/>
    </style:style>
    <style:style style:name="ColCustom_4_2" style:family="table-column">
      <style:table-column-properties style:column-width="4.2cm"/>
    </style:style>
    <style:style style:name="ColCustom_4_5" style:family="table-column">
      <style:table-column-properties style:column-width="4.5cm"/>
    </style:style>
    <style:style style:name="ColCustom_4_8" style:family="table-column">
      <style:table-column-properties style:column-width="4.8cm"/>
    </style:style>
    <style:style style:name="ColCustom_5_0" style:family="table-column">
      <style:table-column-properties style:column-width="5.0cm"/>
    </style:style>
    <style:style style:name="ColCustom_5_5" style:family="table-column">
      <style:table-column-properties style:column-width="5.5cm"/>
    </style:style>
    <style:style style:name="ColCustom_6_0" style:family="table-column">
      <style:table-column-properties style:column-width="6.0cm"/>
    </style:style>
    <style:style style:name="ColCustom_7_5" style:family="table-column">
      <style:table-column-properties style:column-width="7.5cm"/>
    </style:style>
    <style:style style:name="ColCustom_8_0" style:family="table-column">
      <style:table-column-properties style:column-width="8.0cm"/>
    </style:style>
    <style:style style:name="ColCustom_8_5" style:family="table-column">
      <style:table-column-properties style:column-width="8.5cm"/>
    </style:style>
  </office:automatic-styles>

  <office:master-styles>
    <style:master-page style:name="Standard" style:page-layout-name="pmStandard">
      <style:header>
        <text:p text:style-name="HeaderStyle">ShiftLine Operations Guide · Riyadh SLV Maintenance (Lines 4, 5 &amp; 6)  |  Alstom Restricted</text:p>
      </style:header>
      <style:footer>
        <text:p text:style-name="FooterStyle">Riyadh Metro SLV Operational Systems · ShiftLine v2.4  |  Page <text:page-number text:select-page="current"/> of <text:page-count/></text:p>
      </style:footer>
    </style:master-page>
  </office:master-styles>

  <office:body>
    <office:text>
      ${pages.map((p, idx) => {
        if (idx === 0) return p;
        return `<text:p text:style-name="PageBreak"/>\n${p}`;
      }).join('\n')}
    </office:text>
  </office:body>
</office:document>`;

const FODT_OUT = path.join(__dirname, 'ShiftLine_Operations_Guide_30_Pages.fodt');
const PDF_OUT_DIR = path.resolve(__dirname, '..');

fs.writeFileSync(FODT_OUT, fodtXml);
console.log("Written FODT file to:", FODT_OUT, "Size:", (fs.statSync(FODT_OUT).size / 1024 / 1024).toFixed(2), "MB");

console.log("Converting to PDF via LibreOffice headless...");
const cmd = `libreoffice "-env:UserInstallation=file:///tmp/libreoffice_profile" --headless --convert-to pdf "${FODT_OUT}" --outdir "${PDF_OUT_DIR}"`;
execSync(cmd, { stdio: 'inherit' });

const generatedPdf = path.join(PDF_OUT_DIR, 'ShiftLine_Operations_Guide_30_Pages.pdf');
console.log("Checking PDF info for:", generatedPdf);
const info = execSync(`pdfinfo "${generatedPdf}"`).toString();
console.log(info);

const pageMatch = info.match(/Pages:\s+(\d+)/);
if (pageMatch) {
  const pagesCount = parseInt(pageMatch[1], 10);
  console.log("===> TOTAL DETECTED PAGES:", pagesCount);
  if (pagesCount === 30) {
    console.log("SUCCESS! PERFECT EXACTLY 30 PAGES GENERATED!");
  } else {
    console.warn(`WARNING: Page count is ${pagesCount}, expected exactly 30.`);
  }
}

