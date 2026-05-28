// Cribbage board client logic
const COLORS = ['#cc2222', '#2255cc'];
const COLORS_LIGHT = ['#f4b3b3', '#aac4f0'];

let state = window.INITIAL_STATE;

function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

async function api(path, body) {
  const opts = body ? {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  } : {};
  const res = await fetch(path, opts);
  return res.json();
}

function getPrevScore(playerIdx) {
  for (let i = state.history.length - 1; i >= 0; i--) {
    if (state.history[i].player === playerIdx) {
      return state.history[i].before;
    }
  }
  return 0;
}

// ---- Serpentine track geometry ----
// The board is a single snaking centerline: straight run left->right,
// U-turn down, straight run right->left, U-turn down, straight run left->right.
// Each player's lane is offset perpendicular to this centerline.

const BOARD = {
  W: 700,
  marginX: 70,
  topY: 60,
  laneGap: 70,      // vertical distance between the 3 straight runs (centerlines)
  turnR: 35,        // radius of the U-turn arcs
  laneOffset: 11,   // how far each player's lane sits from the centerline
  rows: 3           // number of straight runs
};

// Build the centerline as an ordered list of segments with cumulative length.
function buildCenterline() {
  const { W, marginX, topY, laneGap, turnR, rows } = BOARD;
  const leftX = marginX;
  const rightX = W - marginX;
  const segs = [];

  for (let r = 0; r < rows; r++) {
    const y = topY + r * laneGap;
    const goingRight = r % 2 === 0;

    if (goingRight) {
      segs.push({ type: 'line', x1: leftX, y1: y, x2: rightX, y2: y });
    } else {
      segs.push({ type: 'line', x1: rightX, y1: y, x2: leftX, y2: y });
    }

    if (r < rows - 1) {
      const nextY = topY + (r + 1) * laneGap;
      const cy = (y + nextY) / 2;
      if (goingRight) {
        segs.push({ type: 'arc', cx: rightX, cy: cy, r: turnR, dir: 1 });
      } else {
        segs.push({ type: 'arc', cx: leftX, cy: cy, r: turnR, dir: -1 });
      }
    }
  }

  let total = 0;
  for (const s of segs) {
    s.len = (s.type === 'line') ? Math.hypot(s.x2 - s.x1, s.y2 - s.y1) : Math.PI * s.r;
    s.cumStart = total;
    total += s.len;
  }
  return { segs, total };
}

// Point + perpendicular normal at distance d along the centerline.
function pointAtDistance(track, d) {
  d = Math.max(0, Math.min(d, track.total));
  for (const s of track.segs) {
    if (d <= s.cumStart + s.len || s === track.segs[track.segs.length - 1]) {
      const local = d - s.cumStart;
      if (s.type === 'line') {
        const t = s.len === 0 ? 0 : local / s.len;
        const x = s.x1 + (s.x2 - s.x1) * t;
        const y = s.y1 + (s.y2 - s.y1) * t;
        const tx = (s.x2 - s.x1) / s.len, ty = (s.y2 - s.y1) / s.len;
        return { x, y, nx: -ty, ny: tx };
      } else {
        const t = local / s.len;
        let ang = (s.dir === 1) ? (-Math.PI / 2 + Math.PI * t) : (-Math.PI / 2 - Math.PI * t);
        const x = s.cx + s.r * Math.cos(ang);
        const y = s.cy + s.r * Math.sin(ang);
        let tx = -Math.sin(ang) * (s.dir === 1 ? 1 : -1);
        let ty = Math.cos(ang) * (s.dir === 1 ? 1 : -1);
        const mag = Math.hypot(tx, ty) || 1;
        return { x, y, nx: -ty / mag, ny: tx / mag };
      }
    }
  }
  const last = track.segs[track.segs.length - 1];
  return { x: last.x2, y: last.y2, nx: 0, ny: 1 };
}

// Get screen coordinate for a player's peg at a given score.
function positionToCoord(score, playerIdx, track) {
  const target = state.target;
  const off = (playerIdx === 0 ? -1 : 1) * BOARD.laneOffset;
  const clamped = Math.max(0, Math.min(score, target));
  const d = (clamped / target) * track.total;
  const p = pointAtDistance(track, d);
  return { x: p.x + p.nx * off, y: p.y + p.ny * off };
}

function escapeText(s) {
  return String(s).replace(/[<>&"']/g, c => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function drawBoard() {
  const track = buildCenterline();
  const HOLES = 60;            // visual holes along the track
  let html = '';

  // Draw the lane "ribbons" — a colored stroke following the centerline, offset per player.
  // We approximate each lane as a polyline of sampled points.
  function lanePath(off) {
    const pts = [];
    const steps = 240;
    for (let i = 0; i <= steps; i++) {
      const d = (i / steps) * track.total;
      const p = pointAtDistance(track, d);
      pts.push([p.x + p.nx * off, p.y + p.ny * off]);
    }
    return 'M ' + pts.map(pt => `${pt[0].toFixed(1)} ${pt[1].toFixed(1)}`).join(' L ');
  }

  // Lane channels: a dark base stroke (the carved groove) under a colored ribbon on top.
  // Player 0 (purple) and player 1 (green) lanes, each offset from the centerline.
  const laneW = 15;

  // Dark groove base for both lanes (gives a recessed look)
  html += `<path d="${lanePath(-BOARD.laneOffset)}" fill="none" stroke="#6b4f33" stroke-width="${laneW + 3}" stroke-linecap="round" stroke-linejoin="round" opacity="0.35"/>`;
  html += `<path d="${lanePath(BOARD.laneOffset)}" fill="none" stroke="#6b4f33" stroke-width="${laneW + 3}" stroke-linecap="round" stroke-linejoin="round" opacity="0.35"/>`;

  // Colored lane ribbons on top
  html += `<path d="${lanePath(-BOARD.laneOffset)}" fill="none" stroke="${COLORS_LIGHT[0]}" stroke-width="${laneW}" stroke-linecap="round" stroke-linejoin="round"/>`;
  html += `<path d="${lanePath(BOARD.laneOffset)}" fill="none" stroke="${COLORS_LIGHT[1]}" stroke-width="${laneW}" stroke-linecap="round" stroke-linejoin="round"/>`;

  // Holes for each player's lane — recessed look: dark dot with a faint light ring
  for (let p = 0; p < 2; p++) {
    const off = (p === 0 ? -1 : 1) * BOARD.laneOffset;
    for (let h = 0; h <= HOLES; h++) {
      const d = (h / HOLES) * track.total;
      const pt = pointAtDistance(track, d);
      const x = pt.x + pt.nx * off;
      const y = pt.y + pt.ny * off;
      html += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.1" fill="#2e2113"/>`;
    }
  }

  // Start markers (S) and finish hole at the end of the track
  const startP = pointAtDistance(track, 0);
  const endP = pointAtDistance(track, track.total);
  html += `<text x="${startP.x - 14}" y="${startP.y + 4}" font-size="11" font-weight="600" fill="#5a4632">S</text>`;
  for (let p = 0; p < 2; p++) {
    const off = (p === 0 ? -1 : 1) * BOARD.laneOffset;
    html += `<circle cx="${(endP.x + endP.nx * off).toFixed(1)}" cy="${(endP.y + endP.ny * off).toFixed(1)}" r="3.6" fill="none" stroke="${COLORS[p]}" stroke-width="1.5"/>`;
  }
  html += `<text x="${endP.x + 16}" y="${endP.y + 4}" font-size="11" font-weight="600" fill="#5a4632">${state.target}</text>`;

  // Skunk line — at 3/4 of the target, drawn black across both lanes with an "S" beside it
  const skunkScore = Math.floor(state.target * 3 / 4);
  const skunkD = (skunkScore / state.target) * track.total;
  const sp = pointAtDistance(track, skunkD);
  const reach = BOARD.laneOffset + 9; // extend just past both lanes
  const sx1 = sp.x + sp.nx * reach, sy1 = sp.y + sp.ny * reach;
  const sx2 = sp.x - sp.nx * reach, sy2 = sp.y - sp.ny * reach;
  html += `<line x1="${sx1.toFixed(1)}" y1="${sy1.toFixed(1)}" x2="${sx2.toFixed(1)}" y2="${sy2.toFixed(1)}" stroke="#000000" stroke-width="2"/>`;
  // "S" label just outside the line, offset along the normal
  const lx = sp.x + sp.nx * (reach + 9), ly = sp.y + sp.ny * (reach + 9);
  html += `<text x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}" font-size="12" font-weight="700" fill="#000000" text-anchor="middle">S</text>`;

  // Pegs — back peg (previous score, lighter) and front peg (current, solid)
  for (let p = 0; p < 2; p++) {
    const prev = getPrevScore(p);
    const curr = state.scores[p];

    if (prev > 0) {
      const c = positionToCoord(prev, p, track);
      html += pegSvg(c.x, c.y, COLORS_LIGHT[p], COLORS[p], 4.2);
    }
    const c = positionToCoord(curr, p, track);
    html += pegSvg(c.x, c.y, COLORS[p], '#ffffff', 5);
  }

  $('#board').innerHTML = html;
}

function pegSvg(x, y, fill, stroke, r) {
  return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
}

function renderScores() {
  $$('.score').forEach(el => {
    const p = parseInt(el.dataset.player);
    el.textContent = state.scores[p];
  });
  $$('.target-display').forEach(el => el.textContent = state.target);
}

function renderWinner() {
  const banner = $('#winner-banner');
  if (state.winner) {
    const w = state.winner;
    let msg = `${w.name} wins ${state.scores[w.player]}–${w.loser_score}`;
    if (w.status === 'skunk') msg += ' — skunk!';
    if (w.status === 'double_skunk') msg += ' — double skunk!';
    banner.textContent = msg;
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
}

function renderHistory() {
  const log = $('#history-log');
  if (!state.history.length) {
    log.innerHTML = '<div class="empty">No plays yet.</div>';
    return;
  }
  log.innerHTML = state.history.slice().reverse().map(h => {
    const sign = h.points >= 0 ? '+' : '';
    return `<div class="history-item">
      <span class="who p${h.player}">${escapeText(state.names[h.player])}</span>
      <span>${sign}${h.points}</span>
      <span style="color:#999;">→ ${h.after}</span>
      <span style="color:#bbb; margin-left:auto;">${h.time || ''}</span>
    </div>`;
  }).join('');
}

function render() {
  renderScores();
  renderWinner();
  renderHistory();
  drawBoard();
}

// Wire up events
$$('.peg-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const player = parseInt(btn.dataset.player);
    const points = parseInt(btn.dataset.points);
    state = await api('/api/peg', { player, points });
    render();
  });
});

$$('.custom-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const player = parseInt(btn.dataset.player);
    const input = document.querySelector(`.custom-input[data-player="${player}"]`);
    const v = parseInt(input.value);
    if (!isNaN(v)) {
      state = await api('/api/peg', { player, points: v });
      input.value = '';
      render();
    }
  });
});

$$('.custom-input').forEach(input => {
  input.addEventListener('keydown', async e => {
    if (e.key === 'Enter') {
      const player = parseInt(input.dataset.player);
      const v = parseInt(input.value);
      if (!isNaN(v)) {
        state = await api('/api/peg', { player, points: v });
        input.value = '';
        render();
      }
    }
  });
});

$$('.player-name').forEach(input => {
  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const body = {};
      body[`player${parseInt(input.dataset.player) + 1}`] = input.value;
      state = await api('/api/names', body);
      render();
    }, 300);
  });
});

$('#undo-btn').addEventListener('click', async () => {
  state = await api('/api/undo', {});
  render();
});

$('#reset-btn').addEventListener('click', async () => {
  if (state.history.length && !confirm('Reset the game?')) return;
  const target = parseInt($('#target-score').value);
  state = await api('/api/reset', { target });
  render();
});

$('#target-score').addEventListener('change', async () => {
  if (state.history.length && !confirm('Changing the target resets the game. Continue?')) {
    $('#target-score').value = state.target;
    return;
  }
  const target = parseInt($('#target-score').value);
  state = await api('/api/reset', { target });
  render();
});

render();