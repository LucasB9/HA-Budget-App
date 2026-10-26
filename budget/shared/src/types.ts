import type { BudgetStatus, CategoryKind } from './budget.js';
import type { Debt } from './balance.js';
import type { Cents } from './money.js';
import type { Settings } from './schemas.js';
import type { PersonId, SplitMode } from './split.js';

// DTOs shared by the API and the web client. All money values are integer cents.

export interface PersonDto {
  id: PersonId;
  name: string;
  haUserName: string | null;
  position: number;
}

export interface SessionDto {
  people: PersonDto[];
  /** Person matched from the Home Assistant ingress user headers, if any. */
  me: PersonId | null;
  haUser: { id: string | null; name: string | null; displayName: string | null } | null;
  needsSetup: boolean;
  settings: Settings;
  version: string;
  aiConfigured: boolean;
  today: string;
  currentMonth: string;
}

export interface SubcategoryDto {
  id: string;
  categoryId: string;
  name: string;
  plannedCents: Cents;
  archived: boolean;
  position: number;
}

export type DefaultSplit = 'income' | 'equal' | 'personal';

export interface CategoryDto {
  id: string;
  groupId: string;
  name: string;
  kind: CategoryKind;
  /** Template amount; the sum of its sub-lines when it has some. */
  plannedCents: Cents;
  rollover: boolean;
  fixedDay: number;
  defaultPayerId: PersonId | null;
  defaultSplit: DefaultSplit;
  archived: boolean;
  isSystem: boolean;
  position: number;
  subcategories: SubcategoryDto[];
}

export interface GroupDto {
  id: string;
  name: string;
  archived: boolean;
  position: number;
  categories: CategoryDto[];
}

export interface IncomeDto {
  personId: PersonId;
  amountCents: Cents;
  note: string;
}

export interface MonthDto {
  month: string;
  incomes: IncomeDto[];
  /** Weights frozen when the month was created (or last recalculated). */
  weights: Record<PersonId, number>;
  /** Fractions derived from the frozen weights, summing to 1. */
  ratio: Record<PersonId, number>;
  /** True when the current incomes would produce a different ratio than the frozen one. */
  ratioStale: boolean;
}

export interface ExpenseDto {
  id: string;
  date: string;
  month: string;
  amountCents: Cents;
  categoryId: string;
  subcategoryId: string | null;
  payerId: PersonId;
  splitMode: SplitMode;
  singleId: PersonId | null;
  customBp: Record<PersonId, number> | null;
  shares: Record<PersonId, Cents>;
  tags: string[];
  note: string;
  status: 'confirmed' | 'pending';
  auto: boolean;
  createdBy: string | null;
  createdAt: string;
}

export interface TransferDto {
  id: string;
  month: string;
  fromCategoryId: string;
  toCategoryId: string;
  amountCents: Cents;
  note: string;
  createdAt: string;
}

export interface DashboardSubLine {
  subcategoryId: string;
  name: string;
  planned: Cents;
  spent: Cents;
}

export interface DashboardCategory {
  categoryId: string;
  groupId: string;
  name: string;
  kind: CategoryKind;
  isSystem: boolean;
  planned: Cents;
  transfersIn: Cents;
  transfersOut: Cents;
  carryIn: Cents;
  effective: Cents;
  spent: Cents;
  remaining: Cents;
  /** spent / effective, capped at 10. */
  ratio: number;
  status: BudgetStatus;
  projected: Cents;
  expenseCount: number;
  pendingCount: number;
  subLines: DashboardSubLine[];
}

export interface DashboardGroup {
  groupId: string;
  name: string;
  planned: Cents;
  effective: Cents;
  spent: Cents;
  remaining: Cents;
  ratio: number;
  status: BudgetStatus;
  categories: DashboardCategory[];
}

export interface DashboardTotals {
  planned: Cents;
  effective: Cents;
  spent: Cents;
  remaining: Cents;
  projected: Cents;
  income: Cents;
  /** income - planned: what is meant to be saved/allocated. */
  plannedBalance: Cents;
  /** income - spent so far. */
  actualBalance: Cents;
  savingsContributions: Cents;
  savingsRate: number | null;
}

export interface DashboardDto {
  month: string;
  position: 'past' | 'current' | 'future';
  groups: DashboardGroup[];
  totals: DashboardTotals;
  imprevusCount: number;
  imprevusCents: Cents;
  pendingCount: number;
}

export interface BalanceSummary {
  net: Record<PersonId, Cents>;
  debt: Debt | null;
}

export interface SettlementDto {
  id: string;
  date: string;
  fromId: PersonId;
  toId: PersonId;
  amountCents: Cents;
  note: string;
  createdAt: string;
}

export interface BalanceDto {
  month: string;
  /** Ratio frozen for the requested month. */
  ratio: Record<PersonId, number>;
  monthBalance: BalanceSummary;
  overallBalance: BalanceSummary;
  /** "À confirmer" expenses of the month: they are excluded from every balance until confirmed. */
  pendingCount: number;
  pendingCents: Cents;
  /** Amount each person actually paid / bore in the month (confirmed expenses only). */
  monthPaid: Record<PersonId, Cents>;
  monthShare: Record<PersonId, Cents>;
  settlements: SettlementDto[];
}

export interface TagSummaryRow {
  tag: string;
  totalCents: Cents;
  count: number;
  byMonth: Record<string, Cents>;
  byCategory: Record<string, Cents>;
}

export interface ApiError {
  error: string;
  message: string;
  issues?: unknown;
}

// ---------------------------------------------------------------- savings

export interface SavingsAccountDto {
  id: string;
  name: string;
  kind: string;
  goalCents: Cents | null;
  goalDate: string | null;
  archived: boolean;
  position: number;
  /** Sum of every monthly contribution (withdrawals are negative). */
  contributionsCents: Cents;
  latestBalanceCents: Cents | null;
  latestBalanceMonth: string | null;
  /** Latest known balance, else cumulative contributions. */
  currentCents: Cents;
  /** currentCents / goalCents, or null without a goal. */
  progress: number | null;
}

export interface SavingsEntryDto {
  accountId: string;
  month: string;
  contributionCents: Cents;
  balanceCents: Cents | null;
  note: string;
}

export interface SavingsSeriesPoint {
  month: string;
  /** Contributions of that month, all accounts. */
  contributionCents: Cents;
  /** Cumulative contributions, all accounts. */
  cumulativeCents: Cents;
  /** Cumulative contributions per account id. */
  perAccount: Record<string, Cents>;
  /**
   * Total value: last known balance per account (carried forward), or cumulative contributions for
   * an account without snapshot. Null until a first snapshot exists.
   */
  balanceCents: Cents | null;
}

export interface SavingsMonthStat {
  month: string;
  incomeCents: Cents;
  /** income - planned expenses: what the budget meant to set aside. Null if the month has no budget. */
  plannedCents: Cents | null;
  contributionCents: Cents;
  /** contributions / income. */
  rate: number | null;
}

export interface SavingsGoalDto {
  targetCents: Cents;
  date: string | null;
  currentCents: Cents;
  progress: number;
}

export interface SavingsOverviewDto {
  accounts: SavingsAccountDto[];
  entries: SavingsEntryDto[];
  series: SavingsSeriesPoint[];
  monthStats: SavingsMonthStat[];
  goal: SavingsGoalDto | null;
}

// ---------------------------------------------------------------- recap

export interface RecapDto {
  id: string;
  month: string;
  createdAt: string;
  model: string;
  trigger: 'manual' | 'auto';
  /** Markdown, in French. */
  content: string;
  inputTokens: number | null;
  outputTokens: number | null;
}
