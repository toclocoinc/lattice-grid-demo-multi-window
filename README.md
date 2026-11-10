# One live feed, many windows

A dashboard spread over separate browser windows. One window holds a live
incident feed; the grid, chart, key figures and board can each be popped out
into their own window, for example onto a second monitor. Every window stays
live off that one feed, and a selection in one window narrows the others.

Built with [Lattice Grid](https://www.latticegrid.dev/realtime-applications/).

## What it shows

- **One feed, one owner.** Only the dashboard window opens the (simulated)
  socket. Other windows open none: they join a shared channel and receive the
  current snapshot and every update over it. The header of every window shows
  the sequence number of the last update, the channel name and whether that
  window holds the feed.
- **Four panels, four routes.** Incident records are routed to a grid, a chart
  (incidents by service, coloured by severity), key figures and a board
  grouped by status. A window attaches only the panels it shows.
- **Selections travel.** Select incidents in the grid and the chart, figures
  and board narrow to exactly those rows, wherever those panels are. Clear the
  selection and everything is back.
- **Grid state travels.** A filter or sort in one copy of the grid is followed
  by a second copy of the grid in another window.

## Run it locally

```sh
python3 -m http.server 8000
# open http://localhost:8000/
```

By default the page loads Lattice Grid from the public CDN. To run against a
local build instead, serve the build folder and pass it as `base`:

```sh
# the folder holds lattice-grid.min.js, lattice-grid.min.css and modules/
python3 -m http.server 8001 --directory /path/to/build
# open http://localhost:8000/?base=http://localhost:8001
```

`base` and `channel` are carried to every window the page opens, so all
windows run on the same build and the same channel. Use `channel=` to keep
two dashboards in the same browser apart.

## Multi-monitor walkthrough

1. Open the dashboard. Leave this window open: it holds the feed.
2. Click **Pop out** on **Incidents by service**. The chart opens in its own
   window; drag it to your second screen. The dashboard shows "Open in its
   own window" in its place.
3. In the grid, tick two or three rows. The chart in the other window, the key
   figures and the board narrow to those rows. Untick them and all return.
4. Open the grid panel a second time (copy the address of the dashboard and add
   `&panel=grid`), type in a filter row or sort a column, and watch the other
   copy follow.
5. Close the chart window, or press **Bring back**, and the chart is drawn in
   the dashboard again. Pop it out once more: it resyncs to the current feed at
   once and shows the same sequence number.

## Check it headlessly

`tools/verify.mjs` loads the dashboard against a local build, opens the chart
panel in a second page of the same browser, selects two rows in the first and
asserts that the chart window holds exactly two rows within two seconds. It
needs `playwright-core` and a Chrome or Chromium binary:

```sh
npm i playwright-core            # in a scratch folder
node /path/to/tools/verify.mjs --base http://localhost:8001 --chrome "/path/to/chrome"
```
