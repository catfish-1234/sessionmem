// Bundled as JavaScript strings so the existing tsc build and npm package include every asset.
export const HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>sessionmem · Memory viewer</title><link rel="stylesheet" href="/style.css"><script src="/app.js" defer></script></head>
<body><header><div class="brand"><span class="mark" aria-hidden="true">s</span><div><strong>sessionmem</strong><span class="muted">Memory viewer</span></div></div><span class="badge">Local · Read-only</span></header>
<main><div class="intro"><div><p class="eyebrow">YOUR PROJECT CONTEXT</p><h1>What sessionmem knows</h1><p class="muted">Explore saved context, connections, and how facts changed.</p></div><label class="project-label">Project<select id="project" aria-label="Project"></select></label></div>
<nav aria-label="Views"><button type="button" data-view="memories" aria-pressed="true">Memories</button><button type="button" data-view="entities" aria-pressed="false">Entities &amp; relations</button><button type="button" data-view="history" aria-pressed="false">Supersession chains</button></nav>
<form id="search"><label for="query">Search memories</label><div class="search-row"><input id="query" type="search" maxlength="1000" placeholder="Search decisions, facts, warnings…"><button type="submit" class="primary">Search</button></div><label class="check"><input id="include-history" type="checkbox"> Include superseded facts in search</label></form>
<div class="section-heading"><h2 id="view-title">Memories</h2><button type="button" id="refresh">Refresh</button></div><p id="status" role="status" aria-live="polite">Loading your memory store…</p><div id="results"></div>
<div id="pagination"><button id="previous" type="button">← Previous</button><span id="page-info"></span><button id="next" type="button">Next →</button></div>
<footer>Served from this computer. Browsing and searching do not change your memories.</footer></main>
<dialog id="detail"><div class="section-heading"><h2>Memory details</h2><button id="close-detail" type="button">Close</button></div><div id="detail-content"></div></dialog></body></html>`;

export const CSS = `
:root{color-scheme:light;--ink:#202b33;--muted:#626f78;--line:#dce3e5;--accent:#176c58;--pale:#eaf4ef;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f6f8f7;color:var(--ink)}
*{box-sizing:border-box}body{margin:0;font-size:15px;line-height:1.6}header{background:#fff;border-bottom:1px solid var(--line);padding:18px max(24px,calc((100vw - 1160px)/2));display:flex;align-items:center;justify-content:space-between;gap:16px}.brand{display:flex;align-items:center;gap:12px}.brand strong{font-size:20px;letter-spacing:-.7px}.brand .muted{margin-left:14px;font-size:13px}.mark{display:grid;place-items:center;background:var(--accent);color:#fff;border-radius:10px;width:36px;height:36px;font:bold 28px Georgia,serif}.badge{background:var(--pale);color:#215e4d;border:1px solid #cae2d5;border-radius:20px;padding:4px 12px;font-size:12px;white-space:nowrap}main{max-width:1160px;margin:auto;padding:36px 24px}.intro{display:flex;justify-content:space-between;align-items:center;gap:24px;margin-bottom:28px}h1{font-size:32px;line-height:1.2;letter-spacing:-1.1px;margin:4px 0 12px}h2{font-size:19px;margin:0}h3{font-size:16px;margin:0 0 14px}.eyebrow{font-size:11px;font-weight:700;letter-spacing:1.6px;color:var(--accent);margin:0}.muted{color:var(--muted)}p{margin:6px 0}.project-label{font-size:12px;font-weight:600;display:grid;gap:6px;min-width:240px;max-width:40%}select,input[type=search]{background:#fff;border:1px solid #b8c5c7;border-radius:7px;padding:10px 12px;color:var(--ink);font:inherit;width:100%}nav{display:flex;gap:8px;border-bottom:1px solid var(--line);padding-bottom:12px;margin-bottom:24px;flex-wrap:wrap}button{font:inherit;cursor:pointer;color:var(--ink);background:#fff;border:1px solid var(--line);border-radius:7px;padding:7px 13px}button:hover{border-color:var(--accent);background:#f1f7f4}button[aria-pressed=true],.primary{background:var(--accent);border-color:var(--accent);color:#fff}button:disabled{opacity:.45;cursor:default}button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #73b6a1;outline-offset:3px}#search>label:first-child{font-size:13px;font-weight:600}.search-row{display:flex;gap:10px;margin:7px 0 10px}.check{display:flex;align-items:center;gap:7px;font-size:13px;color:var(--muted)}.section-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:26px 0 12px}#status{font-size:13px;color:var(--muted);margin-bottom:18px}#status.error{color:#a43327}#results{display:grid;gap:14px}.card{background:#fff;border:1px solid var(--line);border-radius:10px;padding:20px}.card-top{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px}.kind{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--accent);background:var(--pale);padding:2px 8px;border-radius:4px}.meta{font-size:12px;color:var(--muted)}.content{white-space:pre-wrap;overflow-wrap:anywhere;margin:10px 0 16px}.memory-link{font:12px ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--accent);padding:4px 7px;overflow-wrap:anywhere;max-width:100%;text-align:left}.source-links{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.columns{display:grid;grid-template-columns:1fr 1.4fr;gap:18px}.row{padding:14px 0;border-top:1px solid var(--line);overflow-wrap:anywhere}.row:first-child{border:0}.relation{color:var(--accent);font-size:12px;font-weight:600;margin:0 8px}.timeline{border-left:2px solid #c7ddd3;margin-left:6px;padding-left:20px}.transition{position:relative;padding:0 0 24px;overflow-wrap:anywhere}.transition:before{content:"";position:absolute;left:-26px;top:8px;width:9px;height:9px;border-radius:50%;background:var(--accent);border:1px solid #fff}.values{font-size:17px;margin:8px 0}.arrow{color:var(--accent);margin:0 10px}.empty{text-align:center;padding:48px 24px;background:#fff;border:1px dashed #c4d0cd;border-radius:10px;color:var(--muted)}#pagination{display:flex;align-items:center;justify-content:center;gap:20px;margin:24px 0}footer{text-align:center;font-size:12px;color:var(--muted);margin-top:42px}dialog{max-width:800px;width:calc(100% - 32px);max-height:85vh;border:1px solid var(--line);border-radius:12px;padding:24px;color:var(--ink)}dialog::backdrop{background:#152a2780}dialog .section-heading{margin-top:0}dl{display:grid;grid-template-columns:110px 1fr;gap:6px 12px;font-size:13px}dt{color:var(--muted)}dd{margin:0;overflow-wrap:anywhere}[hidden]{display:none!important}
@media(max-width:700px){header{padding:16px}.brand .muted{display:none}main{padding:24px 16px}.intro{align-items:stretch;flex-direction:column;gap:16px}.project-label{max-width:100%;min-width:0}.columns{grid-template-columns:1fr}h1{font-size:28px}.card{padding:16px}nav button{font-size:13px}}
`;

export const JS = String.raw`
'use strict';
const $ = (id) => document.getElementById(id);
const state = { project: '', view: 'memories', query: '', offset: 0, generation: 0 };
const titles = { memories: 'Memories', entities: 'Entities & relations', history: 'Supersession chains' };
function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function timestamp(value) {
  if (!value) return 'Unknown';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
async function api(path, params = {}) {
  const url = new URL('/api/' + path, location.origin);
  url.search = new URLSearchParams({ ...(state.project ? { project: state.project } : {}), ...params });
  const response = await fetch(url, { cache: 'no-store' });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Unable to load the memory store');
  return result;
}
function source(id) {
  const button = el('button', id, 'memory-link');
  button.type = 'button';
  button.title = 'Inspect source memory';
  button.addEventListener('click', () => showMemory(id));
  return button;
}
function sources(ids) {
  const wrapper = el('div', undefined, 'source-links');
  ids.forEach(id => wrapper.append(source(id)));
  return wrapper;
}
async function showMemory(id) {
  const project = state.project;
  $('detail-content').textContent = 'Loading…';
  if (!$('detail').open) $('detail').showModal();
  try {
    const { memory } = await api('memory', { id });
    if (project !== state.project) return;
    $('detail-content').replaceChildren(el('div', memory.content, 'content'));
    const details = el('dl');
    for (const key of ['id', 'kind', 'importance', 'author', 'sessionId', 'sourceAdapter', 'createdAt', 'updatedAt', 'expiresAt']) {
      if (memory[key] != null) details.append(el('dt', key), el('dd', String(memory[key])));
    }
    $('detail-content').append(details);
  } catch (error) { $('detail-content').textContent = error.message; }
}
function renderMemories(data) {
  for (const memory of data.memories) {
    const card = el('article', undefined, 'card');
    const top = el('div', undefined, 'card-top');
    top.append(el('span', memory.kind, 'kind'), el('span', 'Importance ' + memory.importance + '/10', 'meta'));
    if (memory.score) top.append(el('span', 'Recall score ' + memory.score.total.toFixed(3), 'meta'));
    card.append(top, el('div', memory.content, 'content'), source(memory.id), el('p', 'Updated ' + timestamp(memory.updatedAt) + (memory.author ? ' · ' + memory.author : ''), 'meta'));
    if (memory.expiresAt) card.append(el('p', 'Expires ' + timestamp(memory.expiresAt), 'meta'));
    $('results').append(card);
  }
  if (!data.memories.length) empty(state.query ? 'No matching memories.' : 'No memories in this project yet.');
  $('status').textContent = state.query ? data.total + ' recall results · current facts by default · showing up to 50' : data.total + ' saved memories · includes superseded and expired records';
  $('pagination').hidden = !!state.query || data.total === 0;
  $('previous').disabled = state.offset === 0;
  $('next').disabled = state.offset + 50 >= data.total;
  $('page-info').textContent = (state.offset + 1) + '–' + Math.min(state.offset + 50, data.total) + ' of ' + data.total;
}
function empty(message) { $('results').append(el('div', message, 'empty')); }
function renderKnowledge(data) {
  $('status').textContent = data.entities.length + ' entities · ' + data.relations.length + ' relations · source IDs open memory details';
  if (!data.entities.length && !data.relations.length) { empty('No entities or relations captured for this project.'); return; }
  const columns = el('div', undefined, 'columns');
  for (const [title, rows] of [['Entities', data.entities], ['Relations', data.relations]]) {
    const panel = el('section', undefined, 'card');
    panel.append(el('h3', title));
    for (const row of rows) {
      const item = el('div', undefined, 'row');
      if (title === 'Entities') item.append(el('span', row.kind, 'kind'), el('p', row.name));
      else item.append(el('span', row.sourceName), el('span', row.relation + ' →', 'relation'), el('span', row.targetName), el('p', row.sourceKind + ' → ' + row.targetKind, 'meta'));
      item.append(sources(row.memoryIds));
      panel.append(item);
    }
    if (!rows.length) panel.append(el('p', 'None captured.', 'muted'));
    columns.append(panel);
  }
  $('results').append(columns);
}
function renderHistory(data) {
  $('status').textContent = data.links.length + ' replacement links · ordered by assertion time · source IDs open memory details';
  if (!data.links.length) { empty('No supersession chains captured for this project.'); return; }
  const groups = new Map();
  for (const link of data.links) {
    const key = JSON.stringify([link.entity, link.relation]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(link);
  }
  for (const links of groups.values()) {
    const card = el('section', undefined, 'card');
    card.append(el('h3', links[0].entity + ' · ' + links[0].relation));
    const timeline = el('div', undefined, 'timeline');
    for (const link of links) {
      const item = el('article', undefined, 'transition');
      item.append(el('div', timestamp(link.supersededAt), 'meta'));
      const values = el('div', undefined, 'values');
      values.append(el('span', link.oldValue), el('span', '→', 'arrow'), el('strong', link.newValue));
      item.append(values);
      const refs = el('div', undefined, 'source-links');
      refs.append(source(link.supersedes), el('span', '→', 'arrow'), source(link.supersededBy));
      item.append(refs, el('p', (link.fullySuperseded ? 'Fully superseded' : 'Partially superseded') + ' · ' + link.reason.replaceAll('_', ' '), 'meta'), el('p', 'Detected ' + timestamp(link.detectedAt), 'meta'));
      timeline.append(item);
    }
    card.append(timeline);
    $('results').append(card);
  }
}
async function load() {
  const generation = ++state.generation;
  $('view-title').textContent = titles[state.view];
  $('search').hidden = state.view !== 'memories';
  $('pagination').hidden = true;
  $('results').replaceChildren();
  $('status').className = '';
  $('status').textContent = 'Loading…';
  try {
    const data = await api(state.view === 'entities' ? 'entities' : state.view === 'history' ? 'history' : 'memories', { q: state.query, offset: String(state.offset), history: String($('include-history').checked) });
    if (generation !== state.generation) return;
    if (state.view === 'memories') renderMemories(data);
    else if (state.view === 'entities') renderKnowledge(data);
    else renderHistory(data);
  } catch (error) {
    if (generation !== state.generation) return;
    $('status').className = 'error';
    $('status').textContent = error.message;
  }
}
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
  state.view = button.dataset.view;
  document.querySelectorAll('[data-view]').forEach(other => other.setAttribute('aria-pressed', String(other === button)));
  load();
}));
$('project').addEventListener('change', () => { state.project = $('project').value; state.offset = 0; $('detail').close(); load(); });
$('search').addEventListener('submit', event => { event.preventDefault(); state.query = $('query').value.trim(); state.offset = 0; load(); });
$('query').addEventListener('input', () => { if (!$('query').value && state.query) { state.query = ''; state.offset = 0; load(); } });
$('include-history').addEventListener('change', () => { if (state.query) load(); });
$('refresh').addEventListener('click', load);
$('previous').addEventListener('click', () => { state.offset = Math.max(0, state.offset - 50); load(); });
$('next').addEventListener('click', () => { state.offset += 50; load(); });
$('close-detail').addEventListener('click', () => $('detail').close());
(async () => {
  try {
    const data = await api('projects');
    state.project = data.defaultProjectId;
    if (!data.projects.some(project => project.id === state.project)) data.projects.unshift({ id: state.project, count: 0 });
    for (const project of data.projects) {
      const option = el('option', project.id + ' (' + project.count + ')');
      option.value = project.id;
      $('project').append(option);
    }
    $('project').value = state.project;
    await load();
  } catch (error) { $('status').className = 'error'; $('status').textContent = error.message; }
})();
`;
