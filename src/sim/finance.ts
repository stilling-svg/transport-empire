/** Money, loan and the monthly/yearly accounts (GDD 6.2 and 6.3). */
import economy from '../data/economy.json' with { type: 'json' };

export const LEDGER_KEYS = ['income', 'running', 'maintenance', 'construction', 'purchases', 'interest'] as const;
export type LedgerKey = (typeof LEDGER_KEYS)[number];
export type Ledger = Record<LedgerKey, number>;

export const LEDGER_LABELS: Record<LedgerKey, string> = {
  income: 'Deliveries',
  running: 'Vehicle running costs',
  maintenance: 'Track and road upkeep',
  construction: 'Construction',
  purchases: 'New vehicles',
  interest: 'Loan interest',
};

const emptyLedger = (): Ledger => ({
  income: 0,
  running: 0,
  maintenance: 0,
  construction: 0,
  purchases: 0,
  interest: 0,
});

/** Profit of a ledger: income minus everything else. */
export function ledgerTotal(l: Ledger): number {
  return l.income - l.running - l.maintenance - l.construction - l.purchases - l.interest;
}

export class Finance {
  money: number = economy.startMoney;
  loan = 0;
  readonly maxLoan: number = economy.maxLoan;
  readonly loanStep: number = economy.loanStep;
  thisMonth: Ledger = emptyLedger();
  lastMonth: Ledger = emptyLedger();
  thisYear: Ledger = emptyLedger();
  lastYear: Ledger = emptyLedger();

  canAfford(cost: number): boolean {
    return cost <= this.money;
  }

  /** Records a cost (a negative amount records a refund). */
  spend(key: Exclude<LedgerKey, 'income'>, amount: number): void {
    this.money -= amount;
    this.thisMonth[key] += amount;
    this.thisYear[key] += amount;
  }

  earn(amount: number): void {
    this.money += amount;
    this.thisMonth.income += amount;
    this.thisYear.income += amount;
  }

  borrow(): boolean {
    if (this.loan + this.loanStep > this.maxLoan) return false;
    this.loan += this.loanStep;
    this.money += this.loanStep;
    return true;
  }

  repay(): boolean {
    if (this.loan < this.loanStep || this.money < this.loanStep) return false;
    this.loan -= this.loanStep;
    this.money -= this.loanStep;
    return true;
  }

  /** Monthly interest on the loan. */
  chargeInterest(): void {
    if (this.loan > 0) this.spend('interest', Math.round((this.loan * economy.interestRate) / 12));
  }

  /** Starts a new month (and a new year when `newYear`). */
  rollMonth(newYear: boolean): void {
    this.lastMonth = this.thisMonth;
    this.thisMonth = emptyLedger();
    if (newYear) {
      this.lastYear = this.thisYear;
      this.thisYear = emptyLedger();
    }
  }
}
