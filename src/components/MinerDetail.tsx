import { epochDate, epochDateTime, fil, formatCount, formatWhen } from '../lib/format'
import { attoToFil, dayDate, sumFil, vestingTranches } from '../lib/release'
import type { MinerData, MinerIndex, MinerSummary } from '../lib/types'

interface Props {
  summary: MinerSummary
  data: MinerData
  index: MinerIndex
}

// Upcoming tranches listed in the "next releases" card.
const NEXT_SHOWN = 3

// One miner: what unlocks next and when, its locked balances, and the full vesting schedule.
function MinerDetail({ summary: m, data, index }: Props) {
  const g = index.genesisTimestamp
  const tranches = vestingTranches(data)
  const hasPledge = data.pledge.length + data.faultyPledge.length > 0
  const lastPledge = Math.max(data.pledge.at(-1)?.[0] ?? 0, data.faultyPledge.at(-1)?.[0] ?? 0)
  // Running total unlocked through each tranche.
  const cumulative: number[] = []
  tranches.forEach(([, f], i) => cumulative.push((cumulative[i - 1] ?? 0) + f))

  return (
    <div className="miner-detail">
      <div className="cards">
        <div className="card">
          <div className="card-title">Next reward unlock</div>
          {tranches.length === 0 ? (
            <div className="muted">Nothing vesting.</div>
          ) : (
            <>
              <div className="card-big">{fil(tranches[0][1])}</div>
              <div>
                <strong>{formatWhen(tranches[0][0] - index.height)}</strong> ·{' '}
                <span className="muted">
                  {epochDateTime(tranches[0][0], g)} · epoch {tranches[0][0]}
                </span>
              </div>
              <ul className="next-list">
                {tranches.slice(1, NEXT_SHOWN + 1).map(([e, f]) => (
                  <li key={e}>
                    {fil(f)} <span className="muted">{formatWhen(e - index.height)} · {epochDateTime(e, g)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        <div className="card">
          <div className="card-title">Block rewards vesting</div>
          <div className="card-big">{fil(m.vesting)}</div>
          <div className="muted">
            {tranches.length > 0
              ? `${tranches.length} tranches every 12 h · last ${epochDate(tranches.at(-1)![0], g)}`
              : 'none'}
          </div>
          <div className="muted">{fil(m.vesting30)} unlocks within 30 d</div>
          {m.unlocked > 0 && (
            <div className="muted">
              {fil(m.unlocked)} more already unlocked and withdrawable, still in LockedFunds until the miner's next
              cron or message
            </div>
          )}
        </div>
        <div className="card">
          <div className="card-title">Initial pledge</div>
          <div className="card-big">{fil(m.pledge)}</div>
          <div className="muted">
            {formatCount(m.live)} live sectors{m.faulty > 0 && <span className="faulty"> · {formatCount(m.faulty)} faulty</span>}
          </div>
          <div className="muted">
            {hasPledge
              ? `${fil(m.pledge30)} returned within 30 d · last sector ${dayDate(lastPledge)}`
              : 'no live sectors'}
          </div>
          {m.faulty > 0 && (
            <div className="muted">
              {fil(sumFil(data.faultyPledge))} on faulty sectors, returned minus a termination fee if not recovered
            </div>
          )}
        </div>
        <div className="card">
          <div className="card-title">Balance</div>
          <dl className="balances">
            <dt>Total</dt>
            <dd>{fil(attoToFil(data.atto.balance))}</dd>
            <dt>Available</dt>
            <dd>{fil(attoToFil(data.atto.available))}</dd>
            <dt>Pre-commit deposits</dt>
            <dd>{fil(attoToFil(data.atto.preCommitDeposits))}</dd>
            {data.atto.feeDebt !== '0' && (
              <>
                <dt>Fee debt</dt>
                <dd className="faulty">{fil(attoToFil(data.atto.feeDebt))}</dd>
              </>
            )}
          </dl>
        </div>
      </div>
      {tranches.length > 0 && (
        <table className="tranches">
          <thead>
            <tr>
              <th>Unlocks (UTC)</th>
              <th>When</th>
              <th>Epoch</th>
              <th className="num">FIL</th>
              <th className="num">Cumulative</th>
            </tr>
          </thead>
          <tbody>
            {tranches.map(([e, f], i) => (
              <tr key={e}>
                <td>{epochDateTime(e, g)}</td>
                <td className="muted">{formatWhen(e - index.height)}</td>
                <td className="muted">{e}</td>
                <td className="num">{f.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}</td>
                <td className="num muted">{fil(cumulative[i])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export default MinerDetail
