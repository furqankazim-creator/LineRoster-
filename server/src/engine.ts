/**
 * The roster engine, imported straight from the web app's domain layer so the
 * server and the browser can never disagree about what a month looks like.
 */
export { daysInMonth, monthKey, shiftMonth } from '../../frontend/src/domain/calendar.ts';
export { generateMonth, rosterId, setCell } from '../../frontend/src/domain/generator.ts';
export { autoRotate, buildHistory, fairness } from '../../frontend/src/domain/rotation.ts';
export { summarise } from '../../frontend/src/domain/summary.ts';
export { suggestCover, validate } from '../../frontend/src/domain/validate.ts';
export type {
  Employee as DomainEmployee,
  LeaveBlock as DomainLeave,
  RosterMonth,
  ShiftCode as DomainCode,
} from '../../frontend/src/domain/types.ts';
