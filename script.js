/* =========================================================
   Calc Tracker
   A basic calculator extended with a labeled, searchable,
   persistent calculation history.
   ========================================================= */

const STORAGE_KEY = 'calcTracker.history';
const MAX_ENTRIES = 200; // sane upper bound so localStorage never bloats forever

/* ---------- DOM refs ---------- */
const expressionDisplay = document.getElementById('expressionDisplay');
const resultDisplay = document.getElementById('resultDisplay');
const errorMsg = document.getElementById('errorMsg');
const calcLabelInput = document.getElementById('calcLabel');
const keypad = document.getElementById('keypad');

const historyList = document.getElementById('historyList');
const emptyState = document.getElementById('emptyState');
const noResultsState = document.getElementById('noResultsState');
const searchInput = document.getElementById('searchInput');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');

/* ---------- Calculator state ---------- */
let currentExpression = '';
let lastResult = null; // holds the most recently computed number, if any

/* =========================================================
   CALCULATOR CORE
   (kept independent from history/storage logic)
   ========================================================= */

function updateDisplay() {
  expressionDisplay.textContent = currentExpression || '0';
  resultDisplay.textContent = lastResult !== null ? formatNumber(lastResult) : '\u00A0';
}

function showError(message) {
  errorMsg.textContent = message;
  // clear the message shortly after so it doesn't linger forever
  clearTimeout(showError._t);
  showError._t = setTimeout(() => { errorMsg.textContent = ''; }, 2500);
}

function formatNumber(num) {
  if (!isFinite(num)) return 'Error';
  // avoid ugly floating point tails like 0.1 + 0.2 = 0.30000000000000004
  const rounded = Math.round(num * 1e10) / 1e10;
  return rounded.toLocaleString('en-US', { maximumFractionDigits: 10 });
}

/**
 * Safely evaluates a plain arithmetic expression.
 * Only digits, ., + - * / ( ) and whitespace are permitted —
 * anything else is rejected before it ever reaches Function().
 */
function evaluateExpression(expr) {
  if (typeof expr !== 'string' || !expr.trim()) {
    throw new Error('Empty expression');
  }
  const sanitized = expr.trim();
  const isSafe = /^[0-9+\-*/().\s]+$/.test(sanitized);
  if (!isSafe) {
    throw new Error('Invalid characters in expression');
  }
  // reject dangling operators like "5+" or "*3" up front for a clearer error
  if (/[+\-*/.]$/.test(sanitized) || /^[*/]/.test(sanitized)) {
    throw new Error('Incomplete expression');
  }

  // eslint-disable-next-line no-new-func
  const value = Function(`"use strict"; return (${sanitized});`)();

  if (typeof value !== 'number' || !isFinite(value)) {
    throw new Error('Invalid calculation');
  }
  return value;
}

function appendToExpression(token) {
  errorMsg.textContent = '';
  currentExpression += token;
  updateDisplay();
}

function clearCalculator() {
  currentExpression = '';
  lastResult = null;
  errorMsg.textContent = '';
  updateDisplay();
}

function backspace() {
  currentExpression = currentExpression.slice(0, -1);
  updateDisplay();
}

function applyPercent() {
  if (!currentExpression) return;
  try {
    const value = evaluateExpression(currentExpression);
    currentExpression = String(value / 100);
    lastResult = null;
    updateDisplay();
  } catch (e) {
    showError('Nothing to convert to a percentage yet');
  }
}

function calculateEquals() {
  if (!currentExpression.trim()) return;

  let value;
  try {
    value = evaluateExpression(currentExpression);
  } catch (e) {
    showError('Invalid calculation — check your expression');
    resultDisplay.textContent = 'Error';
    return;
  }

  lastResult = value;
  updateDisplay();

  // Persist to the ledger. An empty label is allowed — it just
  // falls back to a friendly default instead of blocking the user.
  const rawLabel = calcLabelInput.value.trim();
  const label = rawLabel || 'Untitled calculation';

  saveCalculation(label, currentExpression, value);

  // Reset the label field for the next calculation, but leave the
  // expression/result on screen so the user can see what they got.
  calcLabelInput.value = '';
}

/* =========================================================
   HISTORY / STORAGE LOGIC
   ========================================================= */

/**
 * Reads history from localStorage. Guards against missing data,
 * malformed JSON, or a payload that isn't an array — any of which
 * would otherwise crash the whole app on load.
 */
function getCalculationHistory() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // filter out any entries that don't look like valid records
    return parsed.filter(item =>
      item &&
      typeof item.id === 'string' &&
      typeof item.expression === 'string' &&
      typeof item.result === 'number'
    );
  } catch (e) {
    console.warn('Calc Tracker: history in localStorage was corrupted, resetting.', e);
    return [];
  }
}

function persistHistory(history) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch (e) {
    // e.g. storage quota exceeded or privacy mode blocking writes
    console.warn('Calc Tracker: could not save history.', e);
    showError('History could not be saved (storage unavailable)');
  }
}

function saveCalculation(label, expression, result) {
  const history = getCalculationHistory();

  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    label,
    expression: expression.trim(),
    result,
    timestamp: Date.now(),
  };

  // newest first; duplicates are allowed on purpose (e.g. the same
  // "Electricity bill" calc redone next month) — each is its own record
  history.unshift(entry);

  if (history.length > MAX_ENTRIES) {
    history.length = MAX_ENTRIES;
  }

  persistHistory(history);
  renderHistory(searchInput.value);
}

function deleteCalculation(id) {
  const history = getCalculationHistory().filter(item => item.id !== id);
  persistHistory(history);
  renderHistory(searchInput.value);
}

function clearHistory() {
  const history = getCalculationHistory();
  if (history.length === 0) return;
  const confirmed = window.confirm('Clear all calculation history? This cannot be undone.');
  if (!confirmed) return;
  persistHistory([]);
  renderHistory('');
}

function searchHistory(query) {
  const history = getCalculationHistory();
  const q = query.trim().toLowerCase();
  if (!q) return history;
  return history.filter(item =>
    item.label.toLowerCase().includes(q) ||
    item.expression.toLowerCase().includes(q)
  );
}

function loadFromHistory(id) {
  const history = getCalculationHistory();
  const entry = history.find(item => item.id === id);
  if (!entry) return;

  currentExpression = entry.expression;
  lastResult = entry.result;
  calcLabelInput.value = entry.label === 'Untitled calculation' ? '' : entry.label;
  updateDisplay();
  calcLabelInput.focus();
}

/* ---------- Rendering ---------- */

function formatTimestamp(ts) {
  const date = new Date(ts);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const timePart = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return timePart;
  const datePart = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${datePart} · ${timePart}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function renderHistory(filterQuery = '') {
  const entries = filterQuery ? searchHistory(filterQuery) : getCalculationHistory();
  const totalCount = getCalculationHistory().length;

  historyList.innerHTML = '';

  const hasNoHistoryAtAll = totalCount === 0;
  const hasNoMatches = !hasNoHistoryAtAll && entries.length === 0;

  emptyState.hidden = !hasNoHistoryAtAll;
  noResultsState.hidden = !hasNoMatches;
  clearHistoryBtn.disabled = hasNoHistoryAtAll;

  entries.forEach(entry => {
    const row = document.createElement('div');
    row.className = 'entry';
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.setAttribute('aria-label', `Load calculation: ${entry.label}, ${entry.expression} equals ${formatNumber(entry.result)}`);

    row.innerHTML = `
      <div class="entry__main">
        <div class="entry__top-row">
          <span class="entry__label">${escapeHtml(entry.label)}</span>
          <span class="entry__time">${formatTimestamp(entry.timestamp)}</span>
        </div>
        <div class="entry__bottom-row">
          <span class="entry__expression">${escapeHtml(entry.expression)} =</span>
          <span class="entry__leader"></span>
          <span class="entry__result">${formatNumber(entry.result)}</span>
        </div>
      </div>
      <button class="entry__delete" type="button" aria-label="Delete this calculation" title="Delete">✕</button>
    `;

    row.addEventListener('click', (e) => {
      if (e.target.closest('.entry__delete')) return; // handled separately
      loadFromHistory(entry.id);
    });
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        loadFromHistory(entry.id);
      }
    });

    row.querySelector('.entry__delete').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteCalculation(entry.id);
    });

    historyList.appendChild(row);
  });
}

/* =========================================================
   EVENT WIRING
   ========================================================= */

keypad.addEventListener('click', (e) => {
  const btn = e.target.closest('.key');
  if (!btn) return;

  if (btn.dataset.num !== undefined) {
    appendToExpression(btn.dataset.num);
  } else if (btn.dataset.op !== undefined) {
    appendToExpression(btn.dataset.op);
  } else if (btn.dataset.action === 'clear') {
    clearCalculator();
  } else if (btn.dataset.action === 'backspace') {
    backspace();
  } else if (btn.dataset.action === 'percent') {
    applyPercent();
  } else if (btn.dataset.action === 'equals') {
    calculateEquals();
  }
});

// basic keyboard support for the calculator itself
document.addEventListener('keydown', (e) => {
  if (document.activeElement === calcLabelInput || document.activeElement === searchInput) return;

  if (/^[0-9.]$/.test(e.key)) {
    appendToExpression(e.key);
  } else if (['+', '-', '*', '/'].includes(e.key)) {
    appendToExpression(e.key);
  } else if (e.key === 'Enter' || e.key === '=') {
    e.preventDefault();
    calculateEquals();
  } else if (e.key === 'Backspace') {
    backspace();
  } else if (e.key === 'Escape') {
    clearCalculator();
  } else if (e.key === '%') {
    applyPercent();
  }
});

searchInput.addEventListener('input', () => {
  renderHistory(searchInput.value);
});

clearHistoryBtn.addEventListener('click', clearHistory);

/* =========================================================
   INIT
   ========================================================= */
updateDisplay();
renderHistory();
