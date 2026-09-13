const path = require('path');
const fs = require('fs');
const { app } = require('electron');

let DB_PATH;
let historyData = [];

function getDbPath() {
  if (!DB_PATH) {
    DB_PATH = path.join(app.getPath('userData'), 'zar-history.json');
  }
  return DB_PATH;
}

function loadHistory() {
  try {
    const dbPath = getDbPath();
    if (fs.existsSync(dbPath)) {
      const raw = fs.readFileSync(dbPath, 'utf8');
      historyData = JSON.parse(raw);
    }
  } catch (e) {
    historyData = [];
  }
}

function saveHistory() {
  try {
    const dbPath = getDbPath();
    fs.writeFileSync(dbPath, JSON.stringify(historyData, null, 2), 'utf8');
  } catch (e) { }
}

function init() {
  loadHistory();
}

function recordVisit(url, title) {
  if (!url || url.startsWith('file://') || url.startsWith('about:')) return;

  const existing = historyData.find(h => h.url === url);
  if (existing) {
    existing.title = title || existing.title;
    existing.visit_count = (existing.visit_count || 1) + 1;
    existing.last_visited = new Date().toISOString();
  } else {
    historyData.push({
      url,
      title: title || '',
      visit_count: 1,
      last_visited: new Date().toISOString()
    });
  }

  if (historyData.length > 500) {
    historyData.sort((a, b) => (b.visit_count || 1) - (a.visit_count || 1));
    historyData = historyData.slice(0, 500);
  }

  saveHistory();
}

function getHistory() {
  return [...historyData]
    .sort((a, b) => {
      const scoreA = (a.visit_count || 1) * 2 + (a.last_visited ? Date.parse(a.last_visited) : 0);
      const scoreB = (b.visit_count || 1) * 2 + (b.last_visited ? Date.parse(b.last_visited) : 0);
      return scoreB - scoreA;
    });
}

function deleteEntry(url) {
  historyData = historyData.filter(h => h.url !== url);
  saveHistory();
}

function clearHistory() {
  historyData = [];
  saveHistory();
}

module.exports = { init, recordVisit, getHistory, deleteEntry, clearHistory };
