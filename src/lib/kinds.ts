import { seriesColor } from './colors.ts'

// The three kinds of release, with fixed colors across all charts.
export const KIND_LABELS = {
  vesting: 'Block rewards vesting',
  pledge: 'Pledge (sector expiry)',
  faultyPledge: 'Pledge of faulty sectors (early expiry)',
}

export function kindColors(dark: boolean) {
  // Totals use the text color.
  return { vesting: seriesColor(0, dark), pledge: seriesColor(2, dark), faultyPledge: '#d03b3b', total: dark ? '#e6e8eb' : '#1c1f24' }
}
