import { useEffect, useMemo, useState } from 'react'
import './App.css'
import Header from './components/Header'
import LeftPane, { type SortKey } from './components/LeftPane'
import MainPane from './components/MainPane'
import BottomPane from './components/BottomPane'
import RightPane from './components/RightPane'
import { NETWORKS, netFromUrl, type NetKey } from './lib/networks'
import type { MinerData, MinerIndex, MinerSummary } from './lib/types'

class NotFound extends Error {}

async function getJson<T>(base: string, path: string): Promise<T> {
  // Pages lets browsers cache files for 10 minutes; revalidate so a new snapshot shows up at once.
  // Unchanged files still come from the cache (304).
  const res = await fetch(base + path, { cache: 'no-cache' })
  if (res.status === 404) throw new NotFound(path)
  if (!res.ok) throw new Error(`${path}: ${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

const SORTS: Record<SortKey, (a: MinerSummary, b: MinerSummary) => number> = {
  locked: (a, b) => b.vesting + b.pledge - (a.vesting + a.pledge),
  vesting: (a, b) => b.vesting - a.vesting,
  pledge: (a, b) => b.pledge - a.pledge,
  soon: (a, b) => b.vesting30 + b.pledge30 - (a.vesting30 + a.pledge30),
}

// Holds the network choice; everything else lives in Dashboard, which remounts per network so
// selection and caches never leak between datasets.
function App() {
  const [net, setNet] = useState<NetKey>(netFromUrl)

  function switchNet(next: NetKey) {
    const url = new URL(window.location.href)
    // Miner IDs don't carry over between networks.
    url.searchParams.delete('miner')
    if (next === 'mainnet') url.searchParams.delete('net')
    else url.searchParams.set('net', next)
    window.history.replaceState(null, '', url)
    setNet(next)
  }

  return <Dashboard key={net} net={net} onNet={switchNet} />
}

function Dashboard({ net, onNet }: { net: NetKey; onNet: (net: NetKey) => void }) {
  const base = NETWORKS[net].base
  const [index, setIndex] = useState<MinerIndex | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('locked')
  // Empty selection means all miners. Kept in ?miner= so a miner's view can be linked.
  const [selected, setSelectedState] = useState<string[]>(
    () => new URLSearchParams(window.location.search).get('miner')?.split(',').filter(Boolean) ?? [],
  )

  function setSelected(ids: string[]) {
    const url = new URL(window.location.href)
    if (ids.length) url.searchParams.set('miner', ids.join(','))
    else url.searchParams.delete('miner')
    window.history.replaceState(null, '', url)
    setSelectedState(ids)
  }
  const [loaded, setLoaded] = useState<Map<string, MinerData>>(new Map())

  // Plain click selects just this miner (or clears when it's the only one);
  // Shift- or Ctrl/Cmd-click adds or removes it from the selection.
  function clickMiner(e: React.MouseEvent, id: string) {
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      setSelected(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id])
    } else {
      setSelected(selected.length === 1 && selected[0] === id ? [] : [id])
    }
  }

  useEffect(() => {
    getJson<MinerIndex>(base, 'miners.json')
      .then(setIndex)
      .catch((err: Error) => setError(err instanceof NotFound ? `No ${NETWORKS[net].label} data yet.` : err.message))
  }, [base, net])

  // Miners matching the search, in the chosen order: drives the list and the overview.
  const listed = useMemo(() => {
    if (!index) return []
    const q = search.trim().toLowerCase()
    return index.miners.filter((m) => m.id.toLowerCase().includes(q)).sort(SORTS[sort])
  }, [index, search, sort])

  const selectedMiners = useMemo(
    () => (index ? index.miners.filter((m) => selected.includes(m.id)).sort(SORTS[sort]) : []),
    [index, selected, sort],
  )

  // Per-miner files load only for selected miners; the overview works from the index alone.
  useEffect(() => {
    const missing = selectedMiners.filter((m) => !loaded.has(m.id))
    if (missing.length === 0) return
    let cancelled = false
    Promise.all(missing.map((m) => getJson<MinerData>(base, `miners/${m.id}.json`)))
      .then((data) => {
        if (cancelled) return
        setLoaded((prev) => {
          const next = new Map(prev)
          for (const d of data) next.set(d.id, d)
          return next
        })
      })
      .catch((err: Error) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [base, selectedMiners, loaded])

  return (
    <div className="app">
      <Header index={index} net={net} onNet={onNet} />
      <LeftPane
        index={index}
        miners={listed}
        selected={selected}
        onMinerClick={clickMiner}
        onClear={() => setSelected([])}
        search={search}
        onSearch={setSearch}
        sort={sort}
        onSort={setSort}
        error={error}
      />
      <MainPane index={index} listed={listed} selectedMiners={selectedMiners} loaded={loaded} onMinerClick={clickMiner} />
      <RightPane index={index} selected={selected} onMinerClick={clickMiner} />
      <BottomPane index={index} />
    </div>
  )
}

export default App
