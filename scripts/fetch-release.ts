// Snapshot when every miner's locked FIL is released into a data repo: <out>/miners.json (index)
// and <out>/miners/<id>.json (one per miner with anything still to be released).
// - Block rewards: the miner's vesting table (VestingFunds Head + Tail), one tranche per 12 h.
//   Tranches before the snapshot height are already unlocked, though LockedFunds still counts them
//   until the miner's next cron or message.
// - Initial pledge: per live sector, returned at its expiration (faulty ones at early expiration).
// Usage: [LOTUS_API=http://host:1234/rpc/v1] node scripts/fetch-release.ts --out <data repo> [--commit] [--allow-stale]
import { execFileSync } from 'node:child_process'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { decodeRuns, encodeRuns, type Runs } from '../src/lib/bitfield.ts'
import { decodeBigInt, decodeCbor, type Cbor } from '../src/lib/cbor.ts'
import { deltaEncode } from '../src/lib/delta.ts'
import { addHistogram, attoHistogram, attoToFil, roundFil, sumFil, utcDay } from '../src/lib/release.ts'
import type { FilHistogram, MinerData, MinerIndex, MinerSummary, Tranche } from '../src/lib/types.ts'

const { values: args } = parseArgs({
  options: {
    out: { type: 'string' },
    commit: { type: 'boolean', default: false },
    'allow-stale': { type: 'boolean', default: false },
  },
})
if (!args.out) throw new Error('--out <data repo directory> is required')
const OUT_PATH = resolve(args.out)
const DATA_DIR = pathToFileURL(`${OUT_PATH}/`)
const MINERS_DIR = new URL('miners/', DATA_DIR)

// Each data repo declares its network; never write one network's data into another's repo.
const dataset = JSON.parse(await readFile(new URL('dataset.json', DATA_DIR), 'utf8')) as { network: string }
// Local nodes per network; LOTUS_API overrides. The network-name check below catches a wrong port.
const DEFAULT_API: Record<string, string> = {
  calibrationnet: 'http://192.168.50.123:1235/rpc/v1',
  mainnet: 'http://192.168.50.123:1234/rpc/v1',
}
const API =
  process.env.LOTUS_API ??
  DEFAULT_API[dataset.network] ??
  (() => {
    throw new Error(`LOTUS_API must be set for ${dataset.network}`)
  })()
const CONCURRENCY = 32
// Per-miner parallelism for StateSectorExpiration lookups (runs inside the miner pool).
const EXPIRATION_BATCH = 32
// A head older than this means the node is still syncing; the snapshot height would be wrong.
const MAX_HEAD_LAG_SECONDS = 600
// Sectors per StateMinerSectors request.
const SECTORS_CHUNK = 50_000
const DEADLINES = 48
// Live sector pledge may differ from InitialPledge by this share before the run warns.
const PLEDGE_TOLERANCE = 0.001

let rpcId = 0
// Pauses before each retry, so a short node hiccup doesn't end a long run.
const RETRY_DELAYS_MS = [1_000, 5_000]
async function rpc<T>(method: string, params: unknown[], attempts = RETRY_DELAYS_MS.length + 1): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: `Filecoin.${method}`, params, id: ++rpcId }),
      })
      const body = (await res.json()) as { result?: T; error?: { message: string } }
      if (body.error) throw new Error(`${method}: ${body.error.message}`)
      return body.result as T
    } catch (err) {
      if (attempt >= attempts) {
        const cause = (err as { cause?: { code?: string } }).cause?.code
        throw cause ? new Error(`${method}: cannot reach ${API} (${cause})`) : err
      }
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt - 1]))
    }
  }
}

async function pool<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i])
      }
    }),
  )
  return out
}

interface MinerState {
  LockedFunds: string
  InitialPledge: string
  PreCommitDeposits: string
  FeeDebt: string
  VestingFunds: { Head: { Epoch: number; Amount: string }; Tail: { '/': string } } | null
}

interface Partition {
  LiveSectors: Runs
  FaultySectors: Runs
}

interface OnChainSector {
  SectorNumber: number
  Expiration: number
  InitialPledge: string
}

// Head plus the Tail table, a CBOR array of [epoch, amount] in epoch order.
async function vestingSchedule(state: MinerState): Promise<{ epochs: number[]; atto: bigint[] }> {
  const epochs: number[] = []
  const atto: bigint[] = []
  const v = state.VestingFunds
  if (!v) return { epochs, atto }
  const head = BigInt(v.Head.Amount)
  if (head > 0n) {
    epochs.push(v.Head.Epoch)
    atto.push(head)
  }
  const raw = await rpc<string>('ChainReadObj', [v.Tail])
  const tail = decodeCbor(Buffer.from(raw, 'base64')) as Cbor[]
  for (const entry of tail) {
    const [epoch, amount] = entry as [number, Uint8Array]
    epochs.push(epoch)
    atto.push(decodeBigInt(amount))
  }
  return { epochs, atto }
}

// Pledge per live sector by effective release epoch: on-time expiration, or early expiration
// for faulty sectors.
async function sectorPledge(id: string, tsk: unknown, genesisTimestamp: number) {
  const live: number[] = []
  const faulty: number[] = []
  for (let dl = 0; dl < DEADLINES; dl++) {
    const parts = await rpc<Partition[] | null>('StateMinerPartitions', [id, dl, tsk])
    for (const p of parts ?? []) {
      live.push(...decodeRuns(p.LiveSectors))
      faulty.push(...decodeRuns(p.FaultySectors))
    }
  }
  live.sort((a, b) => a - b)
  faulty.sort((a, b) => a - b)

  // Ask for live sectors only, in chunks, so miners with hundreds of thousands of sectors
  // don't produce one huge response.
  const onChain = new Map<number, OnChainSector>()
  for (let i = 0; i < live.length; i += SECTORS_CHUNK) {
    const filter = encodeRuns(live.slice(i, i + SECTORS_CHUNK))
    for (const s of (await rpc<OnChainSector[] | null>('StateMinerSectors', [id, filter, tsk])) ?? []) onChain.set(s.SectorNumber, s)
  }

  // Faulty sectors sit in the early-expiration queue: they get terminated at Early unless recovered.
  const early = new Map<number, number>()
  for (let i = 0; i < faulty.length; i += EXPIRATION_BATCH) {
    const batch = faulty.slice(i, i + EXPIRATION_BATCH)
    const res = await Promise.all(batch.map((n) => rpc<{ Early: number }>('StateSectorExpiration', [id, n, tsk])))
    res.forEach((r, j) => early.set(batch[j], r.Early || onChain.get(batch[j])!.Expiration))
  }

  let total = 0n
  let lastExpiration = 0
  const onTime: [number, bigint][] = []
  const atEarly: [number, bigint][] = []
  for (const n of live) {
    const s = onChain.get(n)!
    const pledge = BigInt(s.InitialPledge)
    total += pledge
    const e = early.get(n)
    const epoch = e === undefined ? s.Expiration : Math.min(s.Expiration, e)
    ;(e === undefined ? onTime : atEarly).push([epoch, pledge])
    lastExpiration = Math.max(lastExpiration, epoch)
  }
  return { live: live.length, faulty: faulty.length, total, lastExpiration, pledge: attoHistogram(onTime, genesisTimestamp), faultyPledge: attoHistogram(atEarly, genesisTimestamp) }
}

const toFil = (atto: string | bigint) => attoToFil(atto)
const NONE = { live: 0, faulty: 0, total: 0n, lastExpiration: 0, pledge: [] as FilHistogram, faultyPledge: [] as FilHistogram }

async function fetchMiner(id: string, state: MinerState, tsk: unknown, height: number, genesisTimestamp: number) {
  const started = Date.now()
  const vest = await vestingSchedule(state)
  // Unlocked like Lotus' VestedFunds: every tranche before the current epoch.
  const due = vest.epochs.findIndex((e) => e >= height)
  const split = due < 0 ? vest.epochs.length : due
  const future = { epochs: vest.epochs.slice(split), atto: vest.atto.slice(split) }
  const unlocked = vest.atto.slice(0, split).reduce((a, b) => a + b, 0n)
  // Only rewards already unlocked (or nothing at all) and fee debt: nothing left to release.
  if (future.epochs.length === 0 && state.InitialPledge === '0' && state.PreCommitDeposits === '0') return null

  const balance = (await rpc<{ Balance: string }>('StateGetActor', [id, tsk])).Balance
  const available = await rpc<string>('StateMinerAvailableBalance', [id, tsk])
  const sectors = state.InitialPledge !== '0' ? await sectorPledge(id, tsk, genesisTimestamp) : NONE

  const warnings: string[] = []
  const vested = vest.atto.reduce((a, b) => a + b, 0n)
  if (vested !== BigInt(state.LockedFunds)) {
    warnings.push(`vesting table sums to ${toFil(vested)} FIL, LockedFunds is ${toFil(state.LockedFunds)} FIL`)
  }
  const pledge = BigInt(state.InitialPledge)
  const off = pledge > 0n ? Math.abs(Number(sectors.total - pledge) / Number(pledge)) : sectors.total > 0n ? 1 : 0
  if (off > PLEDGE_TOLERANCE) {
    warnings.push(`live sector pledge sums to ${toFil(sectors.total)} FIL, InitialPledge is ${toFil(pledge)} FIL`)
  }

  const fil = future.atto.map(toFil)
  const data: MinerData = {
    id,
    height,
    vesting: { epochs: deltaEncode(future.epochs), fil },
    pledge: sectors.pledge,
    faultyPledge: sectors.faultyPledge,
    atto: {
      balance,
      lockedFunds: state.LockedFunds,
      unlocked: unlocked.toString(),
      initialPledge: state.InitialPledge,
      preCommitDeposits: state.PreCommitDeposits,
      feeDebt: state.FeeDebt,
      available,
    },
  }
  await writeFile(new URL(`${id}.json`, MINERS_DIR), JSON.stringify(data))

  const in30 = utcDay(height, genesisTimestamp) + 30
  const vestingHist = attoHistogram(future.epochs.map((e, i) => [e, future.atto[i]]), genesisTimestamp)
  const next: Tranche | null = future.epochs.length ? [future.epochs[0], fil[0]] : null
  const summary: MinerSummary = {
    id,
    live: sectors.live,
    faulty: sectors.faulty,
    vesting: toFil(BigInt(state.LockedFunds) - unlocked),
    unlocked: toFil(unlocked),
    pledge: toFil(state.InitialPledge),
    preCommit: toFil(state.PreCommitDeposits),
    feeDebt: toFil(state.FeeDebt),
    available: toFil(available),
    next,
    vesting30: sumFil(vestingHist, in30),
    pledge30: roundFil(sumFil(sectors.pledge, in30) + sumFil(sectors.faultyPledge, in30)),
    lastRelease: Math.max(future.epochs.at(-1) ?? 0, sectors.lastExpiration),
  }
  return { summary, vesting: vestingHist, pledge: sectors.pledge, faultyPledge: sectors.faultyPledge, warnings, seconds: (Date.now() - started) / 1000 }
}

const network = await rpc<string>('StateNetworkName', [])
if (network !== dataset.network) {
  throw new Error(`node at ${API} is on ${network}, but ${OUT_PATH} holds ${dataset.network} data`)
}
const head = await rpc<{ Cids: unknown; Height: number; Blocks: { Timestamp: number }[] }>('ChainHead', [])
const genesis = await rpc<{ Blocks: { Timestamp: number }[] }>('ChainGetGenesis', [])
const tsk = head.Cids
const genesisTimestamp = genesis.Blocks[0].Timestamp
const lag = Math.round(Date.now() / 1000 - head.Blocks[0].Timestamp)
console.log(`${network} @ ${head.Height} (head ${lag}s old)`)
if (lag > MAX_HEAD_LAG_SECONDS && !args['allow-stale']) {
  throw new Error(`node not synced: head ${head.Height} is ${Math.round(lag / 60)} min behind (--allow-stale to override)`)
}
const runStarted = Date.now()

const all = await rpc<string[]>('StateListMiners', [tsk])
// Mainnet lists hundreds of thousands of miner actors; most have nothing locked. Reading every
// state (not just sector counts) also finds miners whose rewards still vest after their last
// sector is gone.
let scanned = 0
const states = await pool(all, async (id): Promise<MinerState | null> => {
  const s = (await rpc<{ State: MinerState }>('StateReadState', [id, tsk])).State
  if (++scanned % 50_000 === 0) console.log(`  scanned ${scanned}/${all.length}`)
  // Keep only what's needed: the full states of every actor would take a lot of memory.
  const { LockedFunds, InitialPledge, PreCommitDeposits, FeeDebt, VestingFunds } = s
  // Fee debt alone isn't locked: dead miners keep it forever.
  if ([LockedFunds, InitialPledge, PreCommitDeposits].every((v) => v === '0')) return null
  return { LockedFunds, InitialPledge, PreCommitDeposits, FeeDebt, VestingFunds }
})
const locked = all.flatMap((id, i) => (states[i] ? [{ id, state: states[i] }] : []))
console.log(`${all.length} miners, ${locked.length} with locked funds`)
await mkdir(MINERS_DIR, { recursive: true })

const vestingPerDay = new Map<number, number>()
const pledgePerDay = new Map<number, number>()
const faultyPerDay = new Map<number, number>()
const warned: string[] = []
let done = 0
const fetched = await pool(locked, async ({ id, state }) => {
  const r = await fetchMiner(id, state, tsk, head.Height, genesisTimestamp)
  ++done
  if (!r) return null
  addHistogram(vestingPerDay, r.vesting)
  addHistogram(pledgePerDay, r.pledge)
  addHistogram(faultyPerDay, r.faultyPledge)
  for (const w of r.warnings) {
    warned.push(id)
    console.warn(`  warning ${id}: ${w}`)
  }
  const s = r.summary
  console.log(
    `  ${done}/${locked.length} ${id}: ${s.vesting} FIL vesting, ${s.pledge} FIL pledge, ${s.live} sectors, ${r.seconds.toFixed(1)}s`,
  )
  return s
})
const miners = fetched.filter((s) => s !== null)
miners.sort((a, b) => b.vesting + b.pledge - (a.vesting + a.pledge))

// Clear stale miner files but keep the directory, so a running dev server keeps serving it.
const minerIds = new Set(miners.map((m) => m.id))
for (const f of await readdir(MINERS_DIR)) {
  if (f.endsWith('.json') && !minerIds.has(f.slice(0, -5))) await rm(new URL(f, MINERS_DIR))
}

const sortedHist = (m: Map<number, number>): FilHistogram => [...m].sort((a, b) => a[0] - b[0]).map(([d, f]) => [d, roundFil(f)])
const index: MinerIndex = {
  network,
  height: head.Height,
  genesisTimestamp,
  fetchedAt: new Date().toISOString(),
  miners,
  totals: { vesting: sortedHist(vestingPerDay), pledge: sortedHist(pledgePerDay), faultyPledge: sortedHist(faultyPerDay) },
}
await writeFile(new URL('miners.json', DATA_DIR), JSON.stringify(index))

const total = (k: 'vesting' | 'pledge' | 'unlocked') => Math.round(miners.reduce((a, m) => a + m[k], 0))
console.log(
  `wrote ${OUT_PATH}/miners.json and ${miners.length} miner files: ${total('vesting')} FIL vesting,` +
    ` ${total('pledge')} FIL pledge, ${total('unlocked')} FIL unlocked but still in LockedFunds, ${new Set(warned).size} miners with warnings, ${Math.round((Date.now() - runStarted) / 1000)}s`,
)

// One commit per snapshot keeps the full history locally; publish.sh pushes only the latest
// tree to GitHub, as a single parentless commit.
if (args.commit) {
  const git = (...a: string[]) => execFileSync('git', ['-C', OUT_PATH, ...a], { encoding: 'utf8' }).trim()
  git('add', '-A')
  const message = `snapshot ${network} @ ${head.Height} (${index.fetchedAt.slice(0, 10)})`
  git('commit', '--quiet', '-m', message)
  console.log(`committed ${git('rev-parse', '--short', 'HEAD')} ${message}`)
}
