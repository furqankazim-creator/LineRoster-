import type { Employee, LeaveBlock, Line, ResourceRequirement, ShiftCode, WorkOrder } from '@/domain/types';

/**
 * Seed data — the client's real Line 5 September 2026 roster.
 *
 * Every field here was derived mechanically from `Roster_September.xlsx`:
 * rest-day pairs from where `-` falls, rotation blocks from where the worked
 * code changes, leave blocks from the red fills. The app therefore opens on
 * his own roster rather than an empty grid.
 */

export const SEED_LINES: Line[] = [
  { id: 'line5', name: 'Line 5', prefix: 'SLV', order: 1 },
  { id: 'line4', name: 'Line 4', prefix: 'SLV', order: 2 },
  { id: 'line6', name: 'Line 6', prefix: 'SLV', order: 3 },
];

/**
 * Shift codes.
 *
 * Timings come from the legend block in the client's sheet, read on a
 * 12-hour clock: "M-Time_06:00hrs-03:00hrs" is 06:00 → 15:00.
 *
 * `minHeadcount` is seeded from the thinnest days actually present in his
 * September sheet (Morning 2, Evening 2, Night 3) — worth confirming with
 * him, and editable in Setup.
 */
export const SEED_CODES: ShiftCode[] = [
  {
    id: 'M', label: 'Morning', timing: '06:00 – 15:00', tone: 'morning',
    minHeadcount: 2, countsAsEngineer: true, rotates: true, order: 1,
  },
  {
    id: 'E', label: 'Evening', timing: '14:00 – 23:00', tone: 'evening',
    minHeadcount: 2, countsAsEngineer: true, rotates: true, order: 2,
  },
  {
    id: 'N', label: 'Night', timing: '22:00 – 07:00', tone: 'night',
    minHeadcount: 3, countsAsEngineer: true, rotates: true, order: 3,
  },
  {
    id: 'GS', label: 'General Shift', timing: '08:00 – 17:00', tone: 'general',
    minHeadcount: 0, countsAsEngineer: true, rotates: false, order: 4,
  },
  {
    id: 'P', label: 'Project', timing: '08:00 – 17:00', tone: 'project',
    minHeadcount: 0, countsAsEngineer: true, rotates: false, order: 5,
  },
  // Support categories referenced by the client's own COUNTIF formulas
  // (Total Head Counts includes MT/ML, Engineers Count excludes them).
  // Meaning still to be confirmed with him; they are here so his numbers add up.
  {
    id: 'MT', label: 'Morning – Support', timing: '06:00 – 15:00', tone: 'morning',
    minHeadcount: 0, countsAsEngineer: false, rotates: false, order: 6,
  },
  {
    id: 'ET', label: 'Evening – Support', timing: '14:00 – 23:00', tone: 'evening',
    minHeadcount: 0, countsAsEngineer: false, rotates: false, order: 7,
  },
  {
    id: 'NT', label: 'Night – Support', timing: '22:00 – 07:00', tone: 'night',
    minHeadcount: 0, countsAsEngineer: false, rotates: false, order: 8,
  },
  // Late-shift variants used in operational rosters (Morning Late, Evening Late, Night Late).
  // These appear when departments import their own Excel files — they are global so they work
  // on every line, not just the one that was imported into.
  {
    id: 'ML', label: 'Morning Late', timing: '07:00 – 18:00', tone: 'morning',
    minHeadcount: 0, countsAsEngineer: false, rotates: false, order: 11,
  },
  {
    id: 'EL', label: 'Evening Late', timing: '15:00 – 00:00', tone: 'evening',
    minHeadcount: 0, countsAsEngineer: false, rotates: false, order: 12,
  },
  {
    id: 'NL', label: 'Night Late', timing: '19:00 – 07:00', tone: 'night',
    minHeadcount: 0, countsAsEngineer: false, rotates: false, order: 13,
  },
  {
    id: 'LV', label: 'Leave', timing: '—', tone: 'leave',
    minHeadcount: 0, countsAsEngineer: false, rotates: false, isStatus: true, order: 9,
  },
  {
    id: 'FLRT', label: 'FLRT', timing: '—', tone: 'leave',
    minHeadcount: 0, countsAsEngineer: false, rotates: false, isStatus: true, order: 10,
  },
];

export const SEED_EMPLOYEES: Employee[] = [
  {
    id: 'e01', lineId: 'line5', order: 1,
    name: 'Ummer Abbas', contact: '575435291',
    defaultShift: 'M', restDays: [0, 1],
    pinned: false, active: true,
  },
  {
    id: 'e02', lineId: 'line5', order: 2,
    name: 'Masudur Ghazi', contact: '531401478',
    defaultShift: 'M', restDays: [5, 6],
    pinned: false, active: true,
  },
  {
    id: 'e03', lineId: 'line5', order: 3,
    name: 'Mohammed Mustafa', contact: '534467057',
    defaultShift: 'M', restDays: [2, 3],
    pinned: false, active: true,
  },
  {
    id: 'e04', lineId: 'line5', order: 4,
    name: 'Nazir Ahmed', contact: '594731601',
    defaultShift: 'E', restDays: [4, 5],
    pinned: false, active: true,
  },
  {
    id: 'e05', lineId: 'line5', order: 5,
    name: 'Masaud Rana', contact: '532476245',
    defaultShift: 'E', restDays: [0, 1],
    rotations: { '2026-09': [{ fromDay: 1, toDay: 21, code: 'E' }, { fromDay: 22, toDay: 30, code: 'M' }] },
    pinned: false, active: true,
  },
  {
    id: 'e06', lineId: 'line5', order: 6,
    name: 'Waqas Tahir', contact: '575826285',
    defaultShift: 'E', restDays: [2, 3],
    pinned: false, active: true, isLeader: true,
  },
  {
    id: 'e07', lineId: 'line5', order: 7,
    name: 'Muhammad Adeel', contact: '599406802',
    defaultShift: 'N', restDays: [2, 3],
    pinned: false, active: true,
  },
  {
    id: 'e08', lineId: 'line5', order: 8,
    name: 'Mohammad Monis', contact: '544352527',
    defaultShift: 'N', restDays: [0, 1],
    rotations: { '2026-09': [{ fromDay: 1, toDay: 21, code: 'N' }, { fromDay: 22, toDay: 30, code: 'E' }] },
    pinned: false, active: true,
  },
  {
    id: 'e09', lineId: 'line5', order: 9,
    name: 'Ebora Alexis', contact: '533934362',
    defaultShift: 'N', restDays: [2, 3],
    pinned: false, active: true, isLeader: true,
  },
  {
    id: 'e10', lineId: 'line5', order: 10,
    name: 'Abdulaziz Alhaqbani', contact: '555722889',
    defaultShift: 'N', restDays: [5, 6],
    pinned: false, active: true,
  },
  {
    id: 'e11', lineId: 'line5', order: 11,
    name: 'Ali Alammar', contact: '538284835',
    defaultShift: 'N', restDays: [5, 6],
    pinned: false, active: true,
  },
  {
    id: 'e12', lineId: 'line5', order: 12,
    name: 'Mithun Kumar', contact: '539288373',
    defaultShift: 'N', restDays: [5, 6],
    pinned: false, active: true,
  },
  {
    id: 'e13', lineId: 'line5', order: 13,
    name: 'Abdulaziz ALMAIMONI', contact: '541723760',
    defaultShift: 'N', restDays: [5, 6],
    pinned: false, active: true,
  },
  {
    id: 'e14', lineId: 'line5', order: 14,
    name: 'Imran Ghani', contact: '558837005',
    defaultShift: 'GS', restDays: [],
    pinned: true, active: true,
  },
  {
    id: 'e15', lineId: 'line5', order: 15,
    name: 'Arif Ali khan', contact: '594570624',
    defaultShift: 'E', restDays: [5, 6],
    rotations: {
      '2026-09': [
        { fromDay: 1, toDay: 12, code: 'E' },
        { fromDay: 13, toDay: 26, code: 'N' },
        { fromDay: 27, toDay: 30, code: 'E' },
      ],
    },
    pinned: false, active: true, isLeader: true,
  },
  {
    id: 'e16', lineId: 'line5', order: 16,
    name: 'Rehan Raziq', contact: '594685701',
    defaultShift: 'GS', restDays: [5, 6],
    rotations: {
      '2026-09': [
        { fromDay: 1, toDay: 12, code: 'M' },
        { fromDay: 13, toDay: 26, code: 'GS' },
        { fromDay: 27, toDay: 30, code: 'E' },
      ],
    },
    pinned: true, active: true,
  },
  {
    id: 'e17', lineId: 'line5', order: 17,
    name: 'Abdul Saeed', contact: '591826412',
    defaultShift: 'E', restDays: [5, 6],
    rotations: {
      '2026-09': [
        { fromDay: 1, toDay: 12, code: 'N' },
        { fromDay: 13, toDay: 26, code: 'E' },
        { fromDay: 27, toDay: 30, code: 'M' },
      ],
    },
    pinned: false, active: true, isLeader: true,
  },
  {
    id: 'e18', lineId: 'line5', order: 18,
    name: 'Chandra Vadla', contact: '536542847',
    defaultShift: 'GS', restDays: [5, 6],
    rotations: { '2026-09': [{ fromDay: 1, toDay: 5, code: 'M' }, { fromDay: 6, toDay: 30, code: 'GS' }] },
    pinned: true, active: true,
  },
  {
    id: 'e19', lineId: 'line5', order: 19,
    name: 'Nasir Bilal', contact: '544657260',
    defaultShift: 'GS', restDays: [5, 6],
    rotations: { '2026-09': [{ fromDay: 1, toDay: 19, code: 'GS' }, { fromDay: 20, toDay: 30, code: 'N' }] },
    pinned: true, active: true,
  },
  {
    id: 'e20', lineId: 'line5', order: 20,
    name: 'Abdulrahman', contact: '569906414',
    // His Fri/Sat cells are blank rather than "-" in the source sheet; the
    // pattern is identical to the rest of the GS group, so read as Fri+Sat off.
    defaultShift: 'GS', restDays: [5, 6],
    pinned: false, active: true, isLeader: true,
  },
  {
    id: 'e21', lineId: 'line5', order: 21,
    name: 'Raneem Almalki', contact: '569240749',
    defaultShift: 'N', restDays: [5, 6],
    rotations: { '2026-09': [{ fromDay: 1, toDay: 19, code: 'M' }, { fromDay: 20, toDay: 30, code: 'N' }] },
    pinned: false, active: true, isLeader: true,
  },
  {
    id: 'e22', lineId: 'line5', order: 22,
    name: 'Mthaye Alsharif', contact: '563211464',
    defaultShift: 'P', restDays: [5, 6],
    pinned: true, active: true,
  },
];

export const SEED_LEAVE: LeaveBlock[] = [
  { id: 'lv-e01-20', employeeId: 'e01', from: '2026-09-20', to: '2026-09-30', code: 'LV', note: 'Imported from red block in source sheet' },
  { id: 'lv-e14-flrt', employeeId: 'e14', from: '2026-09-01', to: '2026-09-30', code: 'FLRT', note: 'Marked FLRT for the full month in the source sheet' },
  { id: 'lv-e16-1', employeeId: 'e16', from: '2026-09-01', to: '2026-09-03', code: 'LV', note: 'Imported from red block in source sheet' },
  { id: 'lv-e21-6', employeeId: 'e21', from: '2026-09-06', to: '2026-09-10', code: 'LV', note: 'Imported from red block in source sheet' },
  { id: 'lv-e21-13', employeeId: 'e21', from: '2026-09-13', to: '2026-09-17', code: 'LV', note: 'Imported from red block in source sheet' },
];

export const SEED_MONTH = { year: 2026, month: 9 };

export const SEED_RESOURCE_REQUIREMENTS: ResourceRequirement[] = [
  // Line 4 defaults
  { id: 'rr-l4-pm-m', line: 'L4', workType: 'PM', shift: 'morning', defaultPeopleCount: 3, department: 'DCS' },
  { id: 'rr-l4-pm-e', line: 'L4', workType: 'PM', shift: 'evening', defaultPeopleCount: 4, department: 'DCS' },
  { id: 'rr-l4-pm-n', line: 'L4', workType: 'PM', shift: 'night', defaultPeopleCount: 5, department: 'DCS' },
  { id: 'rr-l4-cm-m', line: 'L4', workType: 'CM', shift: 'morning', defaultPeopleCount: 2, department: 'DCS' },
  { id: 'rr-l4-cm-e', line: 'L4', workType: 'CM', shift: 'evening', defaultPeopleCount: 1, department: 'DCS' },
  { id: 'rr-l4-cm-n', line: 'L4', workType: 'CM', shift: 'night', defaultPeopleCount: 2, department: 'DCS' },
  { id: 'rr-l4-acs-all', line: 'L4', workType: 'ACS', shift: 'all', defaultPeopleCount: 1, department: 'DCS' },

  // Line 5 defaults (matches client voice note: PM 2, CM 2)
  { id: 'rr-l5-pm-m', line: 'L5', workType: 'PM', shift: 'morning', defaultPeopleCount: 2, department: 'SLV' },
  { id: 'rr-l5-pm-e', line: 'L5', workType: 'PM', shift: 'evening', defaultPeopleCount: 2, department: 'SLV' },
  { id: 'rr-l5-pm-n', line: 'L5', workType: 'PM', shift: 'night', defaultPeopleCount: 3, department: 'SLV' },
  { id: 'rr-l5-cm-m', line: 'L5', workType: 'CM', shift: 'morning', defaultPeopleCount: 2, department: 'SLV' },
  { id: 'rr-l5-cm-e', line: 'L5', workType: 'CM', shift: 'evening', defaultPeopleCount: 1, department: 'SLV' },
  { id: 'rr-l5-cm-n', line: 'L5', workType: 'CM', shift: 'night', defaultPeopleCount: 2, department: 'SLV' },
  { id: 'rr-l5-acs-all', line: 'L5', workType: 'ACS', shift: 'all', defaultPeopleCount: 1, department: 'SLV' },

  // Line 6 defaults
  { id: 'rr-l6-pm-m', line: 'L6', workType: 'PM', shift: 'morning', defaultPeopleCount: 4, department: 'SLV' },
  { id: 'rr-l6-pm-e', line: 'L6', workType: 'PM', shift: 'evening', defaultPeopleCount: 4, department: 'SLV' },
  { id: 'rr-l6-pm-n', line: 'L6', workType: 'PM', shift: 'night', defaultPeopleCount: 6, department: 'SLV' },
  { id: 'rr-l6-cm-m', line: 'L6', workType: 'CM', shift: 'morning', defaultPeopleCount: 2, department: 'SLV' },
  { id: 'rr-l6-cm-e', line: 'L6', workType: 'CM', shift: 'evening', defaultPeopleCount: 2, department: 'SLV' },
  { id: 'rr-l6-cm-n', line: 'L6', workType: 'CM', shift: 'night', defaultPeopleCount: 2, department: 'SLV' },
  { id: 'rr-l6-acs-all', line: 'L6', workType: 'ACS', shift: 'all', defaultPeopleCount: 1, department: 'SLV' },
];

export const SEED_WORK_ORDERS: WorkOrder[] = [
  {
    id: 'wo-13445509',
    workOrderId: '13445509',
    description: 'Quarterly track maintenance and sensor calibration on Line 6',
    workType: 'PM',
    line: 'L6',
    department: 'SLV',
    scheduledStart: '2026-10-16',
    scheduledFinish: '2026-10-22',
    targetFinish: '2026-10-22',
    status: 'APPR',
    resourceRequired: 4,
    plannedDay: 16,
    plannedShift: 'N',
  },
  {
    id: 'wo-13448992',
    workOrderId: '13448992',
    description: 'DCS controller rack inspection and communication loop test',
    workType: 'PM',
    line: 'L4',
    department: 'DCS',
    scheduledStart: '2026-09-24',
    scheduledFinish: '2026-09-30',
    targetFinish: '2026-09-30',
    status: 'APPR',
    resourceRequired: 3,
    plannedDay: 25,
    plannedShift: 'M',
  },
  {
    id: 'wo-13471495',
    workOrderId: '13471495',
    description: 'Signalling interlock overhaul and point machine lubrication',
    workType: 'PM',
    line: 'L5',
    department: 'SIG',
    scheduledStart: '2026-10-01',
    scheduledFinish: '2026-10-06',
    targetFinish: '2026-10-06',
    status: 'INPRG',
    resourceRequired: 2,
    plannedDay: 2,
    plannedShift: 'M',
  },
  {
    id: 'wo-13482104',
    workOrderId: '13482104',
    description: 'Line 5 Emergency brake valve diagnostic and replacement',
    workType: 'CM',
    line: 'L5',
    department: 'SLV',
    scheduledStart: '2026-10-05',
    scheduledFinish: '2026-10-08',
    targetFinish: '2026-10-08',
    status: 'APPR',
    resourceRequired: 2,
    plannedDay: 5,
    plannedShift: 'E',
  },
  {
    id: 'wo-13490012',
    workOrderId: '13490012',
    description: 'Line 4 Power sub-station breaker inspection and test',
    workType: 'PM',
    line: 'L4',
    department: 'DCS',
    scheduledStart: '2026-10-10',
    scheduledFinish: '2026-10-15',
    targetFinish: '2026-10-15',
    status: 'APPR',
    resourceRequired: 3,
    plannedDay: 11,
    plannedShift: 'M',
  },
  {
    id: 'wo-13495521',
    workOrderId: '13495521',
    description: 'Line 6 Ultrasonic rail flaw detection and weld geometry audit',
    workType: 'ACS',
    line: 'L6',
    department: 'SLV',
    scheduledStart: '2026-10-12',
    scheduledFinish: '2026-10-14',
    targetFinish: '2026-10-14',
    status: 'APPR',
    resourceRequired: 2,
    plannedDay: 13,
    plannedShift: 'N',
  },
  {
    id: 'wo-13501234',
    workOrderId: '13501234',
    description: 'Line 5 Overhead catenary tension wire adjustment',
    workType: 'PM',
    line: 'L5',
    department: 'SIG',
    scheduledStart: '2026-10-18',
    scheduledFinish: '2026-10-24',
    targetFinish: '2026-10-24',
    status: 'APPR',
    resourceRequired: 2,
    plannedDay: 19,
    plannedShift: 'M',
  },
  {
    id: 'wo-13509988',
    workOrderId: '13509988',
    description: 'Line 4 Junction switch motor recalibration',
    workType: 'CM',
    line: 'L4',
    department: 'DCS',
    scheduledStart: '2026-10-20',
    scheduledFinish: '2026-10-22',
    targetFinish: '2026-10-22',
    status: 'INPRG',
    resourceRequired: 2,
    plannedDay: 20,
    plannedShift: 'E',
  },
  {
    id: 'wo-13514055',
    workOrderId: '13514055',
    description: 'Line 6 Tunnel ventilation fan bearing service',
    workType: 'PM',
    line: 'L6',
    department: 'SLV',
    scheduledStart: '2026-10-25',
    scheduledFinish: '2026-10-29',
    targetFinish: '2026-10-29',
    status: 'APPR',
    resourceRequired: 4,
    plannedDay: 26,
    plannedShift: 'N',
  },
];
