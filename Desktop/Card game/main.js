const SUITS      = ['♠','♥','♣','♦'];
const SUIT_NAMES = ['Spades','Hearts','Clubs','Diamonds'];
const RANKS      = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
const RED_SUITS  = new Set(['♥','♦']);
const FACE_RANKS = new Set(['J','Q','K']);
const FACE_ICONS = { 'J': '♞', 'Q': '♛', 'K': '♚' };

// Pip layout: [left%, top%, flipped]
const PIP_LAYOUTS = {
  'A':  [[50,50,false]],
  '2':  [[50,22,false],[50,78,true]],
  '3':  [[50,19,false],[50,50,false],[50,81,true]],
  '4':  [[27,22,false],[73,22,false],[27,78,true],[73,78,true]],
  '5':  [[27,22,false],[73,22,false],[50,50,false],[27,78,true],[73,78,true]],
  '6':  [[27,22,false],[73,22,false],[27,50,false],[73,50,false],[27,78,true],[73,78,true]],
  '7':  [[27,20,false],[73,20,false],[50,36,false],[27,53,false],[73,53,false],[27,78,true],[73,78,true]],
  '8':  [[27,20,false],[73,20,false],[50,35,false],[27,52,false],[73,52,false],[50,65,true],[27,80,true],[73,80,true]],
  '9':  [[27,20,false],[73,20,false],[27,39,false],[73,39,false],[50,50,false],[27,61,true],[73,61,true],[27,80,true],[73,80,true]],
  '10': [[27,18,false],[73,18,false],[50,31,false],[27,44,false],[73,44,false],[27,58,true],[73,58,true],[50,69,true],[27,82,true],[73,82,true]],
};

const MIN = 2, MAX = 13;
let labelCount   = 4;
let nextLabel    = 0;
let blankCounter = 0;

const assignments   = {};        // cardId → slotIndex
const labelNames    = {};        // slotIndex → string
const foldedLabels  = new Set();

const CARD_MIN = 2, CARD_MAX = 5;
let cardLimit = 5;

const DECK_PRESETS = [
  new Set(['A','6','7','8','9','10','J','Q','K']),
  new Set(['A','7','8','9','10','J','Q','K']),
  new Set(['A','8','9','10','J','Q','K']),
  new Set(['A','9','10','J','Q','K']),
  new Set(['A','10','J','Q','K']),
  null,
];
let activeDeckPreset = 5;

// Split card sub-slot state
const splitContents = {};  // splitId → [cardId|null, cardId|null]
const splitSlots    = {};  // cardId  → { splitId, half }
let activeSplitTarget = null; // { splitId, half } | null  — which half is waiting for a card

// Shared "head" row: 8 independent blank cards, each can hold any playing card
const HEAD_COUNT = 8;
const headSlots = new Array(HEAD_COUNT).fill(null); // index → cardId | null
let activeHeadTarget = null; // index | null — which head slot is waiting for a card

// Custom Table: numbered slots (count selectable 1–52), each can hold any
// playing card. Clicking a filled slot rotates the row so that slot (and
// everything after it) leads.
const ROW_MIN = 1, ROW_MAX = 52;
let rowCount = 12;
const rowSlots = new Array(rowCount).fill(null); // index → cardId | null
let activeRowTarget = null; // index | null — which row slot is waiting for a card
let rowSlotClickTimer = null; // pending single-click cut, cancelled by a double-click

/* ── Resize the Custom Table. Shrinking drops the trailing slots (any cards
     in them simply become unplaced again); growing appends empty slots. ── */
function setRowCount(n) {
  n = Math.max(ROW_MIN, Math.min(ROW_MAX, n));
  if (n === rowSlots.length) return;
  pushHistory();
  if (n < rowSlots.length) {
    rowSlots.length = n;
  } else {
    while (rowSlots.length < n) rowSlots.push(null);
  }
  rowCount = n;
  if (activeRowTarget !== null && activeRowTarget >= rowCount) activeRowTarget = null;
  renderCards();
  updateStatus();
}

/* ── Undo/Redo: snapshot every card-placement mutation before it happens so
     it can be reverted, and the reverted state can be re-applied (redo). ── */
const HISTORY_LIMIT = 50;
let undoStack = [];
let redoStack = [];

function snapshotState() {
  return {
    assignments: { ...assignments },
    splitContents: JSON.parse(JSON.stringify(splitContents)),
    splitSlots: JSON.parse(JSON.stringify(splitSlots)),
    headSlots: [...headSlots],
    rowSlots: [...rowSlots],
    rowCount,
    nextLabel,
    activeSplitTarget: activeSplitTarget ? { ...activeSplitTarget } : null,
    activeHeadTarget,
    activeRowTarget,
  };
}

function restoreState(snap) {
  Object.keys(assignments).forEach(k => delete assignments[k]);
  Object.assign(assignments, snap.assignments);

  Object.keys(splitContents).forEach(k => delete splitContents[k]);
  Object.assign(splitContents, snap.splitContents);

  Object.keys(splitSlots).forEach(k => delete splitSlots[k]);
  Object.assign(splitSlots, snap.splitSlots);

  headSlots.splice(0, headSlots.length, ...snap.headSlots);
  rowSlots.splice(0, rowSlots.length, ...snap.rowSlots);
  rowCount = snap.rowCount;

  nextLabel        = snap.nextLabel;
  activeSplitTarget = snap.activeSplitTarget;
  activeHeadTarget  = snap.activeHeadTarget;
  activeRowTarget   = snap.activeRowTarget;

  renderLabels();
  renderCards();
  updateStatus();
}

function pushHistory() {
  undoStack.push(snapshotState());
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
  redoStack = [];
}

function undoLastChange() {
  if (undoStack.length === 0) return;
  redoStack.push(snapshotState());
  restoreState(undoStack.pop());
}

function redoLastChange() {
  if (redoStack.length === 0) return;
  undoStack.push(snapshotState());
  restoreState(redoStack.pop());
}

function isInSplit(id) { return id in splitSlots; }
function isInHead(id)  { return headSlots.includes(id); }
function isInRow(id)   { return rowSlots.includes(id); }
function isPlaced(id)  { return (id in assignments) || isInSplit(id) || isInHead(id) || isInRow(id); }

function countAssigned(i) { return Object.values(assignments).filter(x => x === i).length; }

function isRed(suit)     { return RED_SUITS.has(suit); }
function clr(suit)       {
  if (suit === '♠') return 'suit-spade';
  if (suit === '♥') return 'suit-heart';
  if (suit === '♣') return 'suit-club';
  if (suit === '♦') return 'suit-diamond';
  return 'suit-spade';
}
function cid(suit, rank) { return `${rank}|${suit}`; }
function parseId(id)     { const [rank, suit] = id.split('|'); return { rank, suit }; }

// Fixed per-suit display order — never reordered by picking a card, so the
// deck line always stays in its original A→K order (same slots throughout).
const suitOrder = {};
SUITS.forEach(suit => { suitOrder[suit] = RANKS.map(rank => cid(suit, rank)); });

/* ── Build a deck-line card (overlapping, interactive) ── */
const DECK_STEP_X = 16;

function buildCard(suit, rank, index, total, onClick = onCardClick) {
  const id     = cid(suit, rank);
  const c      = clr(suit);
  const placed = isPlaced(id);

  const div = document.createElement('div');
  div.className = `deck-card ${c}${placed ? ' placed' : ''}`;
  div.dataset.cardId = id;
  div.style.left   = `${index * DECK_STEP_X}px`;
  div.style.zIndex = total - index;

  div.innerHTML = `
    <div class="deck-corner">
      <span class="dr">${rank}</span>
      <span class="ds">${suit}</span>
    </div>`;

  div.addEventListener('click', () => onClick(id));

  if (index === 0 && onClick === onCardClick) {
    div.title = 'Double-click to deal this suit to players, then Blank Cards';
    div.addEventListener('dblclick', () => autoDealRow(suit));
  }

  return div;
}

/* ── Auto-assign on click ── */
function onCardClick(id) {
  // Card already in a player slot → unassign
  if (id in assignments) { unassignCard(id); return; }

  // Card already in a split sub-slot → remove from split
  if (isInSplit(id)) { removeSplitSubCard(id); return; }

  // Card already in a head slot → remove from head
  if (isInHead(id)) { removeCardFromHeadById(id); return; }

  // Card already in the Custom Table → remove from it
  if (isInRow(id)) { removeCardFromRowById(id); return; }

  // Split target active → fill that specific half
  if (activeSplitTarget) {
    assignToSplit(id, activeSplitTarget.splitId, activeSplitTarget.half);
    return;
  }

  // Head target active → fill that specific blank slot
  if (activeHeadTarget !== null) {
    assignToHead(id);
    return;
  }

  // Row target active → fill that specific numbered slot
  if (activeRowTarget !== null) {
    assignToRow(id);
    return;
  }

  // Normal assign to next available player
  let target = null;
  for (let checked = 0; checked < labelCount; checked++) {
    const candidate = (nextLabel + checked) % labelCount;
    if (countAssigned(candidate) < cardLimit) { target = candidate; break; }
  }
  if (target === null) return;
  assignCard(id, target);
  nextLabel = (target + 1) % labelCount;
  updateStatus();
}

/* ── Double-click the first (fully shown) card in a Full Deck row: deal every
     not-yet-placed card in that suit, in order — filling players in rotation
     first, then once players are full, filling Blank Card slots in order. ── */
function autoDealRow(suit) {
  const cards = suitOrder[suit].filter(id => !isPlaced(id));
  if (cards.length === 0) return;
  pushHistory();

  for (const id of cards) {
    let target = null;
    for (let checked = 0; checked < labelCount; checked++) {
      const candidate = (nextLabel + checked) % labelCount;
      if (countAssigned(candidate) < cardLimit) { target = candidate; break; }
    }
    if (target !== null) {
      assignments[id] = target;
      nextLabel = (target + 1) % labelCount;
      continue;
    }
    const blankIdx = headSlots.indexOf(null);
    if (blankIdx === -1) break; // players and blanks both full
    headSlots[blankIdx] = id;
  }

  renderLabels();
  renderCards();
  updateStatus();
}

/* ── Split sub-slot assignment ── */
function assignToSplit(cardId, splitId, half) {
  pushHistory();
  splitContents[splitId][half] = cardId;
  splitSlots[cardId] = { splitId, half };
  activeSplitTarget = null;
  renderLabels();
  renderCards();
  updateStatus();
}

function removeSplitSubCard(cardId) {
  pushHistory();
  const { splitId, half } = splitSlots[cardId];
  splitContents[splitId][half] = null;
  delete splitSlots[cardId];
  renderLabels();
  renderCards();
  updateStatus();
}

/* ── Head row assignment (8 shared blank slots) ── */
function assignToHead(cardId) {
  pushHistory();
  headSlots[activeHeadTarget] = cardId;
  let next = null;
  for (let i = activeHeadTarget + 1; i < HEAD_COUNT; i++) {
    if (headSlots[i] === null) { next = i; break; }
  }
  activeHeadTarget = next;
  renderLabels();
  renderCards();
  updateStatus();
}

function removeFromHead(index) {
  pushHistory();
  headSlots[index] = null;
  renderLabels();
  renderCards();
  updateStatus();
}

function removeCardFromHeadById(cardId) {
  const index = headSlots.indexOf(cardId);
  if (index !== -1) removeFromHead(index);
}

function toggleHeadTarget(i) {
  if (activeHeadTarget === i) {
    activeHeadTarget = null;
  } else {
    activeHeadTarget = i;
    activeSplitTarget = null;
    activeRowTarget = null;
  }
  renderLabels();
  renderCards();
  updateStatus();
}

/* ── Custom Table (selectable slot count) ── */
function assignToRow(cardId) {
  pushHistory();
  rowSlots[activeRowTarget] = cardId;
  activeRowTarget = null;
  renderLabels();
  renderCards();
  updateStatus();
}

function removeFromRow(index) {
  pushHistory();
  rowSlots[index] = null;
  renderLabels();
  renderCards();
  updateStatus();
}

function removeCardFromRowById(cardId) {
  const index = rowSlots.indexOf(cardId);
  if (index !== -1) removeFromRow(index);
}

function toggleRowTarget(i) {
  if (activeRowTarget === i) {
    activeRowTarget = null;
  } else {
    activeRowTarget = i;
    activeSplitTarget = null;
    activeHeadTarget = null;
  }
  renderCards();
  updateStatus();
}

/* ── Deal a filled Custom Table slot straight to its matching player: slot 1
     → player 1, slot 2 → player 2, ... wrapping around by labelCount. ── */
function dealRowSlotToPlayer(index) {
  const cardId = rowSlots[index];
  if (!cardId) return;
  pushHistory();
  rowSlots[index] = null;
  if (activeRowTarget === index) activeRowTarget = null;
  assignments[cardId] = index % labelCount;
  renderLabels();
  renderCards();
  updateStatus();
}

/* ── Double-click the Custom Table's first slot: deal every filled slot, in
     order, to players in rotation — respecting each player's card limit —
     then once players are full, continue into Blank Card slots in order. ── */
function dealAllRowSlotsToPlayers() {
  if (!rowSlots.some(id => id !== null)) return;
  pushHistory();
  const dealt = new Set();

  rowSlots.forEach(cardId => {
    if (!cardId) return;

    let target = null;
    for (let checked = 0; checked < labelCount; checked++) {
      const candidate = (nextLabel + checked) % labelCount;
      if (countAssigned(candidate) < cardLimit) { target = candidate; break; }
    }
    if (target !== null) {
      assignments[cardId] = target;
      nextLabel = (target + 1) % labelCount;
      dealt.add(cardId);
      return;
    }

    const blankIdx = headSlots.indexOf(null);
    if (blankIdx === -1) return; // players and blanks both full, leave this card in the table
    headSlots[blankIdx] = cardId;
    dealt.add(cardId);
  });

  rowSlots.forEach((cardId, i) => {
    if (cardId && dealt.has(cardId)) rowSlots[i] = null;
  });

  activeRowTarget = null;
  renderLabels();
  renderCards();
  updateStatus();
}

/* ── Single-click on a filled Custom Table slot: cut the table there, that
     card and everything after it move to the start, restoring the order. ── */
function cutRowAt(index) {
  if (index === 0) return; // already at the front, nothing to cut
  pushHistory();
  const rotated = [...rowSlots.slice(index), ...rowSlots.slice(0, index)];
  rowSlots.splice(0, rowSlots.length, ...rotated);
  renderCards();
}

/* ── Table Deck: a second full deck placed beside the Full Deck. Clicking a
     card here (instead of assigning it to a player) drops it straight into
     the next empty Custom Table slot. ── */
function onTableDeckCardClick(id) {
  if (id in assignments) { unassignCard(id); return; }
  if (isInSplit(id)) { removeSplitSubCard(id); return; }
  if (isInHead(id)) { removeCardFromHeadById(id); return; }
  if (isInRow(id)) { removeCardFromRowById(id); return; }

  const idx = rowSlots.indexOf(null);
  if (idx === -1) { updateStatus(); return; } // Custom Table is full
  pushHistory();
  rowSlots[idx] = id;
  activeRowTarget = null;
  renderCards();
  updateStatus();
}

/* ── Status bar ── */
function updateStatus() {
  const bar = document.getElementById('status-bar');

  if (activeSplitTarget) {
    bar.innerHTML = `Click any card to fill <span>Split slot</span> &nbsp;·&nbsp; Click the slot again to cancel`;
    return;
  }

  if (activeHeadTarget !== null) {
    bar.innerHTML = `Click any card to fill <span>Blank slot ${activeHeadTarget + 1}</span> &nbsp;·&nbsp; Click the slot again to cancel`;
    return;
  }

  if (activeRowTarget !== null) {
    bar.innerHTML = `Click any card to fill <span>Table slot ${activeRowTarget + 1}</span> &nbsp;·&nbsp; Click the slot again to cancel`;
    return;
  }

  let display = null;
  for (let checked = 0; checked < labelCount; checked++) {
    const candidate = (nextLabel + checked) % labelCount;
    if (countAssigned(candidate) < cardLimit) { display = candidate; break; }
  }
  if (display === null) {
    bar.innerHTML = `All players are full &nbsp;·&nbsp; Click an assigned card to remove it`;
    return;
  }
  const name = (labelNames[display] !== undefined && labelNames[display] !== '')
    ? labelNames[display]
    : `Player ${display + 1}`;
  bar.innerHTML = `Next card &rarr; <span>${name}</span> &nbsp;·&nbsp; Click an assigned card to remove it`;
}

/* ── Render label slots ── */
function renderLabels() {
  const panel = document.getElementById('labels-panel');

  panel.querySelectorAll('.label-slot').forEach(s => {
    const i   = +s.dataset.index;
    const inp = s.querySelector('.slot-name');
    if (inp) labelNames[i] = inp.value;
  });

  Object.keys(assignments).forEach(id => {
    if (assignments[id] >= labelCount) delete assignments[id];
  });
  foldedLabels.forEach(i => { if (i >= labelCount) foldedLabels.delete(i); });
  if (nextLabel >= labelCount) { nextLabel = 0; updateStatus(); }

  const title = panel.querySelector('.panel-title');
  panel.innerHTML = '';
  panel.appendChild(title);

  for (let i = 0; i < labelCount; i++) {
    const folded = foldedLabels.has(i);

    const slot = document.createElement('div');
    slot.className = `label-slot${folded ? ' folded' : ''}`;
    slot.dataset.index = i;

    const assigned = Object.entries(assignments)
      .filter(([, idx]) => idx === i)
      .map(([id]) => id);

    const name = labelNames[i] ?? `Player ${i + 1}`;

    slot.innerHTML = `
      <div class="slot-header">
        <input class="slot-name" type="text" placeholder="Player ${i + 1}" value="${name}">
        <button class="fold-btn${folded ? ' is-folded' : ''}" data-index="${i}" title="${folded ? 'Unfold' : 'Fold'}">
          ${folded ? '&#8617; Unfold' : '&#10006; Fold'}
        </button>
      </div>
      <div class="slot-cards">
        ${assigned.map(miniCardHTML).join('')}
      </div>`;

    slot.querySelector('.slot-name').addEventListener('input', e => {
      labelNames[i] = e.target.value;
      updateStatus();
    });

    slot.querySelector('.fold-btn').addEventListener('click', () => {
      if (foldedLabels.has(i)) foldedLabels.delete(i);
      else foldedLabels.add(i);
      renderLabels();
    });

    panel.appendChild(slot);
  }

  panel.appendChild(buildHeadSection());

  // × remove buttons (player-level)
  panel.querySelectorAll('.rm').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      unassignCard(btn.dataset.cardId);
    });
  });

  // "+" button in split → activate fill mode; stopPropagation so card body click doesn't also fire
  panel.querySelectorAll('.split-plus-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const splitId = btn.dataset.splitId;
      const half    = +btn.dataset.half;
      activeSplitTarget = (activeSplitTarget && activeSplitTarget.splitId === splitId && activeSplitTarget.half === half)
        ? null : { splitId, half };
      if (activeSplitTarget) { activeHeadTarget = null; activeRowTarget = null; }
      renderLabels();
      renderCards();
      updateStatus();
    });
  });

  // Filled sub-card → remove it; stopPropagation so card body click doesn't also fire
  panel.querySelectorAll('.split-sub-filled').forEach(filled => {
    filled.addEventListener('click', e => {
      e.stopPropagation();
      removeSplitSubCard(filled.dataset.subCardId);
    });
  });

  // All mini-cards: click anywhere → unassign (children use stopPropagation so they won't trigger this)
  panel.querySelectorAll('.mini-card').forEach(mc => {
    mc.addEventListener('click', e => {
      if (!e.target.closest('.rm')) unassignCard(mc.dataset.cardId);
    });
  });

  // Clear All button
  const clearBtn = document.createElement('button');
  clearBtn.className = 'clear-all-btn';
  clearBtn.textContent = 'Clear All';
  clearBtn.addEventListener('click', () => {
    pushHistory();
    Object.keys(assignments).forEach(id => delete assignments[id]);
    Object.keys(splitContents).forEach(id => delete splitContents[id]);
    Object.keys(splitSlots).forEach(id => delete splitSlots[id]);
    headSlots.fill(null);
    rowSlots.fill(null);
    activeSplitTarget = null;
    activeHeadTarget = null;
    activeRowTarget = null;
    nextLabel = 0;
    renderLabels();
    renderCards();
    updateStatus();
  });
  panel.appendChild(clearBtn);
}

function miniCardHTML(id) {
  if (id.startsWith('SPLIT|')) {
    const [c0, c1] = splitContents[id] || [null, null];
    const isAct0 = activeSplitTarget && activeSplitTarget.splitId === id && activeSplitTarget.half === 0;
    const isAct1 = activeSplitTarget && activeSplitTarget.splitId === id && activeSplitTarget.half === 1;
    const half0 = c0
      ? `<div class="split-sub-filled" data-sub-card-id="${c0}">${splitSubLabel(c0)}</div>`
      : `<div class="split-sub-slot"><button class="split-plus-btn${isAct0 ? ' active' : ''}" data-split-id="${id}" data-half="0">+</button></div>`;
    const half1 = c1
      ? `<div class="split-sub-filled" data-sub-card-id="${c1}">${splitSubLabel(c1)}</div>`
      : `<div class="split-sub-slot"><button class="split-plus-btn${isAct1 ? ' active' : ''}" data-split-id="${id}" data-half="1">+</button></div>`;
    return `<div class="mini-card split-mini" data-card-id="${id}">
      <div class="split-mini-header">SPLIT<i class="rm" data-card-id="${id}">&#215;</i></div>
      <div class="split-sub-halves" style="display:flex;flex-direction:row;flex-wrap:nowrap;flex:1;">${half0}${half1}</div>
    </div>`;
  }
  if (id.startsWith('BLACK|')) {
    return `<div class="mini-card black-mini" data-card-id="${id}" title="Click to remove">
      <span class="black-mini-label">BLACK</span>
      <i class="rm" data-card-id="${id}">&#215;</i>
    </div>`;
  }
  if (id.startsWith('BLANK|')) {
    return `<div class="mini-card blank-mini" data-card-id="${id}">
      <span class="blank-text">BLANK</span>
      <i class="rm" data-card-id="${id}">&#215;</i>
    </div>`;
  }
  if (id.startsWith('JOKER|')) {
    return `<div class="mini-card joker-mini" data-card-id="${id}">
      <span class="mini-joker-icon">★</span>
      <i class="rm" data-card-id="${id}">&#215;</i>
    </div>`;
  }
  const { rank, suit } = parseId(id);
  const c = clr(suit);
  return `<div class="mini-card ${c}" data-card-id="${id}">
    <span class="mr">${rank}</span>
    <span class="ms">${suit}</span>
    <i class="rm" data-card-id="${id}">&#215;</i>
  </div>`;
}

function splitSubLabel(cardId) {
  const { rank, suit } = parseId(cardId);
  return `<span class="${clr(suit)}">${rank}${suit}</span>`;
}

/* ── Build the shared head section (8 blank cards), placed under the player slots ── */
function buildHeadSection() {
  const wrap = document.createElement('div');
  wrap.className = 'head-section';

  const title = document.createElement('div');
  title.className = 'panel-title head-section-title';
  title.textContent = 'Blank Cards';
  wrap.appendChild(title);

  const row = document.createElement('div');
  row.className = 'head-row';

  headSlots.forEach((cardId, i) => {
    const box = document.createElement('div');

    if (cardId) {
      const { rank, suit } = parseId(cardId);
      const c = clr(suit);
      box.className = `head-slot filled ${c}`;
      box.title = 'Click to clear';
      box.innerHTML = `<span class="hr">${rank}</span><span class="hs">${suit}</span>`;
      box.addEventListener('click', () => removeFromHead(i));
    } else {
      const active = activeHeadTarget === i;
      box.className = `head-slot empty${active ? ' active' : ''}`;
      box.title = active ? 'Click to cancel' : 'Click, then pick a card';
      box.innerHTML = `<span class="head-label">BLANK</span>`;
      box.addEventListener('click', () => toggleHeadTarget(i));
    }

    row.appendChild(box);
  });

  wrap.appendChild(row);
  return wrap;
}

/* ── Build the Custom Table section: a selectable number of numbered slots
     (1–52). Clicking a filled slot cuts the row at that point instead of
     removing the card. ── */
function buildRowSection() {
  const wrap = document.createElement('div');
  wrap.className = 'suit-section';

  const headerRow = document.createElement('div');
  headerRow.className = 'suit-label-row';

  const lbl = document.createElement('div');
  lbl.className = 'suit-label';
  lbl.textContent = 'Custom Table';
  headerRow.appendChild(lbl);

  const controls = document.createElement('div');
  controls.className = 'row-count-controls';
  controls.innerHTML = `
    <span>Slots:</span>
    <button class="ctrl-btn" id="btn-row-dec"${rowCount <= ROW_MIN ? ' disabled' : ''}>&#8722;</button>
    <span id="row-count">${rowCount}</span>
    <button class="ctrl-btn" id="btn-row-inc"${rowCount >= ROW_MAX ? ' disabled' : ''}>&#43;</button>
  `;
  controls.querySelector('#btn-row-dec').addEventListener('click', () => setRowCount(rowCount - 1));
  controls.querySelector('#btn-row-inc').addEventListener('click', () => setRowCount(rowCount + 1));
  headerRow.appendChild(controls);

  wrap.appendChild(headerRow);

  const row = document.createElement('div');
  row.className = 'row-row';

  rowSlots.forEach((cardId, i) => {
    const box = document.createElement('div');

    if (cardId) {
      const { rank, suit } = parseId(cardId);
      const c = clr(suit);
      const target = i % labelCount;
      const targetName = (labelNames[target] !== undefined && labelNames[target] !== '')
        ? labelNames[target]
        : `Player ${target + 1}`;
      box.className = `row-slot filled ${c}`;
      box.title = i === 0
        ? 'Click to cut the table here · Double-click to deal the whole table to players, then Blank Cards'
        : `Click to cut the table here · Double-click to deal to ${targetName}`;
      box.innerHTML = `
        <span class="hr">${rank}</span><span class="hs">${suit}</span>
        <span class="row-slot-num">${i + 1}</span>
        <i class="rm" title="Remove">&#215;</i>`;
      box.addEventListener('click', e => {
        if (e.detail > 1) return; // part of a double-click, let dblclick handle it
        clearTimeout(rowSlotClickTimer);
        rowSlotClickTimer = setTimeout(() => cutRowAt(i), 220);
      });
      box.addEventListener('dblclick', () => {
        clearTimeout(rowSlotClickTimer);
        if (i === 0) dealAllRowSlotsToPlayers();
        else dealRowSlotToPlayer(i);
      });
      box.querySelector('.rm').addEventListener('click', e => {
        e.stopPropagation();
        clearTimeout(rowSlotClickTimer);
        removeFromRow(i);
      });
    } else {
      const active = activeRowTarget === i;
      box.className = `row-slot empty${active ? ' active' : ''}`;
      box.title = active ? 'Click to cancel' : 'Click, then pick a card';
      box.innerHTML = `<span class="row-label">${i + 1}</span>`;
      box.addEventListener('click', () => toggleRowTarget(i));
    }

    row.appendChild(box);
  });

  wrap.appendChild(row);
  return wrap;
}

/* ── Blank card ── */
function buildBlankCard() {
  const div = document.createElement('div');
  div.className = 'card blank-card';
  div.title = 'Blank card';
  div.innerHTML = `<div class="blank-inner"><span class="blank-label">BLANK</span></div>`;
  div.addEventListener('click', () => {
    const id = `BLANK|${blankCounter++}`;
    assignCard(id, nextLabel);
    nextLabel = (nextLabel + 1) % labelCount;
    updateStatus();
  });
  return div;
}

/* ── Joker card ── */
function buildJokerCard() {
  const div = document.createElement('div');
  div.className = 'card joker-card';
  div.title = 'Joker';
  div.innerHTML = `
    <div class="joker-inner">
      <span class="joker-icon">★</span>
      <span class="joker-label">JOKER</span>
    </div>`;
  div.addEventListener('click', () => {
    const id = `JOKER|${blankCounter++}`;
    assignCard(id, nextLabel);
    nextLabel = (nextLabel + 1) % labelCount;
    updateStatus();
  });
  return div;
}

/* ── Split card ── */
function buildSplitCard() {
  const div = document.createElement('div');
  div.className = 'card split-card';
  div.title = 'Split';
  div.innerHTML = `
    <div class="split-inner">
      <div class="split-half split-left"><span class="split-sub-label">A</span></div>
      <div class="split-half split-right"><span class="split-sub-label">B</span></div>
    </div>
    <div class="split-label">SPLIT</div>`;
  div.addEventListener('click', () => {
    const id = `SPLIT|${blankCounter++}`;
    assignCard(id, nextLabel);
    nextLabel = (nextLabel + 1) % labelCount;
    updateStatus();
  });
  return div;
}

/* ── Black card ── */
function buildBlackCard() {
  const div = document.createElement('div');
  div.className = 'card black-card';
  div.title = 'Black card';
  div.innerHTML = `<div class="black-inner"><span class="black-label">BLACK</span></div>`;
  div.addEventListener('click', () => {
    const id = `BLACK|${blankCounter++}`;
    assignCard(id, nextLabel);
    nextLabel = (nextLabel + 1) % labelCount;
    updateStatus();
  });
  return div;
}

/* ── Render the card deck ── */
function renderCards() {
  const panel = document.getElementById('cards-panel');
  const title = panel.querySelector('.panel-title');
  panel.innerHTML = '';
  panel.appendChild(title);

  // Special cards first
  const extraSection = document.createElement('div');
  extraSection.className = 'suit-section';
  const extraLblRow = document.createElement('div');
  extraLblRow.className = 'suit-label-row';
  const extraLbl = document.createElement('div');
  extraLbl.className = 'suit-label';
  extraLbl.textContent = 'Special';
  extraLblRow.appendChild(extraLbl);
  const historyControls = document.createElement('div');
  historyControls.className = 'history-controls';
  historyControls.innerHTML = `
    <button class="history-btn" id="btn-undo" title="Undo the last change"${undoStack.length === 0 ? ' disabled' : ''}>&#8630; Undo</button>
    <button class="history-btn" id="btn-redo" title="Redo the last undone change"${redoStack.length === 0 ? ' disabled' : ''}>&#8631; Redo</button>
  `;
  historyControls.querySelector('#btn-undo').addEventListener('click', undoLastChange);
  historyControls.querySelector('#btn-redo').addEventListener('click', redoLastChange);
  extraLblRow.appendChild(historyControls);
  extraSection.appendChild(extraLblRow);
  const extraRow = document.createElement('div');
  extraRow.className = 'suit-row';
  extraRow.appendChild(buildBlankCard());
  extraRow.appendChild(buildJokerCard());
  extraRow.appendChild(buildSplitCard());
  extraRow.appendChild(buildBlackCard());
  extraSection.appendChild(extraRow);
  panel.appendChild(extraSection);

  // Full deck: all cards in one overlapping horizontal line, click to assign/remove
  const deckSection = document.createElement('div');
  deckSection.className = 'suit-section';
  const deckLbl = document.createElement('div');
  deckLbl.className = 'suit-label';
  deckLbl.textContent = 'Full Deck';
  deckSection.appendChild(deckLbl);

  const filter = DECK_PRESETS[activeDeckPreset];
  const deckRows = document.createElement('div');
  deckRows.className = 'deck-rows';
  deckRows.appendChild(buildDeckRow(['♠'], filter));
  deckRows.appendChild(buildDeckRow(['♥'], filter));
  deckRows.appendChild(buildDeckRow(['♣'], filter));
  deckRows.appendChild(buildDeckRow(['♦'], filter));

  deckSection.appendChild(deckRows);

  // Table Deck: same 52 cards, but clicking one deals it straight into the
  // next empty Custom Table slot instead of assigning it to a player.
  const tableDeckSection = document.createElement('div');
  tableDeckSection.className = 'suit-section';
  const tableDeckLbl = document.createElement('div');
  tableDeckLbl.className = 'suit-label';
  tableDeckLbl.textContent = 'Table Deck';
  tableDeckSection.appendChild(tableDeckLbl);

  const tableDeckRows = document.createElement('div');
  tableDeckRows.className = 'deck-rows';
  tableDeckRows.appendChild(buildDeckRow(['♠'], filter, onTableDeckCardClick));
  tableDeckRows.appendChild(buildDeckRow(['♥'], filter, onTableDeckCardClick));
  tableDeckRows.appendChild(buildDeckRow(['♣'], filter, onTableDeckCardClick));
  tableDeckRows.appendChild(buildDeckRow(['♦'], filter, onTableDeckCardClick));
  tableDeckSection.appendChild(tableDeckRows);

  const deckPair = document.createElement('div');
  deckPair.className = 'deck-pair';
  deckPair.appendChild(deckSection);
  deckPair.appendChild(tableDeckSection);
  panel.appendChild(deckPair);

  panel.appendChild(buildRowSection());
}

/* ── Build one row of a deck line: each suit's cards stay grouped together
     and in the given suit order, never interleaved ── */
function buildDeckRow(suits, filter, onClick = onCardClick) {
  const deckScroll = document.createElement('div');
  deckScroll.className = 'deck-line-scroll';
  const deckLine = document.createElement('div');
  deckLine.className = 'deck-line';

  const cards = [];
  suits.forEach(suit => {
    suitOrder[suit].forEach(cardId => {
      const { rank } = parseId(cardId);
      if (!filter || filter.has(rank)) cards.push({ suit, rank });
    });
  });

  const total = cards.length;
  cards.forEach(({ suit, rank }, i) => {
    deckLine.appendChild(buildCard(suit, rank, i, total, onClick));
  });

  deckLine.style.width  = `${52 + Math.max(0, total - 1) * DECK_STEP_X}px`;
  deckLine.style.height = '74px';

  deckScroll.appendChild(deckLine);
  return deckScroll;
}

function assignCard(id, slotIndex) {
  pushHistory();
  if (id.startsWith('SPLIT|')) splitContents[id] = [null, null];
  assignments[id] = slotIndex;
  renderLabels();
  renderCards();
}

function unassignCard(id) {
  pushHistory();
  if (id.startsWith('SPLIT|')) {
    const contents = splitContents[id] || [];
    contents.forEach(subId => { if (subId) delete splitSlots[subId]; });
    delete splitContents[id];
    if (activeSplitTarget && activeSplitTarget.splitId === id) activeSplitTarget = null;

  }
  const wasAt = assignments[id];
  delete assignments[id];
  nextLabel = wasAt;
  renderLabels();
  renderCards();
  updateStatus();
}

/* ── Label count controls ── */
function syncButtons() {
  document.getElementById('btn-dec').disabled = labelCount <= MIN;
  document.getElementById('btn-inc').disabled = labelCount >= MAX;
  document.getElementById('label-count').textContent = labelCount;
}

document.getElementById('btn-dec').addEventListener('click', () => {
  if (labelCount > MIN) { labelCount--; syncButtons(); renderLabels(); renderCards(); updateStatus(); }
});
document.getElementById('btn-inc').addEventListener('click', () => {
  if (labelCount < MAX) { labelCount++; syncButtons(); renderLabels(); renderCards(); updateStatus(); }
});

function syncCardButtons() {
  document.getElementById('btn-card-dec').disabled = cardLimit <= CARD_MIN;
  document.getElementById('btn-card-inc').disabled = cardLimit >= CARD_MAX;
  document.getElementById('card-count').textContent = cardLimit;
}
document.getElementById('btn-card-dec').addEventListener('click', () => {
  if (cardLimit > CARD_MIN) { cardLimit--; syncCardButtons(); updateStatus(); }
});
document.getElementById('btn-card-inc').addEventListener('click', () => {
  if (cardLimit < CARD_MAX) { cardLimit++; syncCardButtons(); updateStatus(); }
});

document.querySelectorAll('.preset-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    activeDeckPreset = +btn.dataset.preset;
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const filter = DECK_PRESETS[activeDeckPreset];
    if (filter) {
      Object.keys(assignments).forEach(id => {
        if (!id.startsWith('BLANK|') && !id.startsWith('JOKER|') && !id.startsWith('SPLIT|') && !id.startsWith('BLACK|')) {
          const { rank } = parseId(id);
          if (!filter.has(rank)) delete assignments[id];
        }
      });
      Object.keys(splitSlots).forEach(cardId => {
        const { rank } = parseId(cardId);
        if (!filter.has(rank)) removeSplitSubCard(cardId);
      });
      headSlots.forEach((cardId, i) => {
        if (!cardId) return;
        const { rank } = parseId(cardId);
        if (!filter.has(rank)) headSlots[i] = null;
      });
      rowSlots.forEach((cardId, i) => {
        if (!cardId) return;
        const { rank } = parseId(cardId);
        if (!filter.has(rank)) rowSlots[i] = null;
      });
    }
    renderLabels();
    renderCards();
    updateStatus();
  });
});

// Init
syncButtons();
syncCardButtons();
renderLabels();
renderCards();
updateStatus();
