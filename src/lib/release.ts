import { deltaDecode } from './delta.ts'
import { EPOCH_SECONDS } from './epochs.ts'
import type { FilHistogram, MinerData, Tranche } from './types.ts'

const DAY_SECONDS = 86_400

// attoFIL to FIL, rounded to µFIL to keep the data files small.
export function attoToFil(atto: bigint | string): number {
  const v = BigInt(atto)
  return Number(v / 10n ** 12n) / 1e6
}

export function roundFil(fil: number): number {
  return Math.round(fil * 1e6) / 1e6
}

// UTC calendar day of an epoch, as days since 1970-01-01. Genesis isn't at midnight (mainnet
// 22:00, calibnet 18:13), so days can't be counted in epochs from genesis.
export function utcDay(epoch: number, genesisTimestamp: number): number {
  return Math.floor((genesisTimestamp + epoch * EPOCH_SECONDS) / DAY_SECONDS)
}

// First epoch at or after the UTC midnight that starts a day.
export function dayStartEpoch(day: number, genesisTimestamp: number): number {
  return Math.ceil((day * DAY_SECONDS - genesisTimestamp) / EPOCH_SECONDS)
}

// YYYY-MM-DD of a UTC day.
export function dayDate(day: number): string {
  return new Date(day * DAY_SECONDS * 1000).toISOString().slice(0, 10)
}

function sortedDays(days: Map<number, number>): FilHistogram {
  return [...days].sort((a, b) => a[0] - b[0]).map(([d, fil]) => [d, roundFil(fil)])
}

// Sums [epoch, FIL] pairs into a daily histogram.
export function filHistogram(pairs: Iterable<[number, number]>, genesisTimestamp: number): FilHistogram {
  const days = new Map<number, number>()
  for (const [epoch, fil] of pairs) {
    const d = utcDay(epoch, genesisTimestamp)
    days.set(d, (days.get(d) ?? 0) + fil)
  }
  return sortedDays(days)
}

// Same from exact attoFIL, converted once per day so per-sector rounding doesn't add up.
export function attoHistogram(pairs: Iterable<[number, bigint]>, genesisTimestamp: number): FilHistogram {
  const days = new Map<number, bigint>()
  for (const [epoch, atto] of pairs) {
    const d = utcDay(epoch, genesisTimestamp)
    days.set(d, (days.get(d) ?? 0n) + atto)
  }
  return [...days].sort((a, b) => a[0] - b[0]).map(([d, atto]) => [d, attoToFil(atto)])
}

export function addHistogram(into: Map<number, number>, hist: FilHistogram) {
  for (const [d, fil] of hist) into.set(d, (into.get(d) ?? 0) + fil)
}

export function sumFil(hist: FilHistogram, beforeDay = Infinity): number {
  let s = 0
  for (const [d, fil] of hist) if (d < beforeDay) s += fil
  return roundFil(s)
}

export function vestingTranches(data: MinerData): Tranche[] {
  return deltaDecode(data.vesting.epochs).map((epoch, i) => [epoch, data.vesting.fil[i]])
}

// FIL still locked over time: each point holds from its epoch until the next point. A day's
// releases leave at the end of that day; ones already due leave at the end of the snapshot day,
// as in the daily bars.
export interface LockedPoint {
  epoch: number
  fil: number
}

export function lockedCurve(hist: FilHistogram, startEpoch: number, genesisTimestamp: number): LockedPoint[] {
  const today = utcDay(startEpoch, genesisTimestamp)
  let left = hist.reduce((sum, [, f]) => sum + f, 0)
  const points: LockedPoint[] = [{ epoch: startEpoch, fil: left }]
  for (const [d, f] of hist) {
    left -= f
    points.push({ epoch: dayStartEpoch(Math.max(d, today) + 1, genesisTimestamp), fil: Math.max(0, left) })
  }
  return points
}

export function lockedAt(points: LockedPoint[], epoch: number): number {
  let lo = 0
  let hi = points.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (points[mid].epoch <= epoch) lo = mid
    else hi = mid - 1
  }
  return points[lo].fil
}

export function mergeHistograms(...hists: FilHistogram[]): FilHistogram {
  const days = new Map<number, number>()
  for (const h of hists) addHistogram(days, h)
  return sortedDays(days)
}
