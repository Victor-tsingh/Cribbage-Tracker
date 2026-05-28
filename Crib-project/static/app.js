// Cribbage board client logic
const COLORS = ['#534AB7', '#1D9E75'];
const COLORS_LIGHT = ['#CECBF6', '#9FE1CB'];

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

function positionToCoord(score, playerIdx) {
  // Layout constants
  const padX = 40, padY = 30;
  const W = 700, H = 220;
  const usableW = W - padX * 2;
  const rowGap = 22;
  const playerGap = 24;
  const holesPerRow = 30;
  const rowsPerPlayer = 2;

  const baseY = padY + playerIdx * (rowsPerPlayer * rowGap + playerGap);

  if (score <= 0) {
    return { x: padX - 8, y: baseY };
  }

  const target = state.target;
  const clamped = Math.min(score, target);
  const totalHoles = holesPerRow * rowsPerPlayer; // 60 visual holes
  const ratio = clamped / target;
  const pos = ratio * (totalHoles - 1);
  const row = Math.floor(pos / holesPerRow);
  const idxInRow = pos - row * holesPerRow;
  const y = baseY + row * rowGap;
  const x = padX + (idxInRow / (holesPerRow - 1)) * usableW;
  return { x, y };
}

function escapeText(s) {
  return String(s).replace(/[<>&"']/g, c => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function drawBoard() {
  const padX = 40, padY = 30;
  const W = 700;
  const usableW = W - padX * 2;
  const rowGap = 22;
  const playerGap = 24;
  const holesPerRow = 30;
  const rowsPerPlayer = 2;

  let html = '';

  for (let p = 0; p < 2; p++) {
    const baseY = padY + p * (rowsPerPlayer * rowGap + playerGap);

    // Player label
    html += `<text x="${padX - 12}" y="${baseY + rowGap - 2}" text-anchor="end" font-size="11" font-weight="500" fill="${COLORS[p]}">${escapeText(state.names[p])}</text>`;

    // Holes
    for (let row = 0; row < rowsPerPlayer; row++) {
      const y = baseY + row * rowGap;
      for (let h = 0; h < holesPerRow; h++) {
        const x = padX + (h / (holesPerRow - 1)) * usableW;
        const isGroupAccent = Math.floor(h / 5) % 2 === 0;
        html += `<circle cx="${x.toFixed(1)}" cy="${y}" r="3.5" fill="${isGroupAccent ? '#f1efe8' : '#ffffff'}" stroke="rgba(0,0,0,0.15)" stroke-width="0.5"/>`;
      }
    }

    // Skunk line at 3/4
    const skunkScore = Math.floor(state.target * 3 / 4);
    const skunkCoord = positionToCoord(skunkScore, p);
    if (skunkCoord) {
      html += `<line x1="${skunkCoord.x}" y1="${skunkCoord.y - 10}" x2="${skunkCoord.x}" y2="${skunkCoord.y + 10}" stroke="#999" stroke-width="0.5" stroke-dasharray="2,2"/>`;
    }
  }

  // Game/finish hole
  const endX = padX + usableW;
  for (let p = 0; p < 2; p++) {
    const baseY = padY + p * (rowsPerPlayer * rowGap + playerGap);
    const cy = baseY + rowGap / 2;
    html += `<circle cx="${endX + 16}" cy="${cy}" r="6" fill="#ffffff" stroke="${COLORS[p]}" stroke-width="1.5"/>`;
    html += `<text x="${endX + 16}" y="${cy + 22}" text-anchor="middle" font-size="10" fill="#888">${state.target}</text>`;
  }

  // Pegs (front and back)
  for (let p = 0; p < 2; p++) {
    const prev = getPrevScore(p);
    const curr = state.scores[p];

    if (prev > 0) {
      const c = positionToCoord(prev, p);
      html += `<circle cx="${c.x}" cy="${c.y}" r="5" fill="${COLORS_LIGHT[p]}" stroke="${COLORS[p]}" stroke-width="1"/>`;
    }
    const c = positionToCoord(curr, p);
    html += `<circle cx="${c.x}" cy="${c.y}" r="5.5" fill="${COLORS[p]}" stroke="white" stroke-width="1.5"/>`;
  }

  $('#board').innerHTML = html;
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