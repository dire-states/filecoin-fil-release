import { useEffect, useMemo, useRef, useState } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { FONT, niceStep } from '../lib/chart'
import { useDarkMode } from '../lib/colors'
import { fil, formatCompact } from '../lib/format'
import { dayDate, utcDay } from '../lib/release'
import type { FilHistogram } from '../lib/types'
import ChartLegend from './ChartLegend'

export interface BarSeries {
  id: string
  label: string
  color: string
  hist: FilHistogram
}

interface Props {
  // Stacked bottom to top.
  series: BarSeries[]
  height: number
  genesisTimestamp: number
  // Days per bar.
  bucketDays: number
  // Bars shown, counted from the snapshot day. Defaults to through the last release.
  buckets?: number
}

// FIL released per bucket of days from the snapshot on, stacked by kind.
function ReleaseBars({ series, height, genesisTimestamp, bucketDays, buckets }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const plotRef = useRef<uPlot | null>(null)
  const dark = useDarkMode()
  const [hover, setHover] = useState<{ idx: number; left: number } | null>(null)

  const firstDay = utcDay(height, genesisTimestamp)
  // values[s][b]: FIL of series s released in bucket b.
  const { count, values } = useMemo(() => {
    const lastDay = Math.max(firstDay, ...series.map((s) => s.hist.at(-1)?.[0] ?? firstDay))
    const count = buckets ?? Math.floor((lastDay - firstDay) / bucketDays) + 1
    const values = series.map((s) => {
      const v = new Array<number>(count).fill(0)
      for (const [d, f] of s.hist) {
        const b = Math.floor((Math.max(d, firstDay) - firstDay) / bucketDays)
        if (b < count) v[b] += f
      }
      return v
    })
    return { count, values }
  }, [series, firstDay, bucketDays, buckets])

  // UTC days map straight to the time axis.
  const bucketDay = (b: number) => firstDay + b * bucketDays
  const toSec = (day: number) => day * 86_400

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const xs = Array.from({ length: count }, (_, b) => toSec(bucketDay(b) + bucketDays / 2))
    // Running totals, drawn top series first so each lower part paints over the one above it.
    const stacked = values.map((_, s) => xs.map((_x, b) => values.slice(0, s + 1).reduce((a, v) => a + v[b], 0)))

    const css = getComputedStyle(el)
    const muted = css.getPropertyValue('--muted').trim()
    const grid = css.getPropertyValue('--grid').trim()
    const axis = css.getPropertyValue('--axis').trim()
    const bars = uPlot.paths.bars!({ size: [0.8, 40], gap: 1 })
    const order = series.map((_, i) => i).reverse()

    const opts: uPlot.Options = {
      width: Math.max(1, el.clientWidth),
      height: Math.max(1, el.clientHeight),
      legend: { show: false },
      cursor: { x: true, y: false, points: { show: false }, drag: { x: false, y: false } },
      tzDate: (ts) => uPlot.tzDate(new Date(ts * 1e3), 'Etc/UTC'),
      scales: {
        x: { time: true, range: [toSec(bucketDay(0)), toSec(bucketDay(count))] },
        y: { range: (_u, _min, max) => [0, Math.max(1e-6, max)] },
      },
      axes: [
        {
          stroke: muted,
          font: FONT,
          size: 20,
          space: 56,
          values: (_u, splits, _ax, _space, incr) =>
            splits.map((s) => new Date(s * 1e3).toISOString().slice(0, incr >= 360 * 86400 ? 4 : incr >= 28 * 86400 ? 7 : 10)),
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
        ...order.map((i) => ({ label: series[i].label, fill: series[i].color, stroke: series[i].color, width: 0, paths: bars, points: { show: false } })),
      ],
      hooks: {
        setCursor: [
          (u) => {
            const idx = u.cursor.idx
            setHover(idx == null || (u.cursor.left ?? -1) < 0 ? null : { idx, left: u.cursor.left! })
          },
        ],
      },
      padding: [8, 12, 0, 0],
    }

    const u = new uPlot(opts, [xs, ...order.map((i) => stacked[i])], el)
    plotRef.current = u
    const ro = new ResizeObserver(() => u.setSize({ width: Math.max(1, el.clientWidth), height: Math.max(1, el.clientHeight) }))
    ro.observe(el)
    return () => {
      ro.disconnect()
      u.destroy()
      plotRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, count, bucketDays, height, genesisTimestamp, dark])

  let tipStyle: React.CSSProperties = {}
  if (hover && plotRef.current) {
    const r = plotRef.current.over.getBoundingClientRect()
    const x = r.left + hover.left
    tipStyle = x > r.left + r.width / 2 ? { right: window.innerWidth - x + 10 } : { left: x + 10 }
    if (r.top > window.innerHeight / 2) tipStyle.bottom = window.innerHeight - r.bottom
    else tipStyle.top = r.top
  }
  const from = hover ? bucketDay(hover.idx) : 0
  const total = hover ? values.reduce((a, v) => a + v[hover.idx], 0) : 0

  return (
    <div className="chart-wrap">
      <ChartLegend items={series.map((s) => ({ id: s.id, label: s.label, color: s.color }))} />
      <div className="chart">
        <div ref={wrapRef} className="chart-plot" />
        {hover && plotRef.current && (
          <div className="chart-tip" style={tipStyle}>
            <div className="muted">
              {dayDate(from)}
              {bucketDays > 1 && ` – ${dayDate(from + bucketDays - 1)}`}
            </div>
            <div className="chart-tip-row">
              <strong>{fil(total)}</strong> <span className="muted">released</span>
            </div>
            {series.map((s, i) => (
              <div key={s.id} className="chart-tip-row">
                <i className="swatch" style={{ background: s.color }} />
                {fil(values[i][hover.idx])} <span className="muted">{s.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default ReleaseBars
