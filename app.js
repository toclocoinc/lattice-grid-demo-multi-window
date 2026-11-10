/* One live feed, panels in their own windows. Plain JS, no bundler. */
(function () {
  'use strict';

  const params = new URLSearchParams(location.search);
  const BASE = params.get('base') || 'https://cdn.latticegrid.dev/lattice-grid@1.120.0';
  const CHANNEL = params.get('channel') || 'lattice-ops-demo';
  const PANEL = params.get('panel');
  const STAMP = '20261110';

  const TITLES = { grid: 'Incidents', chart: 'Incidents by service', kpi: 'Key figures', board: 'Board by status' };
  const ORDER = ['grid', 'board', 'chart', 'kpi'];
  const ROUTE = { grid: 'incidents', chart: 'incidents-chart', kpi: 'incidents-kpi', board: 'incidents-board' };
  const MIN_WIDTH = { id: 100, service: 100, severity: 90, region: 80, status: 90 };
  const COLUMNS = Object.keys(MIN_WIDTH).map((f) => ({
    id: f, field: f, title: f.charAt(0).toUpperCase() + f.slice(1), layout: { width: MIN_WIDTH[f], min: MIN_WIDTH[f], flex: 1 },
  }));
  const EDGES = ['incidents-chart', 'incidents-kpi', 'incidents-board'].map((to) => ({
    from: 'incidents', to, on: { from: 'id', to: 'id' },
  }));
  const isIncident = (row) => row.type === 'incident';
  const $ = (id) => document.getElementById(id);

  /* ---------- load the grid build from BASE ---------- */
  function load(tag, attrs) {
    return new Promise((resolve, reject) => {
      const el = document.createElement(tag);
      Object.assign(el, attrs);
      el.onload = resolve;
      el.onerror = () => reject(new Error('Could not load ' + (attrs.src || attrs.href)));
      document.head.appendChild(el);
    });
  }
  function loadAssets() {
    const v = '?v=' + STAMP;
    const css = load('link', { rel: 'stylesheet', href: BASE + '/lattice-grid.min.css' + v });
    const files = ['lattice-grid', 'modules/charts', 'modules/data-router', 'modules/kpi', 'modules/kanban', 'modules/mock-socket'];
    const scripts = files.reduce((p, f) => p.then(() => load('script', { src: BASE + '/' + f + '.min.js' + v })), Promise.resolve());
    return Promise.all([css, scripts]);
  }

  /* ---------- panels: each mount returns { grid?, destroy } ---------- */
  const hiddenHost = document.createElement('div');
  hiddenHost.className = 'lg-hidden';
  hiddenHost.setAttribute('aria-hidden', 'true');
  document.body.appendChild(hiddenHost);

  let router;
  const baseGrid = (host, extra) =>
    LatticeGrid.createGrid(host, Object.assign({ columns: COLUMNS, rows: [], rowKey: 'id' }, extra));
  // A hidden grid receives the route's rows; the chart, tiles and board read from it.
  function feeder(name) {
    const host = document.createElement('div');
    hiddenHost.appendChild(host);
    const grid = baseGrid(host);
    const off = router.subscribe(isIncident, grid, { label: ROUTE[name], rowKey: 'id' });
    return { grid, release() { off(); grid.destroy(); host.remove(); } };
  }

  const panels = {
    grid(body) {
      const host = document.createElement('div');
      body.appendChild(host);
      const grid = baseGrid(host, { selection: { mode: 'multiple', checkbox: true }, filterRow: true });
      const off = router.subscribe(isIncident, grid, { label: ROUTE.grid, rowKey: 'id' });
      return { grid, destroy() { off(); grid.destroy(); } };
    },
    chart(body) {
      const f = feeder('chart');
      const chart = LatticeGrid.createChart({
        grid: f.grid, container: body, type: 'bar', x: 'service', y: { fn: 'count' }, series: 'severity',
      });
      return { grid: f.grid, destroy() { chart.destroy(); f.release(); } };
    },
    kpi(body) {
      const f = feeder('kpi');
      const open = (r) => r.status === 'open';
      const kpi = LatticeGridKPI.createKPI(body, {
        grid: f.grid,
        fields: ['status', 'severity', 'region'],
        tiles: [
          { id: 'open', label: 'Open incidents', aggregation: 'count', filter: open },
          { id: 'critical', label: 'Critical', aggregation: 'count', filter: (r) => open(r) && r.severity === 'critical' },
          { id: 'resolved', label: 'Resolved in this session', aggregation: 'count', filter: (r) => r.status === 'resolved' },
          { id: 'regions', label: 'Regions affected', aggregation: 'countDistinct', field: 'region', filter: open },
        ],
      });
      return { grid: f.grid, destroy() { kpi.destroy(); f.release(); } };
    },
    board(body) {
      const f = feeder('board');
      const board = LatticeGridKanban.createKanban(body, { grid: f.grid, rowKey: 'id', columnProperty: 'status',
        card: { title: 'id', subtitle: 'service', badges: 'severity', labels: 'region' },
      });
      return { grid: f.grid, destroy() { board.destroy(); f.release(); } };
    },
  };

  /* ---------- wiring: routes, links, broadcast ---------- */
  const mounted = {};        // name -> instance for panels this window shows
  const cache = new Map();   // owner only: current incident rows, to refill routes after a re-wire
  let sourceStub = null;     // keeps the 'incidents' ref resolvable while the grid lives in another window

  function rewire() {
    if (!mounted.grid && !sourceStub) {
      sourceStub = router.subscribe(isIncident, () => {}, { label: ROUTE.grid, rowKey: 'id' });
    } else if (mounted.grid && sourceStub) {
      sourceStub();
      sourceStub = null;
    }
    Object.values(ROUTE).forEach((ref) => router.detach(ref));
    router.relate(EDGES);
    router.broadcast({ channel: CHANNEL, mirror: { state: true } });
    if (cache.size) router.load([...cache.values()]);
  }

  function mount(name, body) {
    mounted[name] = panels[name](body);
    rewire();
  }
  function unmount(name) {
    if (!mounted[name]) return;
    mounted[name].destroy();
    delete mounted[name];
  }

  /* ---------- the feed (launcher only) ---------- */
  function startFeed() {
    let seq = 0;
    const ws = new LatticeGridMockSocket.MockWebSocket({
      feed: LatticeGridMockSocket.opsFeed({ seed: 7 }),
      rate: 1000,
      pauseWhenHidden: false, // keep the feed running while this window sits behind the others
    });
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.kind === 'snapshot') {
        cache.clear();
        msg.rows.filter(isIncident).forEach((r) => cache.set(r.id, r));
        router.load(msg.rows);
        return;
      }
      const changes = msg.changes.map((c) => Object.assign({}, c, { seq: ++seq }));
      changes.forEach((c) => isIncident(c.row) && cache.set(c.row.id, c.row));
      router.apply(changes);
    };
  }

  /* ---------- pages ---------- */
  function panelEl(name, withPopOut) {
    const el = document.createElement('section');
    el.className = 'panel';
    el.dataset.panel = name;
    el.innerHTML = '<div class="panel-head"><h2></h2></div><div class="panel-body"></div>';
    el.querySelector('h2').textContent = TITLES[name];
    if (withPopOut) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn';
      btn.textContent = 'Pop out';
      btn.setAttribute('aria-label', 'Pop out ' + TITLES[name]);
      el.querySelector('.panel-head').appendChild(btn);
      el.popBtn = btn;
    }
    el.body = el.querySelector('.panel-body');
    el.body.classList.add(name);
    return el;
  }

  function childUrl(name) {
    const u = new URL(location.href);
    u.hash = '';
    u.searchParams.set('channel', CHANNEL);
    u.searchParams.set('panel', name);
    return u.href;
  }

  function launcher() {
    $('owner-note').textContent = 'This window holds the feed. Keep it open; the others follow it.';
    $('role').textContent = 'this window';
    const stage = $('stage');
    stage.className = 'stage dash';
    const children = {};

    function showInline(name, el) {
      el.body.textContent = '';
      el.body.classList.toggle('fill', name === 'grid' || name === 'board');
      mount(name, el.body);
    }
    function poppedList() {
      let ul = document.getElementById('popped');
      if (!ul) {
        ul = document.createElement('ul');
        ul.id = 'popped';
        ul.className = 'chips popped';
        ul.setAttribute('aria-label', 'Panels open in their own window');
        document.querySelector('.top').insertBefore(ul, $('back'));
      }
      return ul;
    }
    function relayout() {
      const n = stage.querySelectorAll('.panel').length;
      stage.dataset.count = String(n);
    }
    function showAway(name, el) {
      unmount(name);
      el.body.classList.remove('fill');
      el.body.textContent = '';
      el.remove();
      const li = document.createElement('li');
      li.className = 'chip';
      li.dataset.panel = name;
      li.append(TITLES[name] + ' ');
      const back = document.createElement('button');
      back.type = 'button';
      back.className = 'btn btn-small';
      back.textContent = 'Bring back';
      back.setAttribute('aria-label', 'Bring back ' + TITLES[name]);
      back.onclick = () => bringBack(name, el);
      li.appendChild(back);
      poppedList().appendChild(li);
      relayout();
      rewire();
    }
    function bringBack(name, el) {
      const w = children[name];
      delete children[name];
      if (w && !w.closed) w.close();
      el.popBtn.disabled = false;
      const chip = document.querySelector('#popped [data-panel="' + name + '"]');
      if (chip) chip.remove();
      const ul = document.getElementById('popped');
      if (ul && !ul.children.length) ul.remove();
      // back into its own place in the order
      const after = ORDER.slice(ORDER.indexOf(name) + 1).map((n) => stage.querySelector('.panel[data-panel="' + n + '"]')).find(Boolean);
      stage.insertBefore(el, after || null);
      relayout();
      showInline(name, el);
    }

    ORDER.forEach((name) => {
      const el = panelEl(name, true);
      stage.appendChild(el);
      showInline(name, el);
      el.popBtn.onclick = () => {
        const w = window.open(childUrl(name), '_blank', 'popup,width=900,height=600');
        if (!w) {
          $('owner-note').textContent = 'The browser blocked the new window. Allow pop-ups for this page and try again.';
          return;
        }
        children[name] = w;
        el.popBtn.disabled = true;
        showAway(name, el);
        const timer = setInterval(() => {
          if (children[name] !== w) return clearInterval(timer);
          if (w.closed) { clearInterval(timer); bringBack(name, el); }
        }, 500);
      };
    });
    relayout();
    startFeed();
  }

  function panelWindow() {
    $('page-title').textContent = TITLES[PANEL];
    $('owner-note').textContent = 'Following the feed from the dashboard window.';
    $('role').textContent = 'another window';
    const u = new URL(location.href);
    u.searchParams.delete('panel');
    const back = $('back');
    back.hidden = false;
    back.href = u.href;
    back.onclick = (ev) => {
      if (window.opener && !window.opener.closed) { ev.preventDefault(); window.opener.focus(); window.close(); }
    };
    const stage = $('stage');
    stage.className = 'stage single';
    const el = panelEl(PANEL, false);
    el.querySelector('.panel-head').remove(); // the page heading already names the panel
    stage.appendChild(el);
    el.body.classList.toggle('fill', PANEL === 'grid' || PANEL === 'board');
    mount(PANEL, el.body);
  }

  /* ---------- start ---------- */
  $('channel').textContent = CHANNEL;
  loadAssets().then(() => {
    if (typeof LatticeGrid.setLicence === 'function') LatticeGrid.setLicence('LG1.eyJ2IjoxLCJwIjoibGF0dGljZS1ncmlkIiwidCI6IlRPQ0xPQ08gSW5jIC0gcHVibGljIGRlbW9zIiwiZSI6IjIwMzAtMDEtMDEiLCJkIjpbInRvY2xvY29pbmMuZ2l0aHViLmlvIl19.9De42ua3aCGpiMB6EVRP7Tv-upUlDI-0T07rlSPzvCrsqg8t4YJi7SRnStEpAg48uzmcG7il1fR_TfwkUE7iCA'); // toclocoinc.github.io
    router = LatticeGridDataRouter.createDataRouter({ key: 'id', rowKey: 'id', seq: true, overlap: true });
    if (PANEL && TITLES[PANEL]) panelWindow(); else launcher();
    const lastSeq = () => (typeof router.lastSeq === 'function' ? router.lastSeq() : router.lastSeq);
    setInterval(() => { $('seq').textContent = lastSeq() == null ? 0 : lastSeq(); }, 250);
  }).catch((err) => {
    $('owner-note').textContent = err.message;
    console.error(err);
  });
})();
