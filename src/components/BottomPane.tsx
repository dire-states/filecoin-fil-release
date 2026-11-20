import LockedChart from './LockedChart'
import ReleaseBars from './ReleaseBars'
import { useDarkMode } from '../lib/colors'
import { epochDate, fil, formatSpan } from '../lib/format'
import { KIND_LABELS, kindColors } from '../lib/kinds'
import { mergeHistograms } from '../lib/release'
import type { MinerIndex } from '../lib/types'

function BottomPane({ index }: { index: MinerIndex | null }) {
  const dark = useDarkMode()

  if (!index) return <section className="bottom" />

  const { vesting, pledge, faultyPledge } = index.totals
  const colors = kindColors(dark)
  const allPledge = mergeHistograms(pledge, faultyPledge)
  const last = index.miners.reduce((a, m) => Math.max(a, m.lastRelease), 0)
  const totalPledge = index.miners.reduce((s, m) => s + m.pledge, 0)

  return (
    <section className="bottom">
      <div className="panel">
        <div className="panel-head">
          <span className="panel-title">Network · still locked</span>
          <span className="muted">
            all released by <strong className="ink">{epochDate(last, index.genesisTimestamp)}</strong> (in{' '}
            {formatSpan(last - index.height)}) unless sectors are extended
          </span>
        </div>
        <LockedChart
          series={[
            { id: 'total', label: 'Total', color: colors.total, hist: mergeHistograms(vesting, allPledge) },
            { id: 'pledge', label: KIND_LABELS.pledge, color: colors.pledge, hist: allPledge },
            { id: 'vesting', label: KIND_LABELS.vesting, color: colors.vesting, hist: vesting },
          ]}
          height={index.height}
          genesisTimestamp={index.genesisTimestamp}
        />
      </div>
      <div className="panel">
        <div className="panel-head">
          <span className="panel-title">Network · pledge returned per 30 days</span>
          <span className="muted">{fil(totalPledge)} initial pledge in live sectors</span>
        </div>
        <ReleaseBars
          series={[
            { id: 'pledge', label: KIND_LABELS.pledge, color: colors.pledge, hist: pledge },
            { id: 'faulty', label: KIND_LABELS.faultyPledge, color: colors.faultyPledge, hist: faultyPledge },
          ]}
          height={index.height}
          genesisTimestamp={index.genesisTimestamp}
          bucketDays={30}
        />
      </div>
    </section>
  )
}

export default BottomPane
