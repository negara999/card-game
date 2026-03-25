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

function isInSplit(id) { return id in splitSlots; }
function isPlaced(id)  { return (id in assignments) || isInSplit(id); }

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

/* ── Build a card DOM element ── */
function buildCard(suit, rank) {
  const id     = cid(suit, rank);
  const c      = clr(suit);
  const placed = isPlaced(id);

  const div = document.createElement('div');
  div.className = `card card-${clr(suit)}${placed ? ' placed' : ''}`;
  div.dataset.cardId = id;

  div.innerHTML = `
    <div class="card-center">
      <span class="card-rank ${c}">${rank}</span>
      <span class="card-suit ${c}">${suit}</span>
    </div>`;

  div.addEventListener('click', () => onCardClick(id));
  return div;
}

/* ── Auto-assign on click ── */
function onCardClick(id) {
  // Card already in a player slot → unassign
  if (id in assignments) { unassignCard(id); return; }

  // Card already in a split sub-slot → remove from split
  if (isInSplit(id)) { removeSplitSubCard(id); return; }

  // Split target active → fill that specific half
  if (activeSplitTarget) {
    assignToSplit(id, activeSplitTarget.splitId, activeSplitTarget.half);
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

/* ── Split sub-slot assignment ── */
function assignToSplit(cardId, splitId, half) {
  splitContents[splitId][half] = cardId;
  splitSlots[cardId] = { splitId, half };
  activeSplitTarget = null;
  renderLabels();
  renderCards();
  updateStatus();
}

function removeSplitSubCard(cardId) {
  const { splitId, half } = splitSlots[cardId];
  splitContents[splitId][half] = null;
  delete splitSlots[cardId];
  renderLabels();
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
      renderLabels();
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
    Object.keys(assignments).forEach(id => delete assignments[id]);
    Object.keys(splitContents).forEach(id => delete splitContents[id]);
    Object.keys(splitSlots).forEach(id => delete splitSlots[id]);
    activeSplitTarget = null;
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

  SUITS.forEach((suit, si) => {
    const section = document.createElement('div');
    section.className = 'suit-section';

    const lbl = document.createElement('div');
    lbl.className = `suit-label ${clr(suit)}`;
    lbl.textContent = `${suit}  ${SUIT_NAMES[si]}`;
    section.appendChild(lbl);

    const row = document.createElement('div');
    row.className = 'suit-row';
    const filter = DECK_PRESETS[activeDeckPreset];
    RANKS.forEach(rank => {
      if (!filter || filter.has(rank)) row.appendChild(buildCard(suit, rank));
    });

    section.appendChild(row);
    panel.appendChild(section);
  });

  const extraSection = document.createElement('div');
  extraSection.className = 'suit-section';
  const extraLbl = document.createElement('div');
  extraLbl.className = 'suit-label';
  extraLbl.textContent = 'Special';
  extraSection.appendChild(extraLbl);
  const extraRow = document.createElement('div');
  extraRow.className = 'suit-row';
  extraRow.appendChild(buildBlankCard());
  extraRow.appendChild(buildJokerCard());
  extraRow.appendChild(buildSplitCard());
  extraRow.appendChild(buildBlackCard());
  extraSection.appendChild(extraRow);
  panel.appendChild(extraSection);
}

function assignCard(id, slotIndex) {
  if (id.startsWith('SPLIT|')) splitContents[id] = [null, null];
  assignments[id] = slotIndex;
  renderLabels();
  renderCards();
}

function unassignCard(id) {
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
