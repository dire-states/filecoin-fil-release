# Running the snapshots on the node host

These steps set up the fetch, commit and publish runs, 4 times a day, on the host that runs the Lotus
nodes, under `/opt/dire-states`, next to sector-spiegel and message-mix. Your admin login (e.g. `ptrk`)
owns the files there, and the service runs as root. Run the steps as that login; `sudo` marks what
needs root.

Each data repo gets its own new **deploy key**, because GitHub allows a deploy key on one repo
only. Each key can push to its own data repo and nothing else. The app repo is public and is cloned
over HTTPS.

## 0. GitHub repos

Once, from a workstation. Create three public repos under `dire-states`, all empty (no README,
license or .gitignore): `filecoin-fil-release`, `filecoin-fil-release-data-main` and
`filecoin-fil-release-data-calibration`. Then push the local copies:

```sh
cd ~/projects/dire-states/fil-release
for r in filecoin-fil-release filecoin-fil-release-data-main filecoin-fil-release-data-calibration; do
  git -C $r init -b main
  git -C $r add -A
  git -C $r commit -m 'Initial commit'
  git -C $r remote add origin git@github.com:dire-states/$r.git
  git -C $r push -u origin main
done
```

Turn on Pages under **Settings → Pages**:

- `filecoin-fil-release`: **Source: GitHub Actions**. The workflow builds and deploys on every push
  to `main`; re-run it from the Actions tab if the first push came before this setting.
- Both data repos: **Deploy from a branch**, `main`, `/ (root)`. `.nojekyll` makes Pages serve the
  files as they are.

The site is then at `https://dire-states.github.io/filecoin-fil-release/`.

## 1. Prerequisites

`/opt/dire-states`, Node 26 at `/opt/dire-states/node` and `/opt/dire-states/.ssh/known_hosts` are
shared with sector-spiegel and message-mix. If they are not there yet, set them up as in
sector-spiegel's `deploy/README.md`, steps 1–3 (prerequisites, directories, `ssh-keyscan`). Then:

```sh
node --version     # >= 23.6, runs .ts directly
mkdir -p /opt/dire-states/fil-release
```

## 2. Deploy keys

```sh
cd /opt/dire-states
for repo in data-main data-calibration; do
  ssh-keygen -t ed25519 -N '' -C "fil-release-$repo@$(hostname)" -f .ssh/fil-release-$repo
done
cat .ssh/fil-release-data-main.pub .ssh/fil-release-data-calibration.pub
```

On GitHub, add each public key to its repo under **Settings → Deploy keys → Add deploy key**, with
**Allow write access** ticked. Delete any old key of a previous install there.

- `fil-release-data-main.pub` → `dire-states/filecoin-fil-release-data-main`
- `fil-release-data-calibration.pub` → `dire-states/filecoin-fil-release-data-calibration`

## 3. Clone

```sh
cd /opt/dire-states/fil-release
git clone https://github.com/dire-states/filecoin-fil-release.git
for repo in data-main data-calibration; do
  git clone \
    -c core.sshCommand="ssh -i /opt/dire-states/.ssh/fil-release-$repo -o IdentitiesOnly=yes -o UserKnownHostsFile=/opt/dire-states/.ssh/known_hosts" \
    -c user.name=dire-states -c user.email=339008527+dire-states@users.noreply.github.com \
    git@github.com:dire-states/filecoin-fil-release-$repo.git
done
# Root's git refuses repos owned by another user unless they are marked safe.
for r in filecoin-fil-release filecoin-fil-release-data-main filecoin-fil-release-data-calibration; do
  sudo git config --system --add safe.directory /opt/dire-states/fil-release/$r
done
```

As with sector-spiegel, each data clone starts from GitHub's single snapshot commit. From here on
the host keeps the full history locally, one commit per snapshot, and pushes only the latest one.

## 4. Test by hand

```sh
cd /opt/dire-states/fil-release/filecoin-fil-release
sudo NO_PUSH=1 scripts/publish.sh calibnet   # commits, no push
sudo scripts/publish.sh calibnet             # pushes
sudo scripts/publish.sh mainnet              # ~5 min, ~MAINNET_RAM RAM
```

Each run ends with `<net>: published snapshot … as <commit>` and `<net>: done in <N>s`. The nodes
default to `192.168.50.123:1234` (mainnet) and `:1235` (calibnet); set `LOTUS_API` if they live
elsewhere.

## 5. Schedule

The units are linked from this repo, not copied, so a pull plus `daemon-reload` applies changes.
`/opt` must be on the root filesystem for linked units to load at boot.

```sh
D=/opt/dire-states/fil-release/filecoin-fil-release/deploy
sudo systemctl link $D/fil-release@.service
sudo systemctl enable --now $D/fil-release-calibnet.timer $D/fil-release-mainnet.timer
systemctl list-timers 'fil-release*' 'message-mix*' 'sector-spiegel*'
sudo systemctl start fil-release@calibnet   # one run through systemd, to check the unit
```

Calibnet runs at 00:40, 06:40, 12:40 and 18:40, and mainnet 10 minutes later, clear of
sector-spiegel's runs at :00 and :10 and message-mix's at :30 and :35. A run missed while the host
was down starts at the next boot.

- Run now: `sudo systemctl start fil-release@mainnet`
- Logs: `sudo journalctl -u fil-release@mainnet -e`
- Failures: `systemctl --failed`. A failed run, for example a node out of sync or unreachable,
  commits and pushes nothing. The next run discards any files it left behind and picks up normally.

## Updating the scripts

```sh
git -C /opt/dire-states/fil-release/filecoin-fil-release pull
sudo systemctl daemon-reload    # if a unit file changed
```
