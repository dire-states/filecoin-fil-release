import { useEffect, useMemo, useRef, useState } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { FONT, niceStep } from '../lib/chart'
import { useDarkMode } from '../lib/colors'
import { EPOCH_SECONDS } from '../lib/epochs'
import { epochDate, fil, formatCompact } from '../lib/format'
import { lockedAt, lockedCurve } from '../lib/release'
import type { FilHistogram } from '../lib/types'
import ChartLegend, { LineKey } from './ChartLegend'

export interface Series {
  id: string
  label: string
  color: string
  hist: FilHistogram
  dashed?: boolean
}

interface Props {
  series: Series[]
  height: number
  genesisTimestamp: number
}

// FIL still locked over time, one step line per series, until everything is released.
function LockedChart({ series, height, genesisTimestamp }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const plotRef = useRef<uPlot | null>(null)
  const dark = useDarkMode()
  // Hovered epoch and the cursor's x within the plot area, or null when not hovering.
  const [hover, setHover] = useState<{ epoch: number; left: number } | null>(null)

  const curves = useMemo(() => series.map((s) => ({ ...s, points: lockedCurve(s.hist, height, genesisTimestamp) })), [series, height, genesisTimestamp])
  const end = Math.max(height + 1, ...curves.map((c) => c.points[c.points.length - 1].epoch))

  const toSec = (epoch: number) => genesisTimestamp + epoch * EPOCH_SECONDS
  const toEpoch = (sec: number) => (sec - genesisTimestamp) / EPOCH_SECONDS

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return

    // Shared x: every step epoch of every series. Values hold until the next x (step-after).
    const epochs = [...new Set(curves.flatMap((c) => c.points.map((p) => p.epoch)))].sort((a, b) => a - b)
    const data: uPlot.AlignedData = [epochs.map(toSec), ...curves.map((c) => epochs.map((e) => lockedAt(c.points, e)))]

    const css = getComputedStyle(el)
    const muted = css.getPropertyValue('--muted').trim()
    const grid = css.getPropertyValue('--grid').trim()
    const axis = css.getPropertyValue('--axis').trim()
    const stepped = uPlot.paths.stepped!({ align: 1 })

    const opts: uPlot.Options = {
      width: Math.max(1, el.clientWidth),
      height: Math.max(1, el.clientHeight),
      legend: { show: false },
      cursor: { x: true, y: false, points: { show: false }, drag: { x: false, y: false } },
      // Dates are UTC everywhere else on the page.
      tzDate: (ts) => uPlot.tzDate(new Date(ts * 1e3), 'Etc/UTC'),
      scales: {
        x: { time: true, range: [toSec(height), toSec(end)] },
        y: { range: (_u, _min, max) => [0, Math.max(1e-6, max)] },
      },
      axes: [
        {
          stroke: muted,
          font: FONT,
          size: 20,
          space: 56,
          // Years once ticks are a year apart, otherwise year-month.
          values: (_u, splits, _ax, _space, incr) =>
            splits.map((s) => new Date(s * 1e3).toISOString().slice(0, incr >= 360 * 86400 ? 4 : 7)),
          grid: { show: false },
          ticks: { stroke: axis, size: 4 },
        },
        {
          stroke: muted,
          font: FONT,
          size: 40,
          gap: 4,
          splits: (_u, _ax, _min, max) => {
            const step = niceStep(max, 2)
            const out: number[] = []
            for (let v = 0; v <= max + 1e-9; v += step) out.push(v)
            return out
          },
          values: (_u, splits) => splits.map((v) => formatCompact(v)),
          grid: { stroke: grid, width: 1 },
          ticks: { show: false },
        },
      ],
      series: [
        {},
        ...curves.map((c) => ({
          label: c.label,
          stroke: c.color,
          width: 2,
          dash: c.dashed ? [5, 3] : undefined,
          paths: stepped,
          points: { show: false },
        })),
      ],
      hooks: {
        setCursor: [
          (u) => {
            const left = u.cursor.left ?? -1
            setHover(left < 0 ? null : { epoch: toEpoch(u.posToVal(left, 'x')), left })
          },
        ],
      },
      padding: [8, 12, 0, 0],
    }

    const u = new uPlot(opts, data, el)
    plotRef.current = u
    const ro = new ResizeObserver(() => u.setSize({ width: Math.max(1, el.clientWidth), height: Math.max(1, el.clientHeight) }))
    ro.observe(el)
    return () => {
      ro.disconnect()
      u.destroy()
      plotRef.current = null
    }
    // Rebuild on data or theme changes; the helpers above derive from these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curves, height, genesisTimestamp, dark])

  const readout = hover === null ? null : curves.map((c) => ({ c, left: lockedAt(c.points, hover.epoch) }))
  const plotLeft = plotRef.current ? plotRef.current.over.offsetLeft : 0
  // The readout floats in viewport coordinates so it isn't clipped by the panel.
  let tipStyle: React.CSSProperties = {}
  if (hover && plotRef.current) {
    const r = plotRef.current.over.getBoundingClientRect()
    const x = r.left + hover.left
    tipStyle = x > r.left + r.width / 2 ? { right: window.innerWidth - x + 10 } : { left: x + 10 }
    if (r.top > window.innerHeight / 2) tipStyle.bottom = window.innerHeight - r.bottom
    else tipStyle.top = r.top
  }

  return (
    <div className="chart-wrap">
      {series.length > 1 && <ChartLegend items={series.map((s) => ({ id: s.id, label: s.label, color: s.color, dashed: s.dashed }))} />}
      <div className="chart">
        <div ref={wrapRef} className="chart-plot" />
        {hover && readout && plotRef.current && (
          <>
            {readout.map(({ c, left }) => (
              <i
                key={c.id}
                className="chart-dot"
                style={{
                  left: plotLeft + hover.left,
                  top: plotRef.current!.over.offsetTop + plotRef.current!.valToPos(left, 'y'),
                  background: c.color,
                }}
              />
            ))}
            <div className="chart-tip" style={tipStyle}>
              <div className="muted">{epochDate(hover.epoch, genesisTimestamp)} · still locked</div>
              {readout.map(({ c, left }) => (
                <div key={c.id} className="chart-tip-row">
                  {readout.length > 1 && <LineKey color={c.color} dashed={c.dashed} />}
                  <strong>{fil(left)}</strong>
                  {readout.length > 1 && <span className="muted">{c.label}</span>}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default LockedChart
