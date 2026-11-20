import { useMemo } from 'react'
import MinerDetail from './MinerDetail'
import ReleaseBars from './ReleaseBars'
import { useDarkMode } from '../lib/colors'
import { fil, formatCount, formatWhen } from '../lib/format'
import { KIND_LABELS, kindColors } from '../lib/kinds'
import { filHistogram, mergeHistograms, vestingTranches } from '../lib/release'
import type { FilHistogram, MinerData, MinerIndex, MinerSummary } from '../lib/types'

interface Props {
  index: MinerIndex | null
  // Miners matching the list search, sorted: the overview when nothing is selected.
  listed: MinerSummary[]
  selectedMiners: MinerSummary[]
  loaded: Map<string, MinerData>
  onMinerClick: (e: React.MouseEvent, id: string) => void
}

// Days of daily releases in the pane's chart: the whole vesting window.
const CHART_DAYS = 181
// Overview rows; the list on the left has every miner.
const OVERVIEW_ROWS = 500

function MainPane({ index, listed, selectedMiners, loaded, onMinerClick }: Props) {
  const dark = useDarkMode()
  const colors = kindColors(dark)
  const overview = selectedMiners.length === 0
  const shown = overview ? listed : selectedMiners

  // Daily releases of the selection (summed over loaded miners), or the network's.
  const hists = useMemo((): { vesting: FilHistogram; pledge: FilHistogram; faultyPledge: FilHistogram } | null => {
    if (!index) return null
    if (overview) return index.totals
    const data = selectedMiners.map((m) => loaded.get(m.id)).filter((d) => d !== undefined)
    return {
      vesting: mergeHistograms(...data.map((d) => filHistogram(vestingTranches(d), index.genesisTimestamp))),
      pledge: mergeHistograms(...data.map((d) => d.pledge)),
      faultyPledge: mergeHistograms(...data.map((d) => d.faultyPledge)),
    }
  }, [index, overview, selectedMiners, loaded])

  if (!index || !hists) return <main className="main" />

  const vesting = shown.reduce((s, m) => s + m.vesting, 0)
  const pledge = shown.reduce((s, m) => s + m.pledge, 0)
  const total = index.miners.length
  const scope = overview
    ? listed.length === total ? `All ${total} miners` : `${listed.length} of ${total} miners`
    : shown.length === 1 ? shown[0].id : `${shown.length} miners`

  return (
    <main className="main">
      <div className="main-head">
        <h2 className="pane-title miner-title">
          {scope} · {fil(vesting + pledge)} locked · {fil(vesting)} rewards vesting · {fil(pledge)} pledge
        </h2>
      </div>
      <div className="main-scroll">
        {overview ? (
          <table className="overview">
            <thead>
              <tr>
                <th>Miner</th>
                <th className="num">Rewards vesting</th>
                <th className="num">Pledge</th>
                <th>Next reward unlock</th>
                <th className="num">Released in 30 d</th>
              </tr>
            </thead>
            <tbody>
              {listed.slice(0, OVERVIEW_ROWS).map((m) => (
                <tr key={m.id} onClick={(e) => onMinerClick(e, m.id)} onMouseDown={(e) => e.shiftKey && e.preventDefault()}>
                  <td className="miner-id">{m.id}</td>
                  <td className="num">{fil(m.vesting)}</td>
                  <td className="num">{fil(m.pledge)}</td>
                  <td>{m.next ? `${fil(m.next[1])} ${formatWhen(m.next[0] - index.height)}` : <span className="muted">–</span>}</td>
                  <td className="num">{fil(m.vesting30 + m.pledge30)}</td>
                </tr>
              ))}
            </tbody>
            {listed.length > OVERVIEW_ROWS && (
              <tfoot>
                <tr>
                  <td colSpan={5} className="muted">
                    {formatCount(listed.length - OVERVIEW_ROWS)} more in the list on the left
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        ) : (
          selectedMiners.map((m) => {
            const data = loaded.get(m.id)
            return (
              <section key={m.id} className="miner-block">
                {selectedMiners.length > 1 && <h3 className="miner-block-title">{m.id}</h3>}
                {data ? <MinerDetail summary={m} data={data} index={index} /> : <p className="muted">Loading…</p>}
              </section>
            )
          })
        )}
      </div>
      <div className="main-chart">
        <div className="panel">
          <div className="panel-head">
            <span className="panel-title">{overview ? 'Network' : scope} · released per day, next 180 days</span>
          </div>
          <ReleaseBars
            series={[
              { id: 'vesting', label: KIND_LABELS.vesting, color: colors.vesting, hist: hists.vesting },
              { id: 'pledge', label: KIND_LABELS.pledge, color: colors.pledge, hist: hists.pledge },
              { id: 'faulty', label: KIND_LABELS.faultyPledge, color: colors.faultyPledge, hist: hists.faultyPledge },
            ]}
            height={index.height}
            genesisTimestamp={index.genesisTimestamp}
            bucketDays={1}
            buckets={CHART_DAYS}
          />
        </div>
      </div>
    </main>
  )
}

export default MainPane
