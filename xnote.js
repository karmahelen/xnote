// ── State ──────────────────────────────────────────────────────────────────
let currentNoteId = null;
let activeTab = 'recent';
let allNotesPage = 1;

// ── View management ────────────────────────────────────────────────────────
function showView(id) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

async function showHome() {
    currentNoteId = null;
    showView('homeView');
    document.getElementById('searchInput').value = '';
    closeDropdown();
    if (activeTab === 'recent') {
        await loadRecentNotes();
    } else {
        await loadAllNotes();
    }
    updateTabUI();
}

function switchTab(tab) {
    activeTab = tab;
    allNotesPage = 1;
    updateTabUI();
    if (tab === 'recent') {
        loadRecentNotes();
    } else {
        loadAllNotes();
    }
}

function updateTabUI() {
    document.getElementById('tabRecent').classList.toggle('active', activeTab === 'recent');
    document.getElementById('tabAll').classList.toggle('active', activeTab === 'all');
}

async function loadRecentNotes() {
    const notes = await app.call('get_recent_notes');
    renderNoteList(notes);
    document.getElementById('pagination').classList.remove('visible');
}

async function loadAllNotes(page) {
    if (page !== undefined) allNotesPage = page;
    const data = await app.call('get_all_notes', {page: allNotesPage});
    renderNoteList(data.notes);
    renderPagination(data);
}

function renderNoteList(notes) {
    const el = document.getElementById('noteList');
    if (!notes || notes.length === 0) {
        el.innerHTML = `
            <div class="empty-state">
                <div class="big">⬡</div>
                No notes yet — press <strong>+ New</strong> to create your first one.
            </div>`;
        return;
    }
    el.innerHTML = notes.map(n => `
        <div class="note-row" onclick="openNote(${n.id})">
            <span class="title">${esc(n.title)}</span>
            <span class="date">${n.date_viewed.slice(0, 10)}</span>
        </div>
    `).join('');
}

function renderPagination(data) {
    const el = document.getElementById('pagination');
    if (data.total_pages <= 1) {
        el.classList.remove('visible');
        return;
    }
    const prevDisabled = data.page <= 1 ? 'disabled' : '';
    const nextDisabled = data.page >= data.total_pages ? 'disabled' : '';
    el.innerHTML = `
        <button class="btn btn-ghost" ${prevDisabled} onclick="loadAllNotes(${data.page - 1})">← Prev</button>
        <span class="page-info">${data.page} / ${data.total_pages}</span>
        <button class="btn btn-ghost" ${nextDisabled} onclick="loadAllNotes(${data.page + 1})">Next →</button>
    `;
    el.classList.add('visible');
}

// ── Search ─────────────────────────────────────────────────────────────────
let searchTimer = null;
function onSearch(q) {
    clearTimeout(searchTimer);
    if (!q.trim()) { closeDropdown(); return; }
    searchTimer = setTimeout(async () => {
        const results = await app.call('search_notes', {query: q});
        const dd = document.getElementById('searchDropdown');
        if (!results || results.length === 0) { closeDropdown(); return; }
        dd.innerHTML = results.map(r => `
            <div class="dropdown-item" onclick="openNote(${r.id})">
                <span class="title">${esc(r.title)}</span>
                <span class="date">${r.date_modified.slice(0, 10)}</span>
            </div>
        `).join('');
        dd.classList.add('open');
    }, 150);
}
function onSearchFocus() {
    const q = document.getElementById('searchInput').value;
    if (q.trim()) onSearch(q);
}
function closeDropdown() {
    document.getElementById('searchDropdown').classList.remove('open');
}

// Close dropdown on outside click
document.addEventListener('click', e => {
    if (!e.target.closest('.search-wrap')) closeDropdown();
});

// ── Editor ─────────────────────────────────────────────────────────────────
async function showEditor(noteId) {
    currentNoteId = noteId || null;
    document.getElementById('editorTitle').value = '';
    document.getElementById('editorTags').value = '';
    document.getElementById('editorBody').value = '';

    if (noteId) {
        const note = await app.call('get_note', {note_id: noteId});
        if (note) {
            document.getElementById('editorTitle').value = note.title;
            document.getElementById('editorTags').value = (note.tags || []).join(', ');
            document.getElementById('editorBody').value = note.body || '';
        }
    }
    showView('editorView');
    document.getElementById('editorTitle').focus();
}

async function saveNote() {
    const title = document.getElementById('editorTitle').value.trim();
    if (!title) {
        document.getElementById('editorTitle').focus();
        document.getElementById('editorTitle').style.borderColor = 'var(--red)';
        setTimeout(() => document.getElementById('editorTitle').style.borderColor = '', 1500);
        return;
    }
    const body = document.getElementById('editorBody').value;
    const tags = document.getElementById('editorTags').value;
    const savedId = await app.call('save_note', {title: title, body: body, tags_str: tags, note_id: currentNoteId});
    openNote(savedId);
}

async function attachImage() {
    const tag = await app.pickAndUpload('image/*');
    if (tag) {
        const ta = document.getElementById('editorBody');
        const start = ta.selectionStart;
        const before = ta.value.slice(0, start);
        const after = ta.value.slice(ta.selectionEnd);
        ta.value = before + tag + after;
        ta.selectionStart = ta.selectionEnd = start + tag.length;
        ta.focus();
    }
}

// ── Viewer ─────────────────────────────────────────────────────────────────
async function openNote(noteId) {
    closeDropdown();
    const note = await app.call('get_note', {note_id: noteId});
    if (!note) return;
    currentNoteId = noteId;

    document.getElementById('viewerTitle').textContent = note.title;

    // Meta chips
    let meta = `<span class="chip">created ${note.date_created.slice(0,10)}</span>`;
    meta += `<span class="chip">modified ${note.date_modified.slice(0,10)}</span>`;
    meta += `<span class="chip">viewed ${note.date_viewed.slice(0,10)}</span>`;
    (note.tags || []).forEach(t => { meta += `<span class="chip tag"># ${esc(t)}</span>`; });
    document.getElementById('viewerMeta').innerHTML = meta;

    document.getElementById('viewerBody').innerHTML = prepareBody(note.body || '');

    showView('viewerView');
}

function editCurrent() {
    if (currentNoteId) showEditor(currentNoteId);
}

async function popOutNote() {
    if (!currentNoteId) return;
    window.open('/page/note?note_id=' + currentNoteId, '_blank');
}

// ── Delete ─────────────────────────────────────────────────────────────────
function confirmDelete() {
    document.getElementById('deleteOverlay').classList.add('open');
}
function closeDelete() {
    document.getElementById('deleteOverlay').classList.remove('open');
}
async function doDelete() {
    if (currentNoteId) {
        await app.call('delete_note', {note_id: currentNoteId});
        closeDelete();
        showHome();
    }
}

// ── Helpers ────────────────────────────────────────────────────────────────
function esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

const HTML_TAG_RE = /<\/?(a|abbr|article|aside|b|blockquote|br|code|col|dd|del|details|div|dl|dt|em|figcaption|figure|footer|form|h[1-6]|header|hr|i|img|input|ins|li|link|main|mark|nav|ol|p|pre|q|s|section|small|span|strong|style|sub|summary|sup|table|tbody|td|textarea|tfoot|th|thead|tr|u|ul|var|video)[\/\s>]/i;

function isHtml(text) {
    return HTML_TAG_RE.test(text);
}

function prepareBody(text) {
    if (isHtml(text)) return text;
    // Plain text: escape and convert newlines
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>\n');
}

// ── Config ─────────────────────────────────────────────────────────────────
const PRESETS = {
    'xnote Default': {
        bg: '#0a0a0f', bg2: '#16161e', bg3: '#1e1e2a', entry: '#111118',
        border: '#2a2a3a', fg: '#e8e8f0', fg2: '#6a6a80', accent: '#77ccff',
        accent2: '#b07aff', green: '#3ad900', red: '#ff3366', yellow: '#fbbf24', code: '#ff0099'
    },
    'Cobalt': {
        bg: '#001b33', bg2: '#003b70', bg3: '#0065bf', entry: '#00213f',
        border: '#003b70', fg: '#ffffff', fg2: '#cccccc', accent: '#77ccff',
        accent2: '#80ffbb', green: '#3ad900', red: '#ff0044', yellow: '#ffee80', code: '#ff0099'
    },
    'Warm Noir': {
        bg: '#111010', bg2: '#1c1917', bg3: '#292524', entry: '#161412',
        border: '#3d3530', fg: '#f5f0eb', fg2: '#8a7f72', accent: '#e8a04c',
        accent2: '#c47adb', green: '#4ade80', red: '#ef4444', yellow: '#fcd34d', code: '#fb7185'
    },
    'Forest': {
        bg: '#0a120e', bg2: '#121f18', bg3: '#1a2e24', entry: '#0e1812',
        border: '#2a3f32', fg: '#e0efe6', fg2: '#6b8a76', accent: '#5ce0a0',
        accent2: '#a0d4f7', green: '#4ade80', red: '#f87171', yellow: '#fde68a', code: '#f472b6'
    }
};

const COLOR_LABELS = {
    bg: 'Background (root)', bg2: 'Background (panels)', bg3: 'Background (hover)',
    entry: 'Input surfaces', border: 'Borders & separators', fg: 'Primary text',
    fg2: 'Muted text', accent: 'Accent (logo, buttons, headings)',
    accent2: 'Accent 2 (blockquote, tags)', green: 'Edit / success',
    red: 'Delete / danger', yellow: 'Strong text / warnings', code: 'Inline code text'
};

const FONTS = [
    'IBM Plex Mono', 'Fira Code', 'Cascadia Code', 'JetBrains Mono',
    'Ubuntu Mono', 'DejaVu Sans Mono', 'Liberation Mono', 'Noto Mono',
    'Hack', 'Fira Mono', 'Source Code Pro', 'Courier New', 'monospace'
];

let configWorking = {};
let configFont = '';
let configRecentLimit = 5;
let configAllNotesPageSize = 10;
let configAllNotesSort = 'date_viewed';
let configDirty = false;

async function showConfig() {
    // Snapshot current CSS vars as working copy
    const style = getComputedStyle(document.documentElement);
    configWorking = {};
    for (const role of Object.keys(COLOR_LABELS)) {
        const val = style.getPropertyValue('--' + role).trim();
        configWorking[role] = val || PRESETS['xnote Default'][role];
    }
    configFont = style.getPropertyValue('--font').split(',')[0].replace(/'/g, '').trim();
    configDirty = false;

    // Load recent limit
    const limit = await app.call('get_recent_limit');
    configRecentLimit = limit;
    document.getElementById('recentLimitSelect').value = String(limit);

    // Load all notes settings
    const allPageSize = await app.call('get_all_notes_page_size');
    configAllNotesPageSize = allPageSize;
    document.getElementById('allNotesPageSizeSelect').value = String(allPageSize);

    const allSort = await app.call('get_all_notes_sort');
    configAllNotesSort = allSort;
    document.getElementById('allNotesSortSelect').value = allSort;

    // Build preset buttons
    const presetBar = document.getElementById('presetBar');
    presetBar.innerHTML = Object.keys(PRESETS).map(name =>
        `<button class="preset-btn" onclick="loadPreset('${name}')">${name}</button>`
    ).join('');

    // Build font select
    const fontSelect = document.getElementById('fontSelect');
    fontSelect.innerHTML = FONTS.map(f =>
        `<option value="${f}" ${f === configFont ? 'selected' : ''}>${f}</option>`
    ).join('');
    document.getElementById('fontPreview').style.fontFamily = configFont;

    // Build color rows
    buildColorRows();

    showView('configView');
}

function buildColorRows() {
    const container = document.getElementById('colorRows');
    container.innerHTML = Object.entries(COLOR_LABELS).map(([role, label]) => `
        <div class="config-row">
            <label>${label}</label>
            <div class="color-swatch" id="swatch-${role}"
                 style="background:${configWorking[role]}"
                 onclick="pickColor('${role}')"></div>
            <span class="color-hex" id="hex-${role}">${configWorking[role]}</span>
            <input type="color" class="color-input-hidden" id="picker-${role}"
                   value="${configWorking[role]}" onchange="onColorPicked('${role}', this.value)" />
        </div>
    `).join('');
}

function pickColor(role) {
    document.getElementById('picker-' + role).click();
}

function onColorPicked(role, value) {
    configWorking[role] = value;
    document.getElementById('swatch-' + role).style.background = value;
    document.getElementById('hex-' + role).textContent = value;
    configDirty = true;
}

function onFontChange(family) {
    configFont = family;
    document.getElementById('fontPreview').style.fontFamily = family;
    configDirty = true;
}

function onRecentLimitChange(value) {
    configRecentLimit = parseInt(value);
    configDirty = true;
}

function onAllNotesPageSizeChange(value) {
    configAllNotesPageSize = parseInt(value);
    configDirty = true;
}

function onAllNotesSortChange(value) {
    configAllNotesSort = value;
    configDirty = true;
}

function loadPreset(name) {
    const preset = PRESETS[name];
    if (!preset) return;
    configWorking = {...preset};
    buildColorRows();
    // Highlight active preset
    document.querySelectorAll('.preset-btn').forEach(b => {
        b.classList.toggle('active', b.textContent === name);
    });
    configDirty = true;
}

function resetConfig() {
    loadPreset('xnote Default');
    document.getElementById('fontSelect').value = 'IBM Plex Mono';
    configFont = 'IBM Plex Mono';
    document.getElementById('fontPreview').style.fontFamily = configFont;
    configRecentLimit = 5;
    document.getElementById('recentLimitSelect').value = '5';
    configAllNotesPageSize = 10;
    document.getElementById('allNotesPageSizeSelect').value = '10';
    configAllNotesSort = 'date_viewed';
    document.getElementById('allNotesSortSelect').value = 'date_viewed';
}

async function applyConfig() {
    // Apply CSS variables live
    const root = document.documentElement;
    for (const [role, val] of Object.entries(configWorking)) {
        root.style.setProperty('--' + role, val);
    }
    root.style.setProperty('--font', `'${configFont}', monospace`);

    // Persist to DB
    await app.call('save_palette', {palette: configWorking});
    await app.call('save_font_family', {family: configFont});
    await app.call('save_recent_limit', {limit: configRecentLimit});
    await app.call('save_all_notes_page_size', {size: configAllNotesPageSize});
    await app.call('save_all_notes_sort', {sort_by: configAllNotesSort});

    showHome();
}

function cancelConfig() {
    showHome();
}

// ── Right-click to copy (desktop only — mobile uses native selection) ──────
function copyToClipboard(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
}

document.addEventListener('contextmenu', e => {
    // On touch devices, let the native selection toolbar handle copy
    if ('ontouchstart' in window) return;
    if (!e.target.closest('.viewer-body-inner')) return;
    const sel = window.getSelection().toString();
    if (!sel) return;
    e.preventDefault();
    copyToClipboard(sel);
});

// ── Init ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    // Load saved palette
    const palette = await app.call('get_palette');
    if (palette) {
        const root = document.documentElement;
        for (const [role, val] of Object.entries(palette)) {
            root.style.setProperty('--' + role, val);
        }
    }
    // Load saved font
    const font = await app.call('get_font_family');
    if (font) {
        document.documentElement.style.setProperty('--font', `'${font}', monospace`);
    }
    showHome();
});

// Keyboard shortcuts
document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.key === 'n') { e.preventDefault(); showEditor(); }
    if (e.key === 'Escape') {
        if (document.getElementById('deleteOverlay').classList.contains('open')) {
            closeDelete();
        } else if (document.getElementById('configView').classList.contains('active')) {
            cancelConfig();
        } else if (document.getElementById('editorView').classList.contains('active')) {
            showHome();
        } else if (document.getElementById('viewerView').classList.contains('active')) {
            showHome();
        }
    }
});
