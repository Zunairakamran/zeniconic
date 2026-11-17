/**
 * `@zeniconic/ledger` — persisted, append-only cost ledger.
 *
 * Every cloud call (agent, tagging, review, planning, …) appends one entry.
 * The host reads the totals for Settings and calls `evaluate` before a request
 * so a cap is enforced across restarts, not just for the life of a process.
 *
 * Dependency-free except Node builtins: this must load in the Electron main
 * process without pulling the AI client in.
 */
export type {
  BudgetCaps,
  CapCheckInput,
  CapEvaluation,
  CapReason,
  CostLedgerErrorCode,
  CostLedgerOptions,
  CostSummary,
  LedgerEntry,
  LedgerFile,
  RecordEntryInput,
} from './types';

export {
  COST_LEDGER_FILE,
  COST_LEDGER_VERSION,
  CostLedger,
  CostLedgerError,
  makeEntryId,
  roundUsd,
  sanitiseLedgerEntry,
} from './store';
