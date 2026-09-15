// ⚙️ ZAR SETTINGS — instant save, no Save button
const $ = (id) => document.getElementById(id);
const saved = $('saved');
let savedTimer = null;

function flash(msg) {
  saved.textContent = msg || 'Saved ✓';
  saved.classList.add('show');
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => saved.classList.remove('show'), 2000);
}

function paint(s) {
  $('in-homepage').value = s.homepage === 'about:blank' ? '' : (s.homepage || '');
  const sel = $('sel-engine');
  sel.innerHTML = '';
  (s.engines || []).forEach(e => {
    const o = document.createElement('option');
    o.value = e.id;
    o.textContent = e.name;
    if (e.id === s.searchEngine) o.selected = true;
    sel.appendChild(o);
  });
  $('ck-adblock').checked = !!s.adblockEnabled;
  $('ck-discard').checked = !!s.tabDiscardingEnabled;
  $('in-discardmin').value = s.tabDiscardingTimeout;
}

$('in-homepage').addEventListener('change', (e) => {
  window.api.setSetting('homepage', e.target.value.trim() || 'about:blank');
});
$('sel-engine').addEventListener('change', (e) => {
  window.api.setSetting('searchEngine', e.target.value);
});
$('ck-adblock').addEventListener('change', (e) => {
  window.api.setSetting('adblockEnabled', e.target.checked);
});
$('ck-discard').addEventListener('change', (e) => {
  window.api.setSetting('tabDiscardingEnabled', e.target.checked);
});
$('in-discardmin').addEventListener('change', (e) => {
  window.api.setSetting('tabDiscardingTimeout', Number(e.target.value));
});
$('btn-cleardata').addEventListener('click', () => {
  window.api.clearSiteData();
});

window.api.onSettingsChanged(() => flash());
window.api.onSiteDataCleared(() => flash('Cache and cookies cleared ✓'));

window.api.getSettings().then(paint).catch(() => paint({ searchEngine: 'duckduckgo', homepage: '', adblockEnabled: true, tabDiscardingEnabled: true, tabDiscardingTimeout: 5, engines: [] }));
