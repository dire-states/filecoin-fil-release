import { useMemo } from 'react'
import { fil } from '../lib/format'
import type { MinerIndex } from '../lib/types'

interface Props {
  index: MinerIndex | null
  selected: string[]
  onMinerClick: (e: React.MouseEvent, id: string) => void
}

// Miners releasing the most within 30 days of the snapshot.
function RightPane({ index, selected, onMinerClick }: Props) {
  const miners = useMemo(
    () =>
      (index?.miners ?? [])
        .filter((m) => m.vesting30 + m.pledge30 > 0)
        .sort((a, b) => b.vesting30 + b.pledge30 - (a.vesting30 + a.pledge30)),
    [index],
  )
  const total = miners.reduce((s, m) => s + m.vesting30 + m.pledge30, 0)

  return (
    <aside className="right">
      <h2 className="pane-title">Next 30 days ({miners.length})</h2>
      {index && <p className="muted pane-note">{fil(total)} released by these miners</p>}
      <ul className="miner-list">
        {miners.map((m) => {
          const isSelected = selected.includes(m.id)
          return (
            <li key={m.id} className={isSelected ? 'miner selected' : 'miner'}>
              <button
                className="miner-body"
                aria-pressed={isSelected}
                title="Shift-click to add or remove from the selection"
                onMouseDown={(e) => e.shiftKey && e.preventDefault()}
                onClick={(e) => onMinerClick(e, m.id)}
              >
                <span className="miner-row">
                  <span className="miner-id">{m.id}</span>
                  <span className="miner-counts">{fil(m.vesting30 + m.pledge30)}</span>
                </span>
                <span className="miner-end">
                  {fil(m.vesting30)} rewards · {fil(m.pledge30)} pledge
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </aside>
  )
}

export default RightPane
