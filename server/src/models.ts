import mongoose, { Schema } from 'mongoose';

/**
 * Mongo documents mirror the domain types one-to-one. `id` is the app's own
 * string id (e.g. "e01"), kept as a plain field so the web app's ids survive
 * the round trip; Mongo's _id is incidental.
 */

const UserSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true },
    passwordHash: { type: String, required: true },
    name: { type: String, default: '' },
    role: { type: String, enum: ['supervisor', 'viewer'], default: 'viewer' },
  },
  { timestamps: true },
);

const LineSchema = new Schema(
  {
    id: { type: String, required: true, unique: true },
    name: String,
    prefix: String,
    order: Number,
  },
  { strict: false, timestamps: true },
);

const ShiftCodeSchema = new Schema(
  {
    key: { type: String, index: true },
    id: { type: String, required: true, index: true },
    scope: { type: String, index: true },
    label: String,
    timing: String,
    tone: String,
    minHeadcount: Number,
    countsAsEngineer: Boolean,
    rotates: Boolean,
    isStatus: Boolean,
    order: Number,
  },
  { strict: false, timestamps: true },
);

const EmployeeSchema = new Schema(
  {
    id: { type: String, required: true, unique: true },
    lineId: { type: String, index: true },
    name: String,
    role: String,
    contact: String,
    order: Number,
    defaultShift: String,
    restDays: [Number],
    rotations: { type: Schema.Types.Mixed, default: {} },
    pinned: Boolean,
    active: Boolean,
  },
  { strict: false, timestamps: true },
);

const LeaveSchema = new Schema(
  {
    id: { type: String, required: true, unique: true },
    employeeId: { type: String, index: true },
    from: String,
    to: String,
    code: String,
    note: String,
  },
  { strict: false, timestamps: true },
);

const RosterSchema = new Schema(
  {
    id: { type: String, required: true, unique: true }, // `${lineId}:${YYYY-MM}`
    lineId: { type: String, index: true },
    year: Number,
    month: Number,
    cells: { type: Schema.Types.Mixed, default: {} },
    overrides: { type: Schema.Types.Mixed, default: {} },
    extraHours: { type: Schema.Types.Mixed, default: {} },
    updatedAt: Number,
  },
  { minimize: false, strict: false, timestamps: true },
);

const WorkOrderSchema = new Schema(
  {
    id: { type: String, required: true, unique: true },
    woNumber: String,
    line: String,
    shift: String,
    scheduledStart: String,
    scheduledEnd: String,
  },
  { minimize: false, strict: false, timestamps: true },
);

const ResourceRequirementSchema = new Schema(
  {
    id: { type: String, required: true, unique: true },
  },
  { minimize: false, strict: false, timestamps: true },
);

const AllocationSchema = new Schema(
  {
    id: { type: String, required: true, unique: true },
  },
  { minimize: false, strict: false, timestamps: true },
);

const SettingsSchema = new Schema(
  {
    key: { type: String, default: 'app', unique: true },
    data: { type: Schema.Types.Mixed, default: {} },
  },
  { minimize: false, strict: false, timestamps: true },
);

const CollaboratorSchema = new Schema(
  {
    id: { type: String, required: true, unique: true },
    assignedTo: { type: String, required: true, index: true },
    passcode: { type: String, required: true, index: true },
    shareUrl: { type: String, default: '' },
    role: { type: String, enum: ['supervisor', 'collaborator', 'viewer'], default: 'collaborator' },
    status: { type: String, enum: ['active', 'revoked'], default: 'active' },
    notes: { type: String, default: '' },
    permissions: {
      type: Schema.Types.Mixed,
      default: {
        canEditRosterCells: true,
        canManageEmployees: true,
        canManageShiftCodes: true,
        canImportExportExcel: true,
        canManageWorkOrders: true,
        canRunAutoRotation: true,
      },
    },
    onlineStatus: { type: String, enum: ['online', 'offline'], default: 'offline' },
    loginCount: { type: Number, default: 0 },
    createdAtMs: { type: Number, default: () => Date.now() },
    lastLoginAt: { type: Number, default: null },
    lastLoginISO: { type: String, default: null },
    lastActiveAt: { type: Number, default: null },
    lastLogoutAt: { type: Number, default: null },
    lastDevice: { type: String, default: null },
    recentSessions: { type: [Schema.Types.Mixed], default: [] },
  },
  { minimize: false, strict: false, timestamps: true },
);

const CollabSessionSchema = new Schema(
  {
    id: { type: String, required: true, unique: true },
    collaboratorId: { type: String, index: true, default: null },
    name: { type: String, required: true, index: true },
    role: { type: String, enum: ['supervisor', 'collaborator', 'viewer'], default: 'collaborator' },
    passcodeUsed: { type: String, default: '' },
    device: { type: String, default: 'Desktop Browser' },
    status: { type: String, enum: ['online', 'offline'], default: 'online' },
    joinedAt: { type: Number, required: true },
    joinedAtISO: { type: String },
    lastActive: { type: Number, required: true },
    lastActiveISO: { type: String },
    loggedOutAt: { type: Number, default: null },
    loggedOutAtISO: { type: String, default: null },
  },
  { minimize: false, strict: false, timestamps: true },
);

const CollabNotificationSchema = new Schema(
  {
    id: { type: String, required: true, unique: true },
    type: { type: String, enum: ['login', 'logout', 'security', 'presence', 'edit'], default: 'login' },
    userName: { type: String, required: true },
    userRole: { type: String, enum: ['supervisor', 'collaborator', 'viewer'], default: 'collaborator' },
    timestamp: { type: Number, required: true, index: true },
    isoTimestamp: { type: String },
    message: { type: String, required: true },
    details: { type: String, default: '' },
    read: { type: Boolean, default: false },
  },
  { minimize: false, strict: false, timestamps: true },
);

const SecuritySettingSchema = new Schema(
  {
    key: { type: String, default: 'security', unique: true },
    adminPassword: { type: String, default: 'supervisor1' },
    requireName: { type: Boolean, default: true },
    notifyOnLogin: { type: Boolean, default: true },
    soundAlert: { type: Boolean, default: true },
    assignedPasscodes: { type: [Schema.Types.Mixed], default: [] },
    updatedAt: { type: Number, default: 0 },
    updatedAtISO: { type: String },
  },
  { minimize: false, strict: false, timestamps: true },
);

const BackupSnapshotSchema = new Schema(
  {
    id: { type: String, required: true, unique: true },
    label: { type: String, default: 'Full System Backup' },
    version: { type: Number, default: 1 },
    exportedAt: { type: String },
    updatedAtMs: { type: Number, index: true },
    summary: { type: Schema.Types.Mixed, default: {} },
    data: { type: Schema.Types.Mixed, default: {} },
  },
  { minimize: false, strict: false, timestamps: true },
);

/** Who changed what. Written by every mutating route. */
const AuditSchema = new Schema(
  {
    userId: String,
    userEmail: String,
    action: String, // e.g. "roster.cell", "employee.update", "sync.push", "collab.login"
    target: String, // e.g. "line5:2026-09 / e02 / day 4"
    before: Schema.Types.Mixed,
    after: Schema.Types.Mixed,
  },
  { timestamps: true },
);

export const User = mongoose.model('User', UserSchema);
export const Line = mongoose.model('Line', LineSchema);
export const ShiftCode = mongoose.model('ShiftCode', ShiftCodeSchema);
export const Employee = mongoose.model('Employee', EmployeeSchema);
export const Leave = mongoose.model('Leave', LeaveSchema);
export const Roster = mongoose.model('Roster', RosterSchema);
export const WorkOrder = mongoose.model('WorkOrder', WorkOrderSchema);
export const ResourceRequirement = mongoose.model('ResourceRequirement', ResourceRequirementSchema);
export const Allocation = mongoose.model('Allocation', AllocationSchema);
export const Settings = mongoose.model('Settings', SettingsSchema);
export const Collaborator = mongoose.model('Collaborator', CollaboratorSchema);
export const CollabSession = mongoose.model('CollabSession', CollabSessionSchema);
export const CollabNotification = mongoose.model('CollabNotification', CollabNotificationSchema);
export const SecuritySetting = mongoose.model('SecuritySetting', SecuritySettingSchema);
export const BackupSnapshot = mongoose.model('Backup', BackupSnapshotSchema);
export const Audit = mongoose.model('Audit', AuditSchema);
