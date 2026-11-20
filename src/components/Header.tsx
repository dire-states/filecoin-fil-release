import { fil } from '../lib/format'
import { NETWORKS, type NetKey } from '../lib/networks'
import { sumFil, utcDay } from '../lib/release'
import type { MinerIndex } from '../lib/types'

interface Props {
  index: MinerIndex | null
  net: NetKey
  onNet: (net: NetKey) => void
}

function Header({ index, net, onNet }: Props) {
  const vesting = index?.miners.reduce((s, m) => s + m.vesting, 0) ?? 0
  const pledge = index?.miners.reduce((s, m) => s + m.pledge, 0) ?? 0
  // Releases due today and tomorrow (UTC days), as in the charts.
  const soon = index
    ? ['vesting', 'pledge', 'faultyPledge'].reduce(
        (s, k) => s + sumFil(index.totals[k as keyof MinerIndex['totals']], utcDay(index.height, index.genesisTimestamp) + 2),
        0,
      )
    : 0
  return (
    <header className="header">
      <h1>fil-release</h1>
      <div className="net-toggle" role="group" aria-label="Network">
        {(Object.keys(NETWORKS) as NetKey[]).map((key) => (
          <button key={key} className={key === net ? 'on' : ''} aria-pressed={key === net} onClick={() => onNet(key)}>
            {NETWORKS[key].label}
          </button>
        ))}
      </div>
      {index && (
        <>
          <span className="header-summary">
            {index.network}: <strong>{fil(vesting + pledge)}</strong> locked
            <span className="muted">
              {' '}
              · {fil(vesting)} rewards vesting · {fil(pledge)} pledge · today + tomorrow {fil(soon)}
            </span>
          </span>
          <span className="header-meta">
            height {index.height} · snapshot {new Date(index.fetchedAt).toLocaleString()}
          </span>
        </>
      )}
    </header>
  )
}

export default Header
