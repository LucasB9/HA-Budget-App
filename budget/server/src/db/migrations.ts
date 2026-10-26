export interface Migration {
  version: number;
  name: string;
  sql: string;
}

/**
 * Forward-only migrations, applied in order and tracked with `PRAGMA user_version`.
 * Never edit a migration that has shipped: add a new one.
 */
export const migrations: readonly Migration[] = [
  {
    version: 1,
    name: 'core',
    sql: `
      CREATE TABLE people (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        ha_user_name TEXT,
        position INTEGER NOT NULL
      );

      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        position INTEGER NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE categories (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL REFERENCES groups(id),
        name TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('fixed','variable','provision','system')),
        planned_cents INTEGER NOT NULL DEFAULT 0,
        rollover INTEGER NOT NULL DEFAULT 0,
        fixed_day INTEGER NOT NULL DEFAULT 1,
        default_payer_id TEXT REFERENCES people(id),
        default_split TEXT NOT NULL DEFAULT 'income' CHECK (default_split IN ('income','equal','personal')),
        archived INTEGER NOT NULL DEFAULT 0,
        is_system INTEGER NOT NULL DEFAULT 0,
        position INTEGER NOT NULL
      );

      CREATE TABLE subcategories (
        id TEXT PRIMARY KEY,
        category_id TEXT NOT NULL REFERENCES categories(id),
        name TEXT NOT NULL,
        planned_cents INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0,
        position INTEGER NOT NULL
      );

      CREATE TABLE months (
        month TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        -- 1 when fixed expenses are generated for this month. Months created implicitly by a
        -- back-dated expense stay at 0 so they are not filled with "à confirmer" entries.
        fixed_enabled INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE month_incomes (
        month TEXT NOT NULL REFERENCES months(month),
        person_id TEXT NOT NULL REFERENCES people(id),
        amount_cents INTEGER NOT NULL DEFAULT 0,
        note TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (month, person_id)
      );

      -- Income weights frozen when the month is created (or explicitly recalculated).
      CREATE TABLE month_weights (
        month TEXT NOT NULL REFERENCES months(month),
        person_id TEXT NOT NULL REFERENCES people(id),
        weight INTEGER NOT NULL,
        PRIMARY KEY (month, person_id)
      );

      CREATE TABLE budget_lines (
        id TEXT PRIMARY KEY,
        month TEXT NOT NULL REFERENCES months(month),
        category_id TEXT NOT NULL REFERENCES categories(id),
        subcategory_id TEXT REFERENCES subcategories(id),
        planned_cents INTEGER NOT NULL DEFAULT 0
      );
      CREATE UNIQUE INDEX budget_lines_category_uq
        ON budget_lines (month, category_id) WHERE subcategory_id IS NULL;
      CREATE UNIQUE INDEX budget_lines_sub_uq
        ON budget_lines (month, category_id, subcategory_id) WHERE subcategory_id IS NOT NULL;

      CREATE TABLE envelope_transfers (
        id TEXT PRIMARY KEY,
        month TEXT NOT NULL REFERENCES months(month),
        from_category_id TEXT NOT NULL REFERENCES categories(id),
        to_category_id TEXT NOT NULL REFERENCES categories(id),
        amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
      CREATE INDEX envelope_transfers_month ON envelope_transfers (month);

      CREATE TABLE expenses (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        month TEXT NOT NULL REFERENCES months(month),
        amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
        category_id TEXT NOT NULL REFERENCES categories(id),
        subcategory_id TEXT REFERENCES subcategories(id),
        payer_id TEXT NOT NULL REFERENCES people(id),
        split_mode TEXT NOT NULL CHECK (split_mode IN ('income','equal','single','custom')),
        single_id TEXT REFERENCES people(id),
        custom_bp TEXT,
        note TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','pending')),
        auto INTEGER NOT NULL DEFAULT 0,
        created_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX expenses_month ON expenses (month);
      CREATE INDEX expenses_category ON expenses (category_id);
      CREATE INDEX expenses_date ON expenses (date);

      CREATE TABLE expense_shares (
        expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
        person_id TEXT NOT NULL REFERENCES people(id),
        amount_cents INTEGER NOT NULL,
        PRIMARY KEY (expense_id, person_id)
      );

      CREATE TABLE tags (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE
      );

      CREATE TABLE expense_tags (
        expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
        tag_id TEXT NOT NULL REFERENCES tags(id),
        PRIMARY KEY (expense_id, tag_id)
      );

      -- Remembers which fixed expenses were generated so a deleted one is never recreated.
      CREATE TABLE fixed_generated (
        month TEXT NOT NULL,
        category_id TEXT NOT NULL,
        subcategory_id TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (month, category_id, subcategory_id)
      );

      CREATE TABLE settlements (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        from_id TEXT NOT NULL REFERENCES people(id),
        to_id TEXT NOT NULL REFERENCES people(id),
        amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 2,
    name: 'savings',
    sql: `
      CREATE TABLE savings_accounts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT '',
        goal_cents INTEGER,
        goal_date TEXT,
        archived INTEGER NOT NULL DEFAULT 0,
        position INTEGER NOT NULL
      );

      CREATE TABLE savings_entries (
        account_id TEXT NOT NULL REFERENCES savings_accounts(id),
        month TEXT NOT NULL,
        contribution_cents INTEGER NOT NULL DEFAULT 0,
        balance_cents INTEGER,
        note TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (account_id, month)
      );
    `,
  },
  {
    version: 3,
    name: 'recaps',
    sql: `
      CREATE TABLE recaps (
        id TEXT PRIMARY KEY,
        month TEXT NOT NULL,
        created_at TEXT NOT NULL,
        model TEXT NOT NULL,
        trigger TEXT NOT NULL CHECK (trigger IN ('manual','auto')),
        content TEXT NOT NULL,
        input_tokens INTEGER,
        output_tokens INTEGER
      );
      CREATE INDEX recaps_month ON recaps (month, created_at);
    `,
  },
];
