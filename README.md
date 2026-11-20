# fil-release

Shows when the FIL locked in Filecoin miners is released: block rewards as they vest, and initial
pledge as sectors expire. Per miner it shows the next unlock (amount, time, epoch) and the full
vesting schedule. Network-wide it shows daily releases for the next 180 days and the pledge returned
per 30 days until the last sector expires.

## Where the data comes from

- **Block rewards**: 25% of a block reward is available at once and 75% vests linearly over 180 days.
  The schedule is in the miner actor state as `VestingFunds`. `Head` is the next tranche
  `{Epoch, Amount}`. `Tail` is a CID (read with `ChainReadObj`) of a CBOR array of `[epoch, amount]`,
  one entry per 12 h. Head plus Tail always sums to `LockedFunds`; the fetch script warns if it doesn't.
  A tranche whose epoch has passed is unlocked and withdrawable (Lotus' `StateMinerAvailableBalance`
  counts it), but stays in `LockedFunds` until the miner's next deadline cron or message; miners
  without sectors get no cron and can keep it there for a long time. The site counts only future
  tranches as vesting and shows the rest per miner as already unlocked, so its network total sits
  slightly below the power actor's `TotalPledgeCollateral`, which still includes them.
- **Initial pledge**: per sector, from `StateMinerSectors`. It comes back when the sector expires.
  Faulty sectors are counted at their early expiration (`StateSectorExpiration().Early`): unless the
  fault is recovered they get terminated then, and the pledge comes back minus a termination fee.
  Extensions move the date out, so the pledge timeline is what happens if nothing is extended.
- Balance, available balance, pre-commit deposits and fee debt are shown per miner. Miners with only
  fee debt (or only already-unlocked rewards) have nothing left to release and aren't listed.

## Repos

```
fil-release/
  filecoin-fil-release/                   this repo: the site (Vite + React + uPlot) and the fetch script
  filecoin-fil-release-data-calibration/  calibnet snapshot (miners.json, miners/<id>.json)
  filecoin-fil-release-data-main/         mainnet snapshot
```

The site loads `miners.json` up front, plus one miner's file when you click it. `?miner=<id>` links
to a miner, comma-separated for several.

## Develop

```sh
npm install
npm run dev
```

The dev and preview servers serve the sibling data repos at `/data/calibnet/` and `/data/mainnet/`.
Opens on mainnet; switch networks in the header, or with `?net=calibnet` in the URL.

## Fetch a snapshot

```sh
npm run fetch:calibnet    # writes ../filecoin-fil-release-data-calibration
npm run fetch:mainnet     # writes ../filecoin-fil-release-data-main
```

- Add `-- --commit` to commit the snapshot in the data repo, one commit per snapshot.
- Each data repo has a `dataset.json` naming its network. The script aborts if the node is on a
  different network.
- The script aborts if the node's head is more than 10 min old (still syncing); `-- --allow-stale` overrides.
- `LOTUS_API` defaults to the local node for the repo's network.
- Every miner actor's state is read, so miners whose rewards still vest after their last sector is
  gone are included.

## Publish

```sh
scripts/publish.sh calibnet
scripts/publish.sh mainnet
```

- Fetches and commits locally, then force-pushes only the latest tree to GitHub as a single
  parentless commit. The full history stays in the local data repo.
- `NO_PUSH=1` commits locally without pushing.
- Refuses to run if another publish for the same data repo is running.
- GitHub Pages serves each data repo from `main`. The site, deployed by `.github/workflows/pages.yml`,
  reads the data from there at runtime, so data updates need no app redeploy.

The runs are automated on the node host with a systemd timer, 4 times a day, offset from
sector-spiegel's. Setup steps, deploy keys and unit files are in [`deploy/`](deploy/README.md).

## Configuration

| Variable | Used by | Default |
|---|---|---|
| `LOTUS_API` | fetch script | calibnet: `http://192.168.50.123:1235/rpc/v1`; mainnet: `http://192.168.50.123:1234/rpc/v1` |
| `DATA_DIR` | publish.sh | `../filecoin-fil-release-data-calibration` or `../filecoin-fil-release-data-main` |
| `NO_PUSH` | publish.sh | unset (push) |
| `DATA_DIR_CALIBNET`, `DATA_DIR_MAINNET` | dev/preview server | the two sibling data repos |
| `BASE_PATH` | build | `/` (Pages build: `/filecoin-fil-release/`) |
| `VITE_DATA_BASE_CALIBNET`, `VITE_DATA_BASE_MAINNET` | build | `/data/calibnet/`, `/data/mainnet/` (Pages build: the data repos' Pages URLs) |
