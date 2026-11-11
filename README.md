# One live feed, many windows

A dashboard spread over separate browser windows. One window holds a live
incident feed; the grid, chart, key figures, board and map can each be popped out
into their own window, for example onto a second monitor. Every window stays
live off that one feed, and a filter or selection in one window narrows the
others.

**Live demo:** https://toclocoinc.github.io/lattice-grid-demo-multi-window/

Built with [Lattice Grid](https://www.latticegrid.dev/realtime-applications/).

## What it shows

- **One feed, one owner.** Only the dashboard window opens the (simulated)
  socket. Other windows open none: they join a shared channel and receive the
  current snapshot and every update over it. The header of every window shows
  the sequence number of the last update, the channel name and whether that
  window holds the feed.
- **Five panels, five routes.** Incident records are routed to a grid, a chart
  (incidents by service, coloured by severity), key figures, a board grouped by
  status and a map. A window attaches only the panels it shows.
- **Incidents on a map.** Each incident carries a latitude and longitude (a
  fixed site per service and region, nudged a little so markers do not stack)
  and the map draws it as a marker coloured by severity. It is drawn with the
  map view module on a keyless basemap; the page loads deck.gl and MapLibre GL
  from a public CDN for it.
- **Filters travel.** Type in the grid's filter row and the chart, figures,
  board and map show only the rows the grid shows, wherever those panels are. Each
  route edge carries `follow: 'filter'`.
- **Selections travel.** Select incidents in the grid and the chart, figures,
  board and map narrow to exactly those rows, inside the current filter. Clear the
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
   window; drag it to your second screen. The dashboard closes the gap and
   lists the chart in its header with a **Bring back** button.
3. Type `high` in the grid's Severity filter. The chart in the other window,
   the key figures and the board show only high-severity incidents. Clear the
   box and all return.
4. In the grid, tick two or three rows. The chart in the other window, the key
   figures and the board narrow to those rows. Untick them and all return.
5. Click **Pop out** on **Incidents on the map**. Type `EMEA` in the grid's
   Region filter and the map, in its own window, keeps only the markers around
   London and Frankfurt. Tick two rows and it shows just those two markers.
   **Bring back** puts the map in the dashboard again.
6. Open the grid panel a second time (copy the address of the dashboard and add
   `&panel=grid`), type in a filter row or sort a column, and watch the other
   copy follow.
7. Close the chart window, or press **Bring back**, and the chart is drawn in
   the dashboard again. Pop it out once more: it resyncs to the current feed at
   once and shows the same sequence number.

## Check it headlessly

`tools/verify.mjs` loads the dashboard against a grid build, opens the chart
panel in a second page of the same browser, selects two rows in the first and
asserts that the chart window holds exactly two rows within two seconds. It
then opens the map panel in another page, filters the grid's Region to EMEA
and asserts the map's rows are all EMEA, inline and in its own window. It
needs `playwright-core` and a Chrome or Chromium binary:

```sh
npm i --no-save playwright-core
node tools/verify.mjs --base https://cdn.latticegrid.dev/lattice-grid@1.120.0 --chrome "/path/to/chrome"
```

The publish workflow runs the same check before every deploy.
