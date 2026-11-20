import { EPOCH_SECONDS, EPOCHS_PER_DAY } from './epochs.ts'

export function epochTime(epoch: number, genesisTimestamp: number): Date {
  return new Date((genesisTimestamp + epoch * EPOCH_SECONDS) * 1000)
}

export function epochDate(epoch: number, genesisTimestamp: number): string {
  return epochTime(epoch, genesisTimestamp).toISOString().slice(0, 10)
}

// Date and time to the minute, UTC.
export function epochDateTime(epoch: number, genesisTimestamp: number): string {
  return `${epochTime(epoch, genesisTimestamp).toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

// When an epoch comes, relative to the snapshot: "in 6 h 20 m".
export function formatWhen(epochs: number): string {
  return `in ${formatIn(epochs)}`
}

// Time until an epoch: hours and minutes below a day, then days and years.
export function formatIn(epochs: number): string {
  if (epochs <= 0) return 'now'
  const minutes = Math.round((epochs * EPOCH_SECONDS) / 60)
  if (minutes < 60) return `${minutes} m`
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} h ${minutes % 60} m`
  return formatSpan(epochs)
}

// FIL amount for display: two decimals, fewer digits for large amounts.
export function fil(n: number): string {
  if (n === 0) return '0 FIL'
  const digits = Math.abs(n) >= 1000 ? 0 : Math.abs(n) >= 1 ? 2 : 4
  return `${n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })} FIL`
}

// Duration between epochs as days below a year, years above.
export function formatSpan(epochs: number): string {
  const days = epochs / EPOCHS_PER_DAY
  if (Math.abs(days) < 365) return `${Math.round(days)} d`
  return `${(days / 365.25).toFixed(1)} y`
}

export function formatCount(n: number): string {
  return n.toLocaleString('en-US')
}

export function formatCompact(n: number): string {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}
