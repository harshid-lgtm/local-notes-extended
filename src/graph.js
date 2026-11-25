// Interactive link graph (canvas + d3-force): pan, zoom, drag nodes, hover to
// highlight neighbours, click to open. Colours follow top-level folders.
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, forceX, forceY } from 'd3-force';

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// Distinct, evenly spaced hues per top-level folder (hashing clusters similar names).
const HUES = [212, 12, 145, 280, 38, 330, 180, 96, 255, 60];
let paletteOrder = [];
export function setFolders(folders) { paletteOrder = [...folders].filter(Boolean).sort(); }
export function folderColor(folder, dark) {
  if (!folder) return dark ? '#a9a7a1' : '#8a8883';
  let i = paletteOrder.indexOf(folder);
  if (i < 0) { let h = 0; for (const c of folder) h = (h * 31 + c.charCodeAt(0)) >>> 0; i = h; }
  const hue = HUES[i % HUES.length] + Math.floor(i / HUES.length) * 17;
  return `hsl(${hue} ${dark ? 65 : 60}% ${dark ? 66 : 52}%)`;
}

export function mountGraph(canvas, data, { current, onOpen, focus = null, depth = 2 } = {}) {
  const ctx = canvas.getContext('2d');
  let nodes = data.nodes.map((n) => ({ ...n }));
  let edges = data.edges.map((e) => ({ ...e }));

  // local graph: keep nodes within `depth` hops of the focused note
  if (focus) {
    const keep = new Set([focus]);
    let frontier = [focus];
    for (let d = 0; d < depth; d++) {
      const next = [];
      for (const e of edges) {
        for (const [a, b] of [[e.source, e.target], [e.target, e.source]]) {
          if (frontier.includes(a) && !keep.has(b)) { keep.add(b); next.push(b); }
        }
      }
      frontier = next;
    }
    nodes = nodes.filter((n) => keep.has(n.id));
    edges = edges.filter((e) => keep.has(e.source) && keep.has(e.target));
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const degree = new Map();
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) || 0) + 1);
    degree.set(e.target, (degree.get(e.target) || 0) + 1);
  }
  const neighbours = new Map(nodes.map((n) => [n.id, new Set()]));
  for (const e of edges) { neighbours.get(e.source)?.add(e.target); neighbours.get(e.target)?.add(e.source); }
  for (const n of nodes) n.r = 3.2 + Math.sqrt(degree.get(n.id) || 0) * 2.3;

  let filter = { orphans: true, unresolved: true, query: '' };
  const visible = (n) => (filter.orphans || degree.get(n.id)) && (filter.unresolved || !n.unresolved);

  let view = { x: 0, y: 0, k: 1 };
  let W = 0, H = 0, dpr = 1;
  let hover = null;
  let dragging = null;
  let alphaHover = 0; // eased highlight strength

  const sim = forceSimulation(nodes)
    .force('link', forceLink(edges).id((d) => d.id).distance(70).strength(0.5))
    .force('charge', forceManyBody().strength(-170).distanceMax(420))
    .force('center', forceCenter(0, 0))
    .force('x', forceX(0).strength(0.045))
    .force('y', forceY(0).strength(0.045))
    .force('collide', forceCollide().radius((d) => d.r + 4))
    .alphaDecay(0.025);

  function resize() {
    const r = canvas.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    W = r.width; H = r.height;
    canvas.width = W * dpr; canvas.height = H * dpr;
    draw();
  }

  const toWorld = (px, py) => ({ x: (px - W / 2 - view.x) / view.k, y: (py - H / 2 - view.y) / view.k });

  function pick(px, py) {
    const p = toWorld(px, py);
    let best = null, bestD = Infinity;
    for (const n of nodes) {
      if (!visible(n)) continue;
      const d = Math.hypot(n.x - p.x, n.y - p.y);
      if (d < n.r + 6 / view.k && d < bestD) { best = n; bestD = d; }
    }
    return best;
  }

  function draw() {
    const dark = document.documentElement.dataset.theme === 'dark';
    const text = css('--text') || '#222';
    const muted = css('--text-3') || '#999';
    const accent = css('--accent') || '#2f76e4';
    const q = filter.query.toLowerCase();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.translate(W / 2 + view.x, H / 2 + view.y);
    ctx.scale(view.k, view.k);
    alphaHover += ((hover ? 1 : 0) - alphaHover) * 0.25;
    const focusSet = hover ? neighbours.get(hover.id) : null;
    const isLit = (n) => !hover || n === hover || focusSet.has(n.id);
    const matches = (n) => !q || n.name.toLowerCase().includes(q);

    // edges
    ctx.lineWidth = 1 / Math.max(0.6, view.k);
    for (const e of edges) {
      const s = e.source, t = e.target;
      if (!visible(s) || !visible(t)) continue;
      const lit = hover && (s === hover || t === hover);
      ctx.strokeStyle = lit ? accent : (dark ? 'rgba(255,255,255,0.12)' : 'rgba(40,38,34,0.13)');
      ctx.globalAlpha = lit ? 0.9 : hover ? 1 - 0.7 * alphaHover : (q && !(matches(s) || matches(t)) ? 0.35 : 1);
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(t.x, t.y); ctx.stroke();
    }
    // nodes
    for (const n of nodes) {
      if (!visible(n)) continue;
      const lit = isLit(n);
      ctx.globalAlpha = (lit ? 1 : 1 - 0.75 * alphaHover) * (q && !matches(n) ? 0.2 : 1);
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      if (n.unresolved) {
        ctx.fillStyle = dark ? '#191918' : '#fff';
        ctx.fill();
        ctx.setLineDash([2, 2]); ctx.strokeStyle = muted; ctx.lineWidth = 1.2 / view.k; ctx.stroke(); ctx.setLineDash([]);
      } else {
        ctx.fillStyle = n.id === current ? accent : n === hover ? accent : folderColor(n.folder, dark);
        ctx.fill();
      }
      if (n.id === current) {
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r + 4, 0, Math.PI * 2);
        ctx.strokeStyle = accent; ctx.globalAlpha *= 0.35; ctx.lineWidth = 3 / view.k; ctx.stroke();
      }
    }
    // labels: always for hovered + neighbours; for everyone once zoomed in
    const showAll = view.k > 1.15 || nodes.length < 40;
    ctx.font = `${12 / Math.max(view.k, 0.8)}px 'Inter Variable', system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const n of nodes) {
      if (!visible(n)) continue;
      const lit = isLit(n);
      const forced = hover && lit;
      if (!showAll && !forced && n.id !== current && !(q && matches(n))) continue;
      ctx.globalAlpha = forced || n.id === current ? 1 : (hover ? 1 - 0.8 * alphaHover : Math.min(1, (view.k - 0.6) * 1.6)) * (q && !matches(n) ? 0.2 : 1);
      if (ctx.globalAlpha <= 0.02) continue;
      ctx.fillStyle = n === hover ? text : muted;
      if (n === hover || n.id === current) ctx.fillStyle = text;
      ctx.fillText(n.name, n.x, n.y + n.r + 4 / view.k);
    }
    ctx.globalAlpha = 1;
    if (Math.abs(alphaHover - (hover ? 1 : 0)) > 0.01) requestAnimationFrame(draw);
  }

  sim.on('tick', draw);

  // first frame: fit once the layout has settled a little
  let fitted = false;
  sim.on('end', () => { if (!fitted) { fit(); fitted = true; } });
  setTimeout(() => { if (!fitted) { fit(); fitted = true; } }, 1200);

  function fit() {
    const vs = nodes.filter(visible);
    if (!vs.length || !W) return;
    const xs = vs.map((n) => n.x), ys = vs.map((n) => n.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const k = Math.min(2.2, Math.max(0.25, Math.min((W - 120) / (maxX - minX || 1), (H - 120) / (maxY - minY || 1))));
    animateTo({ k, x: -((minX + maxX) / 2) * k, y: -((minY + maxY) / 2) * k });
  }

  function animateTo(target) {
    const start = { ...view };
    const t0 = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - t0) / 420);
      const e = 1 - Math.pow(1 - t, 3);
      view = { x: start.x + (target.x - start.x) * e, y: start.y + (target.y - start.y) * e, k: start.k + (target.k - start.k) * e };
      draw();
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // ---- interaction
  let panStart = null;
  let moved = false;
  const local = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    const p = local(e);
    moved = false;
    const n = pick(p.x, p.y);
    if (n) { dragging = n; n.fx = n.x; n.fy = n.y; sim.alphaTarget(0.25).restart(); }
    else panStart = { x: p.x - view.x, y: p.y - view.y };
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = local(e);
    if (dragging) {
      moved = true;
      const w = toWorld(p.x, p.y);
      dragging.fx = w.x; dragging.fy = w.y;
    } else if (panStart) {
      moved = true;
      view.x = p.x - panStart.x; view.y = p.y - panStart.y;
      draw();
    } else {
      const n = pick(p.x, p.y);
      if (n !== hover) { hover = n; canvas.style.cursor = n ? 'pointer' : 'grab'; draw(); }
    }
  });
  const end = () => {
    if (dragging) {
      if (!moved && !dragging.unresolved) onOpen?.(dragging.id);
      dragging.fx = null; dragging.fy = null; sim.alphaTarget(0);
    }
    dragging = null; panStart = null;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointerleave', () => { if (!dragging && !panStart && hover) { hover = null; draw(); } });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = local(e);
    const k = Math.min(5, Math.max(0.15, view.k * Math.exp(-e.deltaY * 0.0015)));
    const w = toWorld(p.x, p.y);
    view.k = k;
    view.x = p.x - W / 2 - w.x * k;
    view.y = p.y - H / 2 - w.y * k;
    draw();
  }, { passive: false });

  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  return {
    setFilter(f) { filter = { ...filter, ...f }; draw(); },
    zoom(f) { animateTo({ ...view, k: Math.min(5, Math.max(0.15, view.k * f)), x: view.x * f, y: view.y * f }); },
    fit,
    redraw: draw,
    stats: () => ({ nodes: nodes.filter((n) => !n.unresolved).length, edges: edges.length }),
    destroy() { sim.stop(); ro.disconnect(); },
  };
}
