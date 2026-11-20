// FIL amounts are plain numbers (float FIL, rounded to µFIL); exact attoFIL balances are kept as
// strings in the per-miner file.

// One vesting tranche: [epoch, FIL] unlocked at that epoch.
export type Tranche = [epoch: number, fil: number]

// Sparse FIL released per UTC day: [day, FIL], day = days since 1970-01-01 (see utcDay).
export type FilHistogram = [day: number, fil: number][]

export interface MinerSummary {
  id: string
  live: number
  faulty: number
  // Block rewards still vesting: tranches after the snapshot height.
  vesting: number
  // Rewards whose tranche has passed: unlocked and withdrawable, but LockedFunds still counts them
  // until the miner's next cron or message.
  unlocked: number
  // Initial pledge of live sectors, returned as they expire.
  pledge: number
  preCommit: number
  feeDebt: number
  // Spendable now.
  available: number
  // Next vesting unlock, if anything vests.
  next: Tranche | null
  // Vesting and pledge released within 30 days of the snapshot.
  vesting30: number
  pledge30: number
  // Epoch by which everything locked now is released (last tranche or last sector expiration).
  lastRelease: number
}

// Index file: data/miners.json.
export interface MinerIndex {
  network: string
  height: number
  genesisTimestamp: number
  fetchedAt: string
  miners: MinerSummary[]
  totals: {
    // Daily network releases from the snapshot height on.
    vesting: FilHistogram
    // Pledge of on-time expirations.
    pledge: FilHistogram
    // Pledge of faulty sectors, at their early expiration (returned minus a termination fee
    // unless the fault is recovered).
    faultyPledge: FilHistogram
  }
}

// Per-miner file: data/miners/<id>.json.
export interface MinerData {
  id: string
  height: number
  // Vesting schedule after the snapshot height: delta-coded epochs and the FIL each unlocks, in order.
  vesting: { epochs: number[]; fil: number[] }
  pledge: FilHistogram
  faultyPledge: FilHistogram
  // Exact balances in attoFIL.
  atto: {
    balance: string
    lockedFunds: string
    // Part of lockedFunds already unlocked (see MinerSummary.unlocked).
    unlocked: string
    initialPledge: string
    preCommitDeposits: string
    feeDebt: string
    available: string
  }
}
