export interface BudgetTracker {
  record(costUsd: number): number;
  remaining(): number;
  isExceeded(): boolean;
}
