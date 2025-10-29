
CREATE TABLE IF NOT EXISTS intents (
  id TEXT PRIMARY KEY,
  maker TEXT NOT NULL,
  sellToken TEXT NOT NULL,
  buyToken TEXT NOT NULL,
  sellAmount TEXT NOT NULL,
  minBuyAmount TEXT NOT NULL,
  deadline INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  intentIds TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  expectedProfit TEXT,
  actualProfit TEXT,
  gasUsed TEXT,
  txHash TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
