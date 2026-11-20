// Shared by the uPlot charts.
export const FONT = '10px system-ui, -apple-system, "Segoe UI", sans-serif'

// A round axis step that splits 0..max into about count parts.
export function niceStep(max: number, count: number): number {
  const raw = Math.max(1e-9, max / count)
  const mag = 10 ** Math.floor(Math.log10(raw))
  const norm = raw / mag
  return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag
}
