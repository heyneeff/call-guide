'use strict';

// ---------- storage ----------
const KEYS = { current: 'cg.current', calls: 'cg.calls', settings: 'cg.settings', industry: 'cg.industry' };
const store = {
  get(k, fallback) { try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
};

// ---------- dom helpers ----------
const $ = (s) => document.querySelector(s);
function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v != null && v !== false) n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c);
  return n;
}

// ---------- state ----------
const app = {
  common: {},
  industries: [],   // [{ id, label, file, data }]
  script: null,     // merged common + industry
  call: null,       // the live call
  settings: { me: 'Lewis', company: '', mode: 'story', ...store.get(KEYS.settings, {}) },
};

// ---------- loading ----------
function parseJSON(text, name) {
  try { return JSON.parse(text); }
  catch (e) { throw new Error(`${name} has a JSON error: ${e.message}`); }
}

async function fetchJSON(path) {
  const res = await fetch(path, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return parseJSON(await res.text(), path);
}

async function boot() {
  try {
    const index = await fetchJSON('scripts/index.json');
    app.common = index.common ? await fetchJSON('scripts/' + index.common) : {};
    app.industries = [];
    for (const item of index.industries) {
      app.industries.push({ ...item, data: await fetchJSON('scripts/' + item.file) });
    }
    start();
  } catch (e) {
    showLoader(e);
  }
}

function showLoader(err) {
  const fileMode = location.protocol === 'file:' && err instanceof TypeError;
  $('#loaderError').textContent = fileMode
    ? 'Your browser blocks reading the scripts/ folder when the page is opened straight from disk.'
    : err.message;
  $('#loader').hidden = false;
  $('#app').hidden = true;
}

async function loadPicked(fileList) {
  try {
    const files = {};
    for (const f of fileList) files[f.name] = parseJSON(await f.text(), f.name);
    const index = files['index.json'];
    app.common = files[index?.common || 'common.json'] || {};
    app.industries = index
      ? index.industries.filter((i) => files[i.file]).map((i) => ({ ...i, data: files[i.file] }))
      : Object.entries(files)
          .filter(([n]) => !['index.json', 'common.json'].includes(n) && !n.startsWith('_'))
          .map(([n, d]) => ({ id: n.replace(/\.json$/, ''), label: n.replace(/\.json$/, ''), file: n, data: d }));
    if (!app.industries.length) throw new Error('No industry files found in that selection.');
    start();
  } catch (e) {
    showLoader(e);
  }
}

// ---------- script model ----------
function merge(common, meta) {
  const ind = meta.data;
  return {
    id: meta.id,
    label: meta.label,
    start: ind.start,
    closeNudgeAt: ind.closeNudgeAt ?? common.closeNudgeAt ?? 2,
    sections: ind.sections || [],
    vars: { ...(common.vars || {}), ...(ind.vars || {}) },
    anchors: { ...(common.anchors || {}), ...(ind.anchors || {}) },
    painTags: { ...(common.painTags || {}), ...(ind.painTags || {}) },
    objections: { ...(common.objections || {}), ...(ind.objections || {}) },
    nodes: { ...(common.nodes || {}), ...(ind.nodes || {}) },
    glossary: { ...(ind.glossary || {}), ...(common.glossary || {}) },
  };
}

function resolve(s, target) {
  return typeof target === 'string' && target.startsWith('@') ? s.anchors[target.slice(1)] : target;
}

// Catch typos in hand-edited JSON so they show up as a banner instead of a dead button mid-call.
function validate(s) {
  const w = [];
  const has = (t) => !!s.nodes[resolve(s, t)];
  const where = (t) => (typeof t === 'string' && t.startsWith('@') && !s.anchors[t.slice(1)] ? `anchor "${t}" (not in "anchors")` : `node "${t}"`);
  if (!has(s.start)) w.push(`"start" points to missing node "${s.start}"`);
  for (const sec of s.sections) if (!has(sec.start)) w.push(`section "${sec.label}" starts at missing ${where(sec.start)}`);
  for (const [id, n] of Object.entries(s.nodes)) {
    if (!n.question) w.push(`node "${id}" has no "question"`);
    const answers = n.answers || [];
    if (!answers.length && n.type !== 'end') w.push(`node "${id}" has no answers. Add some, or set "type": "end"`);
    for (const a of answers) {
      if (a.objection) {
        if (!s.objections[a.objection]) w.push(`node "${id}", answer "${a.label}" → missing objection "${a.objection}"`);
      } else if (!has(a.next)) {
        w.push(`node "${id}", answer "${a.label}" → missing ${where(a.next)}`);
      }
      for (const t of a.pains || []) if (!s.painTags[t]) w.push(`pain tag "${t}" (node "${id}") isn't defined in "painTags"`);
    }
  }
  for (const [id, o] of Object.entries(s.objections)) {
    for (const p of o.paths || []) {
      if (p.next !== 'resume' && !has(p.next)) w.push(`objection "${id}", path "${p.label}" → missing ${where(p.next)}`);
    }
  }
  return w;
}

// ---------- call model ----------
function newCall() {
  return {
    id: Date.now().toString(36),
    startedAt: new Date().toISOString(),
    touched: false,
    endedAt: null,
    industry: app.script.id,
    industryLabel: app.script.label,
    business: '', contact: '', phone: '', hook: '', notes: '', cost: '',
    stack: [{ node: startNode() }],
    dismissed: [],
    mainPain: null,
    manualPains: [],
    objections: [],
    outcome: null, outcomeLabel: '', followUpAt: '',
  };
}

// Story and Learning modes swap the pitch opener for a shared opener in common.json.
const MODE_START = { story: 'story_opener', learning: 'learn_opener' };
const startNode = () => {
  const id = MODE_START[app.settings.mode];
  return id && app.script.nodes[id] ? id : app.script.start;
};
const step = () => app.call.stack[app.call.stack.length - 1];
const currentNode = () => app.script.nodes[step().node];
const closeId = () => resolve(app.script, '@close') || 'close';

function hasContent(c) {
  return !!(c.business || c.contact || c.phone || c.notes || c.cost || c.stack.length > 1 || c.manualPains.length);
}

// The clock starts on the first real interaction, not when the blank call was created.
function touch() {
  if (!app.call.touched) { app.call.touched = true; app.call.startedAt = new Date().toISOString(); }
}

function save() { store.set(KEYS.current, app.call); }

function pains(c = app.call) {
  const out = new Map();
  for (const s of c.stack) {
    for (const t of s.pains || []) {
      if (out.has(t) || c.dismissed.includes(t)) continue;
      const def = app.script?.painTags[t] || {};
      out.set(t, { tag: t, label: def.label || t, tip: def.tip || '', section: s.section || '' });
    }
  }
  for (const m of c.manualPains) out.set('m:' + m, { tag: 'm:' + m, label: m, section: 'Added by you', manual: true });
  // The starred pain leads: it's what the close names first.
  const list = [...out.values()];
  const i = list.findIndex((p) => p.tag === c.mainPain);
  if (i > 0) list.unshift(...list.splice(i, 1));
  if (i >= 0) list[0].main = true;
  return list;
}

function wish(c = app.call) {
  for (let i = c.stack.length - 1; i >= 0; i--) if (c.stack[i].wish) return c.stack[i].wish;
  return '';
}

// Everything the log and CSV need, frozen at save time so old calls survive script edits.
function snapshot(c) {
  return {
    ...c,
    painLabels: pains(c).map((p) => p.label),
    wishText: wish(c),
    path: c.stack.slice(1).map((s) => (s.section ? `${s.section}: ${s.label}` : s.label)),
  };
}

function archive(c, fallbackOutcome) {
  if (!c.outcome) { c.outcome = fallbackOutcome; c.outcomeLabel = 'Unfinished'; }
  c.endedAt = c.endedAt || new Date().toISOString();
  const calls = store.get(KEYS.calls, []).filter((x) => x.id !== c.id);
  calls.unshift(snapshot(c));
  store.set(KEYS.calls, calls);
}

// ---------- text ----------
const lcFirst = (s) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
function joinList(xs) {
  if (xs.length <= 1) return xs[0] || '';
  if (xs.length === 2) return `${xs[0]} and ${xs[1]}`;
  return `${xs.slice(0, -1).join(', ')}, and ${xs[xs.length - 1]}`;
}

// {{name}} or {{name|fallback}}. A line with an empty var and no fallback is dropped,
// so "I'd start with {{topPain}}." disappears when no pain is tagged yet.
function fill(text) {
  const c = app.call;
  const list = pains();
  const p = list.map((x) => lcFirst(x.label));
  const vars = {
    ...app.script.vars,
    me: app.settings.me, company: app.settings.company,
    business: c.business, contact: c.contact, phone: c.phone, hook: c.hook, cost: c.cost,
    topPain: p[0] || '', pains: joinList(p.slice(0, 3)), wish: wish(),
    tip: list.find((x) => x.tip)?.tip || app.script.vars.tipFallback || '',
  };
  let drop = false;
  const out = String(text).replace(/\{\{\s*(\w+)\s*(?:\|([^}]*))?\}\}/g, (m, k, fb) => {
    if (!(k in vars)) return m;
    const v = (vars[k] || '').trim() || (fb || '').trim();
    if (!v) drop = true;
    return v;
  });
  return drop ? null : out;
}

// ---------- navigation ----------
function go(target, meta = {}) {
  const id = resolve(app.script, target);
  if (!app.script.nodes[id]) return;
  touch();
  app.call.stack.push({
    node: id,
    label: meta.label || '',
    section: currentNode()?.section || '',
    pains: meta.pains || [],
    wish: meta.wish || '',
  });
  save();
  render();
  window.scrollTo({ top: 0 });
}

function choose(a) {
  if (a.objection) return openObjection(a.objection);
  go(a.next, a);
}

function back() {
  if (app.call.stack.length <= 1) return;
  app.call.stack.pop();
  save();
  render();
}

function restart() {
  app.call.stack = [{ node: startNode() }];
  app.call.dismissed = [];
  app.call.outcome = null;
  save();
  render();
}

function startNewCall(message) {
  if (hasContent(app.call)) archive(app.call, 'incomplete');
  app.call = newCall();
  save();
  fillCallFields();
  render();
  if (message) showBanner(message);
}

function finishCall(n) {
  touch();
  app.call.outcome = n.outcome || 'done';
  app.call.outcomeLabel = n.outcomeLabel || n.question;
  app.call.endedAt = new Date().toISOString();
  const who = app.call.business || app.call.contact || 'call';
  archive(app.call);
  app.call = newCall();
  save();
  fillCallFields();
  render();
  showBanner(`Saved: ${who} (${n.outcomeLabel || n.outcome}). Ready for the next call.`);
}

// ---------- objections ----------
function openObjection(id) {
  const o = app.script.objections[id];
  if (!o) return;
  const probe = o.kind === 'probe';
  touch();
  if (!probe) app.call.objections.push(o.label);
  save();
  renderSide();
  $('#objKind').textContent = probe ? o.label.replace(/\s*↓$/, '') : 'Objection';
  $('#objTitle').textContent = probe ? (o.title || 'Pain funnel: one question at a time') : `“${o.label}”`;
  renderSay($('#objSay'), o.say);
  renderWhy($('#objWhy'), o.why);
  const cap = $('#objCapture');
  cap.hidden = !o.capture;
  if (o.capture) {
    const field = o.capture.field;
    cap.replaceChildren(el('span', {}, o.capture.label), el('input', {
      type: 'text', value: app.call[field] || '', placeholder: o.capture.placeholder || '',
      oninput: (e) => { app.call[field] = e.target.value; save(); renderSide(); },
    }));
  }
  $('#objPaths').replaceChildren(...(o.paths || []).map((p, i) => el('button', {
    class: 'answer',
    onclick: () => {
      closeObjection();
      if (p.next !== 'resume') go(p.next, { label: `${o.label} → ${p.label}`, pains: p.pains });
      else {
        // A confirmed guess tags its pain on the current step, so Back removes it too.
        if (p.pains?.length) {
          const s = step();
          s.pains = [...new Set([...(s.pains || []), ...p.pains])];
          save();
          render();
        } else renderNode(); // captured cost may change the say lines
      }
    },
  }, el('kbd', {}, String(i + 1)), el('span', { class: 'label' }, p.label))));
  $('#overlay').hidden = false;
}

function closeObjection() { $('#overlay').hidden = true; }

// ---------- rendering ----------
function renderSay(box, say) {
  const lines = [].concat(say || []).map(fill).filter(Boolean);
  box.replaceChildren(...lines.map((t) => el('p', {}, t)));
  box.hidden = !lines.length;
}

function renderWhy(box, why) {
  box.replaceChildren(...(why ? [el('strong', {}, 'Why this matters'), why] : []));
  box.hidden = !why;
}

function render() {
  renderSections();
  renderNode();
  renderSide();
}

function renderSections() {
  const n = currentNode();
  const visited = new Set(app.call.stack.map((s) => app.script.nodes[s.node]?.section));
  $('#sections').replaceChildren(...app.script.sections.map((sec) => el('button', {
    class: [sec.label === n?.section && 'current', visited.has(sec.label) && 'visited'].filter(Boolean).join(' '),
    onclick: () => go(sec.start === app.script.start ? startNode() : sec.start, { label: `Jumped to ${sec.label}` }),
  }, sec.label)));
}

function renderNode() {
  const n = currentNode();
  if (!n) {
    $('#crumb').textContent = 'Script problem';
    $('#question').textContent = `Node "${step().node}" isn't in the script anymore.`;
    $('#say').hidden = true; $('#why').hidden = true; $('#end').hidden = true;
    $('#answers').replaceChildren(el('button', { class: 'answer', onclick: restart }, el('span', { class: 'label' }, 'Restart from the top')));
    return;
  }

  $('#crumb').textContent = [n.section, app.call.stack.length > 1 && `step ${app.call.stack.length}`].filter(Boolean).join(' · ');
  $('#question').textContent = fill(n.question) ?? n.question;
  renderSay($('#say'), n.say);
  renderWhy($('#why'), n.why);

  // Highlight the answer with the highest minPains threshold the call has reached.
  const answers = n.answers || [];
  const count = pains().length;
  let rec = -1;
  answers.forEach((a, i) => {
    if (a.minPains != null && count >= a.minPains && (rec < 0 || a.minPains > answers[rec].minPains)) rec = i;
  });

  $('#answers').replaceChildren(...answers.map((a, i) => el('button', {
    class: 'answer' + (i === rec ? ' rec' : ''),
    onclick: () => choose(a),
  },
    el('kbd', {}, i < 9 ? String(i + 1) : '·'),
    el('span', { class: 'label' }, a.label),
    i === rec ? el('span', { class: 'tag' }, 'suggested')
      : a.objection ? el('span', { class: 'tag obj' }, 'objection')
      : a.pains?.length ? el('span', { class: 'tag' }, '● pain') : null,
  )));

  renderEnd(n);
  $('#back').disabled = app.call.stack.length <= 1;
  // Once there's enough pain, the close button gets loud: don't overstay the call.
  const btn = $('#toClose');
  const nudge = count >= app.script.closeNudgeAt;
  btn.hidden = n.type === 'end' || n.section === app.script.nodes[closeId()]?.section;
  btn.classList.toggle('nudge', nudge);
  btn.textContent = nudge ? `${count} pains found: bridge to close →` : 'Wrap up → close';
}

function renderEnd(n) {
  const box = $('#end');
  if (n.type !== 'end') { box.hidden = true; return; }
  const kids = [el('div', { class: 'outcome' }, n.outcomeLabel || n.outcome || 'Done')];
  if (n.checklist?.length) {
    kids.push(el('ul', { class: 'checklist' }, n.checklist.map((item) => el('li', {}, el('label', {}, el('input', { type: 'checkbox' }), item)))));
  }
  if (n.capture) {
    const input = el('input', {
      type: n.capture.type || 'text',
      value: app.call.followUpAt || '',
      oninput: (e) => { app.call.followUpAt = e.target.value; save(); },
    });
    kids.push(el('label', { class: 'capture' }, el('span', {}, n.capture.label), input));
  }
  kids.push(el('button', { class: 'btn btn-accent finish', onclick: () => finishCall(n) }, 'Save & finish call'));
  box.replaceChildren(...kids);
  box.hidden = false;
}

function renderSide() {
  const list = pains();
  $('#painCount').textContent = list.length;
  $('#painList').replaceChildren(...(list.length
    ? list.map((p) => el('li', { class: p.main ? 'main' : '' },
        el('button', { class: 'plabel', title: 'Star as the main pain (the close leads with it)', onclick: () => toggleMain(p) },
          p.main ? '★ ' + p.label : p.label),
        el('span', { class: 'psec' }, p.section),
        el('button', { class: 'x', title: 'Remove', onclick: () => dismissPain(p) }, '×')))
    : [el('li', { class: 'empty' }, "Nothing yet. Pains you uncover show up here.")]));

  const w = wish();
  $('#wish').hidden = !w;
  $('#wish').replaceChildren(el('b', {}, 'If one thing ran itself'), w);

  $('#cost').hidden = !app.call.cost;
  $('#cost').replaceChildren(el('b', {}, 'What it costs them'), app.call.cost || '');

  const objs = app.call.objections;
  $('#objHeard').hidden = !objs.length;
  $('#objHeard').textContent = objs.length ? `Objections heard: ${[...new Set(objs)].join(', ')}` : '';

  $('#notesMeta').textContent = app.call.touched
    ? new Date(app.call.startedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : '';
}

function toggleMain(p) {
  app.call.mainPain = p.main ? null : p.tag;
  save();
  render();
}

function dismissPain(p) {
  if (p.manual) app.call.manualPains = app.call.manualPains.filter((m) => 'm:' + m !== p.tag);
  else app.call.dismissed.push(p.tag);
  save();
  render();
}

function fillCallFields() {
  for (const f of ['business', 'contact', 'phone', 'hook', 'notes']) $('#' + f).value = app.call[f] || '';
}

function renderWarnings(warnings) {
  const box = $('#warnings');
  box.hidden = !warnings.length;
  box.querySelector('summary').textContent = `⚠ ${warnings.length} problem${warnings.length === 1 ? '' : 's'} in this script (click to see)`;
  box.querySelector('ul').replaceChildren(...warnings.map((w) => el('li', {}, w)));
}

let bannerTimer;
function showBanner(text) {
  const b = $('#banner');
  b.replaceChildren(el('span', {}, text), el('button', { class: 'btn', onclick: () => { b.hidden = true; } }, 'OK'));
  b.hidden = false;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { b.hidden = true; }, 8000);
}

function tickTimer() {
  const t = $('#timer');
  if (!app.call?.touched || !t) { if (t) t.textContent = '–:––'; return; }
  const secs = Math.max(0, Math.floor((Date.now() - new Date(app.call.startedAt)) / 1000));
  t.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}

// ---------- call log + CSV ----------
const fmt = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');

function allCalls() {
  const saved = store.get(KEYS.calls, []);
  return hasContent(app.call) ? [{ ...snapshot(app.call), live: true }, ...saved] : saved;
}

// Terms cheat sheet: groups of [term, meaning] from the industry file, then common.json.
function renderTerms() {
  const q = $('#termSearch').value.trim().toLowerCase();
  const groups = Object.entries(app.script.glossary || {})
    .map(([name, rows]) => [name, rows.filter(([t, m]) => !q || `${t} ${m}`.toLowerCase().includes(q))])
    .filter(([, rows]) => rows.length);
  $('#termList').replaceChildren(...(groups.length
    ? groups.map(([name, rows]) => el('section', { class: 'termgroup' },
        el('h3', {}, name),
        el('dl', {}, rows.flatMap(([t, m]) => [el('dt', {}, t), el('dd', {}, m)]))))
    : [el('p', { class: 'empty-log' }, q ? `Nothing matches "${q}".` : 'No terms for this industry yet.')]));
}

function openTerms() {
  $('#termSearch').value = '';
  renderTerms();
  $('#terms').hidden = false;
  $('#termSearch').focus();
}

function renderLog() {
  const calls = allCalls();
  if (!calls.length) {
    $('#logList').replaceChildren(el('p', { class: 'empty-log' }, 'No calls yet.'));
    return;
  }
  $('#logList').replaceChildren(...calls.map((c) => {
    const del = el('button', { class: 'btn' }, 'Delete this call');
    del.addEventListener('click', () => {
      if (del.dataset.armed) {
        store.set(KEYS.calls, store.get(KEYS.calls, []).filter((x) => x.id !== c.id));
        renderLog();
      } else {
        del.dataset.armed = '1';
        del.textContent = 'Click again to delete';
      }
    });
    const rows = [
      ['Contact', [c.contact, c.phone].filter(Boolean).join(' · ')],
      ['Follow-up', c.followUpAt && fmt(c.followUpAt)],
      ['Hook', c.hook],
      ['What it costs them', c.cost],
      ['If one thing ran itself', c.wishText],
      ['Pains', c.painLabels.map((p) => '• ' + p).join('\n')],
      ['Objections', c.objections.join(', ')],
      ['Notes', c.notes],
      ['Path', c.path.join('\n')],
    ].filter(([, v]) => v);
    return el('details', { class: 'logitem' },
      el('summary', {},
        el('span', { class: 'lbiz' }, c.business || '(no business name)'),
        el('span', { class: 'lout' + (c.live ? ' live' : '') }, c.live ? 'In progress' : c.outcomeLabel || c.outcome || ''),
        el('span', { class: 'lwhen' }, `${fmt(c.startedAt)} · ${c.industryLabel} · ${c.painLabels.length} pain${c.painLabels.length === 1 ? '' : 's'}`)),
      el('div', { class: 'logbody' },
        el('dl', {}, rows.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)])),
        c.live ? null : del));
  }));
}

function exportCSV() {
  const header = ['started_at', 'ended_at', 'minutes', 'industry', 'business', 'contact', 'phone', 'outcome',
    'follow_up_at', 'hook', 'pain_count', 'pains', 'cost_of_problem', 'owner_wish', 'objections', 'path', 'notes'];
  const rows = allCalls().map((c) => [
    c.startedAt, c.endedAt || '',
    c.endedAt ? Math.round((new Date(c.endedAt) - new Date(c.startedAt)) / 6000) / 10 : '',
    c.industryLabel, c.business, c.contact, c.phone,
    c.live ? 'In progress' : c.outcomeLabel || c.outcome,
    c.followUpAt, c.hook, c.painLabels.length, c.painLabels.join('; '), c.cost, c.wishText,
    c.objections.join('; '), c.path.join(' > '), c.notes,
  ]);
  const csv = '﻿' + [header, ...rows]
    .map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\r\n');
  const a = el('a', {
    href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })),
    download: `calls-${new Date().toISOString().slice(0, 10)}.csv`,
  });
  document.body.append(a);
  a.click();
  a.remove();
}

// ---------- wiring ----------
function selectIndustry(id) {
  const meta = app.industries.find((i) => i.id === id) || app.industries[0];
  app.script = merge(app.common, meta);
  store.set(KEYS.industry, meta.id);
  $('#industry').value = meta.id;
  renderWarnings(validate(app.script));
}

function renderObjBar() {
  const entries = Object.entries(app.script.objections);
  const btn = ([id, o]) => el('button', { class: o.kind === 'probe' ? 'probe' : '', 'data-id': id, onclick: () => openObjection(id) }, o.label);
  $('#probeButtons').replaceChildren(...entries.filter(([, o]) => o.kind === 'probe').map(btn));
  $('#objButtons').replaceChildren(...entries.filter(([, o]) => o.kind !== 'probe').map(btn));
}

let wired = false;
function start() {
  $('#loader').hidden = true;
  $('#app').hidden = false;

  $('#industry').replaceChildren(...app.industries.map((i) => el('option', { value: i.id }, i.label)));
  const saved = store.get(KEYS.current, null);
  const wanted = saved?.industry || store.get(KEYS.industry, null);
  selectIndustry(wanted);
  app.call = saved && saved.industry === app.script.id ? saved : newCall();

  fillCallFields();
  $('#mode').value = app.settings.mode;
  $('#setMe').value = app.settings.me || '';
  $('#setCompany').value = app.settings.company || '';
  renderObjBar();

  if (!wired) wire();
  render();
}

function wire() {
  wired = true;

  for (const f of ['business', 'contact', 'phone', 'hook', 'notes']) {
    $('#' + f).addEventListener('input', (e) => {
      touch();
      app.call[f] = e.target.value;
      save();
      if (f !== 'notes') renderNode(); // names appear in the say lines
      else renderSide();
    });
  }
  for (const [id, key] of [['#setMe', 'me'], ['#setCompany', 'company']]) {
    $(id).addEventListener('input', (e) => {
      app.settings[key] = e.target.value;
      store.set(KEYS.settings, app.settings);
      renderNode();
    });
  }

  $('#mode').addEventListener('change', (e) => {
    app.settings.mode = e.target.value;
    store.set(KEYS.settings, app.settings);
    if (app.call.stack.length === 1) app.call.stack = [{ node: startNode() }];
    save();
    render();
  });

  $('#industry').addEventListener('change', (e) => {
    selectIndustry(e.target.value);
    app.call.industry = app.script.id;
    app.call.industryLabel = app.script.label;
    app.call.stack = [{ node: startNode() }];
    app.call.dismissed = [];
    renderObjBar();
    save();
    render();
  });

  $('#back').addEventListener('click', back);
  $('#restart').addEventListener('click', restart);
  $('#toClose').addEventListener('click', () => go(closeId(), { label: 'Wrapped up' }));
  $('#newCall').addEventListener('click', () => startNewCall(hasContent(app.call) ? 'Previous call saved to the log as unfinished.' : ''));

  $('#addPain').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('#addPainInput').value.trim();
    if (!v) return;
    touch();
    if (!app.call.manualPains.includes(v)) app.call.manualPains.push(v);
    $('#addPainInput').value = '';
    save();
    render();
  });

  $('#overlay').addEventListener('click', (e) => { if (e.target.id === 'overlay') closeObjection(); });
  $('#logBtn').addEventListener('click', () => { renderLog(); $('#drawer').hidden = false; });
  $('#closeLog').addEventListener('click', () => { $('#drawer').hidden = true; });
  $('#drawer').addEventListener('click', (e) => { if (e.target.id === 'drawer') $('#drawer').hidden = true; });
  $('#exportCsv').addEventListener('click', exportCSV);
  $('#termsBtn').addEventListener('click', openTerms);
  $('#closeTerms').addEventListener('click', () => { $('#terms').hidden = true; });
  $('#terms').addEventListener('click', (e) => { if (e.target.id === 'terms') $('#terms').hidden = true; });
  $('#termSearch').addEventListener('input', renderTerms);

  document.addEventListener('keydown', (e) => {
    if (e.target.matches?.('input, textarea, select')) {
      if (e.key === 'Escape') {
        if (!$('#terms').hidden) $('#terms').hidden = true;
        e.target.blur();
      }
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const objOpen = !$('#overlay').hidden;
    if (e.key === 'Escape') {
      closeObjection();
      $('#drawer').hidden = true;
      $('#terms').hidden = true;
      return;
    }
    if (!$('#drawer').hidden || !$('#terms').hidden) return;
    if (!objOpen && e.key.toLowerCase() === 't') {
      openTerms();
      e.preventDefault();
      return;
    }
    if (/^[1-9]$/.test(e.key)) {
      const btns = (objOpen ? $('#objPaths') : $('#answers')).querySelectorAll('button');
      btns[Number(e.key) - 1]?.click();
      e.preventDefault();
    } else if (!objOpen && e.key.toLowerCase() === 'd') {
      $('#probeButtons button[data-id="dig"]')?.click();
    } else if (!objOpen && e.key.toLowerCase() === 'g') {
      $('#probeButtons button[data-id="guess"]')?.click();
    } else if (!objOpen && (e.key === 'ArrowLeft' || e.key === 'Backspace')) {
      back();
      e.preventDefault();
    }
  });

  setInterval(tickTimer, 1000);
}

$('#picker').addEventListener('change', (e) => loadPicked(e.target.files));
boot();
