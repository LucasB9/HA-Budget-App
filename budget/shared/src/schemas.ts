import { z } from 'zod';
import { isIsoDate, isMonthKey } from './month.js';

export const monthKeySchema = z.string().refine(isMonthKey, 'Expected YYYY-MM');
export const isoDateSchema = z.string().refine(isIsoDate, 'Expected YYYY-MM-DD');
export const centsSchema = z.number().int().min(0).max(1_000_000_000);
export const idSchema = z.string().min(1).max(64);

export const categoryKindSchema = z.enum(['fixed', 'variable', 'provision', 'system']);
export const splitModeSchema = z.enum(['income', 'equal', 'single', 'custom']);

// ---------------------------------------------------------------- seed (amounts in euros)

const euroAmountSchema = z.number().min(0).max(10_000_000);

export const seedSchema = z.object({
  version: z.literal(1),
  people: z
    .array(
      z.object({
        name: z.string().min(1).max(40),
        monthlyIncome: euroAmountSchema,
      }),
    )
    .length(2),
  defaultSplitMode: z.enum(['income', 'equal']).default('income'),
  groups: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        categories: z.array(
          z.object({
            name: z.string().min(1).max(80),
            amount: euroAmountSchema,
            type: z.enum(['fixed', 'variable', 'provision']),
            rollover: z.boolean().default(false),
            /** Day of the month a fixed expense is created (1-31). */
            day: z.number().int().min(1).max(31).default(1),
            /** Person name who pays this fixed expense by default. */
            payer: z.string().min(1).max(40).optional(),
            /** `personal` means 100% for the payer. */
            split: z.enum(['income', 'equal', 'personal']).optional(),
            sublines: z
              .array(z.object({ name: z.string().min(1).max(80), amount: euroAmountSchema }))
              .optional(),
          }),
        ),
      }),
    ),
  savingsAccounts: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        kind: z.string().max(40).default(''),
        goalAmount: euroAmountSchema.optional(),
        goalDate: isoDateSchema.optional(),
      }),
    )
    .default([]),
});
export type Seed = z.infer<typeof seedSchema>;

// ---------------------------------------------------------------- settings

export const settingsSchema = z.object({
  defaultSplitMode: z.enum(['income', 'equal']),
  autoRecap: z.boolean(),
  savingsGoalCents: centsSchema.nullable(),
  savingsGoalDate: isoDateSchema.nullable(),
});
export type Settings = z.infer<typeof settingsSchema>;

export const peopleUpdateSchema = z.object({
  people: z
    .array(
      z.object({
        id: idSchema,
        name: z.string().min(1).max(40),
        haUserName: z.string().max(80).nullable().optional(),
      }),
    )
    .length(2),
});

// ---------------------------------------------------------------- categories

export const groupCreateSchema = z.object({ name: z.string().min(1).max(80) });
export const groupUpdateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  archived: z.boolean().optional(),
});

export const categoryCreateSchema = z.object({
  groupId: idSchema,
  name: z.string().min(1).max(80),
  kind: z.enum(['fixed', 'variable', 'provision']),
  plannedCents: centsSchema.default(0),
  rollover: z.boolean().default(false),
  fixedDay: z.number().int().min(1).max(31).default(1),
  defaultPayerId: idSchema.nullable().optional(),
  defaultSplit: z.enum(['income', 'equal', 'personal']).default('income'),
});
export const categoryUpdateSchema = z.object({
  groupId: idSchema.optional(),
  name: z.string().min(1).max(80).optional(),
  kind: z.enum(['fixed', 'variable', 'provision']).optional(),
  plannedCents: centsSchema.optional(),
  rollover: z.boolean().optional(),
  fixedDay: z.number().int().min(1).max(31).optional(),
  defaultPayerId: idSchema.nullable().optional(),
  defaultSplit: z.enum(['income', 'equal', 'personal']).optional(),
  archived: z.boolean().optional(),
});

export const subcategoryCreateSchema = z.object({
  categoryId: idSchema,
  name: z.string().min(1).max(80),
  plannedCents: centsSchema.default(0),
});
export const subcategoryUpdateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  plannedCents: centsSchema.optional(),
  archived: z.boolean().optional(),
});

export const categoryMergeSchema = z.object({ intoCategoryId: idSchema });
export const reorderSchema = z.object({
  kind: z.enum(['group', 'category']),
  /** Ordered ids. For categories, all belong to the same group. */
  ids: z.array(idSchema).min(1),
});

// ---------------------------------------------------------------- months

export const incomesUpdateSchema = z.object({
  incomes: z.array(z.object({ personId: idSchema, amountCents: centsSchema, note: z.string().max(200).default('') })).min(1),
});

export const budgetLineUpdateSchema = z.object({
  categoryId: idSchema,
  subcategoryId: idSchema.nullable().default(null),
  plannedCents: centsSchema,
  /** Also update the template used when creating future months. */
  applyToTemplate: z.boolean().default(false),
});

export const transferCreateSchema = z
  .object({
    fromCategoryId: idSchema,
    toCategoryId: idSchema,
    amountCents: centsSchema.refine((n) => n > 0, 'Amount must be positive'),
    note: z.string().max(200).default(''),
  })
  .refine((t) => t.fromCategoryId !== t.toCategoryId, 'Source and destination must differ');

// ---------------------------------------------------------------- expenses

const tagNameSchema = z.string().trim().min(1).max(40);

export const expenseInputSchema = z
  .object({
    date: isoDateSchema,
    amountCents: centsSchema.refine((n) => n > 0, 'Amount must be positive'),
    categoryId: idSchema,
    subcategoryId: idSchema.nullable().default(null),
    payerId: idSchema,
    splitMode: splitModeSchema.default('income'),
    /** For `single`: the person bearing the expense. */
    singleId: idSchema.nullable().default(null),
    /** For `custom`: basis points per person id, summing to 10000. */
    customBp: z.record(idSchema, z.number().int().min(0).max(10000)).nullable().default(null),
    tags: z.array(tagNameSchema).max(10).default([]),
    note: z.string().max(500).default(''),
  })
  .superRefine((e, ctx) => {
    if (e.splitMode === 'single' && !e.singleId) {
      ctx.addIssue({ code: 'custom', path: ['singleId'], message: 'singleId required' });
    }
    if (e.splitMode === 'custom') {
      const total = Object.values(e.customBp ?? {}).reduce((a, b) => a + b, 0);
      if (total !== 10000) {
        ctx.addIssue({ code: 'custom', path: ['customBp'], message: 'Percentages must sum to 100%' });
      }
    }
  });
export type ExpenseInput = z.infer<typeof expenseInputSchema>;

export const expenseQuerySchema = z.object({
  month: monthKeySchema.optional(),
  categoryId: idSchema.optional(),
  tag: z.string().max(40).optional(),
  personId: idSchema.optional(),
  q: z.string().max(100).optional(),
  status: z.enum(['confirmed', 'pending']).optional(),
});

export const confirmExpenseSchema = z.object({
  amountCents: centsSchema.refine((n) => n > 0).optional(),
});

// ---------------------------------------------------------------- settlements

export const settlementCreateSchema = z
  .object({
    date: isoDateSchema,
    fromId: idSchema,
    toId: idSchema,
    amountCents: centsSchema.refine((n) => n > 0, 'Amount must be positive'),
    note: z.string().max(200).default(''),
  })
  .refine((s) => s.fromId !== s.toId, 'Payer and receiver must differ');

// ---------------------------------------------------------------- savings

export const savingsAccountCreateSchema = z.object({
  name: z.string().min(1).max(80),
  kind: z.string().max(40).default(''),
  goalCents: centsSchema.nullable().default(null),
  goalDate: isoDateSchema.nullable().default(null),
});
export const savingsAccountUpdateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  kind: z.string().max(40).optional(),
  goalCents: centsSchema.nullable().optional(),
  goalDate: isoDateSchema.nullable().optional(),
  archived: z.boolean().optional(),
});
export const savingsEntryUpsertSchema = z.object({
  accountId: idSchema,
  month: monthKeySchema,
  /** Negative values are withdrawals. */
  contributionCents: z.number().int().min(-1_000_000_000).max(1_000_000_000),
  balanceCents: centsSchema.nullable().default(null),
  note: z.string().max(200).default(''),
});

// ---------------------------------------------------------------- recap

export const recapRequestSchema = z.object({ month: monthKeySchema });
