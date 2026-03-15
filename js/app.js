/**
 * PCK Studio Web — Main Application
 */

// ── State ─────────────────────────────────────────────────────────────────────
let pckData = null;
let selectedAsset = null;
let skinRenderer = null;

// ── DOM refs ──────────────────────────────────────────────────────────────────
const dropZone        = document.getElementById('drop-zone');
const fileInput       = document.getElementById('file-input');
const openBtn         = document.getElementById('open-btn');
const treePanel       = document.getElementById('tree-panel');
const contentPanel    = document.getElementById('content-panel');
const welcomePanel    = document.getElementById('welcome-panel');
const statusText      = document.getElementById('status-text');
const pckInfoBar      = document.getElementById('pck-info-bar');
const searchInput     = document.getElementById('search-input');
const themeToggleBtn  = document.getElementById('theme-toggle-btn');

// ── File open ─────────────────────────────────────────────────────────────────
openBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) readFile(file);
    fileInput.value = '';
});

// ── Drag & drop ───────────────────────────────────────────────────────────────
const dropOverlay = document.getElementById('drop-overlay');

document.addEventListener('dragover', e => { e.preventDefault(); dropOverlay.classList.add('visible'); });
document.addEventListener('dragleave', e => {
    if (!e.relatedTarget) dropOverlay.classList.remove('visible');
});
document.addEventListener('drop', e => {
    e.preventDefault();
    dropOverlay.classList.remove('visible');
    const file = e.dataTransfer.files[0];
    if (file) readFile(file);
});

// ── Read file ─────────────────────────────────────────────────────────────────
function readFile(file) {
    setStatus(`読み込み中: ${file.name}…`);
    const reader = new FileReader();
    reader.onload = e => {
        try {
            const parser = new PckParser();
            pckData = parser.parse(e.target.result);
            pckData.filename = file.name;
            onPckLoaded();
        } catch (err) {
            setStatus('エラー: ' + err.message, true);
            alert('PCKファイルの読み込みに失敗しました:\n' + err.message);
        }
    };
    reader.onerror = () => setStatus('ファイル読み込みエラー', true);
    reader.readAsArrayBuffer(file);
}

// ── PCK loaded ────────────────────────────────────────────────────────────────
function onPckLoaded() {
    const { assets, pckType, filename } = pckData;
    setStatus(`${filename} — ${assets.length} アセット`);

    // Info bar
    const typeCounts = {};
    assets.forEach(a => { typeCounts[a.typeName] = (typeCounts[a.typeName] || 0) + 1; });
    const summary = Object.entries(typeCounts).map(([t, n]) => `${t}: ${n}`).join(' | ');
    pckInfoBar.textContent = `PCK Type: ${pckType}  |  ${summary}`;
    pckInfoBar.style.display = 'block';

    welcomePanel.style.display = 'none';
    contentPanel.innerHTML = '<div class="placeholder">← アセットを選択してください</div>';

    // Show/activate the "Save PCK" button in header
    let saveBtn = document.getElementById('save-pck-btn');
    if (!saveBtn) {
        saveBtn = document.createElement('button');
        saveBtn.id = 'save-pck-btn';
        saveBtn.className = 'btn btn-primary';
        saveBtn.textContent = '💾 PCKを保存';
        saveBtn.title = '変更を含む PCK ファイルをダウンロード';
        saveBtn.addEventListener('click', savePck);
        document.getElementById('open-btn').insertAdjacentElement('afterend', saveBtn);
    }
    saveBtn.style.display = '';

    buildTree(assets);
    searchInput.value = '';
}

// ── Save (rebuild) PCK ────────────────────────────────────────────────────────
function savePck() {
    if (!pckData) return;
    try {
        const builder = new PckBuilder();
        const bytes   = builder.build(pckData);
        const blob    = new Blob([bytes], { type: 'application/octet-stream' });
        const url     = URL.createObjectURL(blob);
        const a       = document.createElement('a');
        a.href     = url;
        a.download = pckData.filename || 'modified.pck';
        a.click();
        URL.revokeObjectURL(url);
        setStatus(`保存完了: ${pckData.filename}`);
    } catch (err) {
        setStatus('PCK保存エラー: ' + err.message, true);
        alert('PCKの保存に失敗しました:\n' + err.message);
    }
}

// ── Tree building ─────────────────────────────────────────────────────────────
function buildTree(assets) {
    treePanel.innerHTML = '';
    const tree = PckParser.buildTree(assets);
    const ul = renderTreeNode(tree, true);
    treePanel.appendChild(ul);
}

function renderTreeNode(node, isRoot = false) {
    const ul = document.createElement('ul');
    ul.className = isRoot ? 'tree-root' : 'tree-children';

    // Folders first
    const sortedFolders = Object.values(node.children).sort((a, b) => a.name.localeCompare(b.name));
    sortedFolders.forEach(child => {
        const li = document.createElement('li');
        li.className = 'tree-folder';

        const label = document.createElement('div');
        label.className = 'tree-label';
        const hasItems = Object.keys(child.children).length > 0 || child.assets.length > 0;
        label.innerHTML = `<span class="tree-arrow">${hasItems ? '▾' : ' '}</span><span class="icon folder-icon">📁</span><span class="tree-name">${escHtml(child.name)}</span>`;

        const childUl = renderTreeNode(child);
        label.addEventListener('click', () => {
            const open = li.classList.toggle('open');
            label.querySelector('.tree-arrow').textContent = open ? '▾' : '▸';
        });

        li.classList.add('open');
        li.appendChild(label);
        li.appendChild(childUl);
        ul.appendChild(li);
    });

    // Assets
    const sortedAssets = [...node.assets].sort((a, b) => a.filename.localeCompare(b.filename));
    sortedAssets.forEach(asset => {
        const li = document.createElement('li');
        li.className = 'tree-asset';
        li.dataset.filename = asset.filename;

        const label = document.createElement('div');
        label.className = 'tree-label asset-label';
        const icon = getAssetIcon(asset);
        const shortName = asset.filename.split('/').pop() || asset.filename;
        label.innerHTML = `<span class="tree-arrow"> </span><span class="icon">${icon}</span><span class="tree-name" title="${escHtml(asset.filename)}">${escHtml(shortName)}</span><span class="type-badge type-${asset.typeName.toLowerCase()}">${asset.typeName}</span>`;

        label.addEventListener('click', () => selectAsset(asset, li));
        li.appendChild(label);
        ul.appendChild(li);
    });

    return ul;
}

function getAssetIcon(asset) {
    const icons = {
        Skin: '👤', Cape: '🦸', Texture: '🖼️', Localisation: '🌐',
        Audio: '🎵', ColourTable: '🎨', GameRules: '📋', GameRulesHeader: '📋',
        Info: 'ℹ️', TexturePackInfo: '📦', SkinData: '📦',
        Models: '🧊', Behaviours: '⚙️', Material: '✨', UIData: '🖥️',
    };
    return icons[asset.typeName] || '📄';
}

// ── Search / filter ───────────────────────────────────────────────────────────
searchInput.addEventListener('input', () => {
    if (!pckData) return;
    const q = searchInput.value.toLowerCase();
    const filtered = q
        ? pckData.assets.filter(a => a.filename.toLowerCase().includes(q))
        : pckData.assets;
    buildTree(filtered);
});

// ── Select asset ──────────────────────────────────────────────────────────────
function selectAsset(asset, li) {
    selectedAsset = asset;
    // Highlight
    document.querySelectorAll('.tree-asset.selected').forEach(el => el.classList.remove('selected'));
    if (li) li.classList.add('selected');
    // Show viewer
    showViewer(asset);
}

// ── Content viewers ───────────────────────────────────────────────────────────
function showViewer(asset) {
    // Dispose previous skin renderer
    if (skinRenderer) {
        skinRenderer.dispose();
        skinRenderer = null;
    }

    contentPanel.innerHTML = '';

    const header = makeHeader(asset);
    contentPanel.appendChild(header);

    const body = document.createElement('div');
    body.className = 'viewer-body';
    contentPanel.appendChild(body);

    switch (asset.type) {
        case 0: // Skin
        case 1: // Cape
            showSkinOrImage(asset, body);
            break;
        case 2: // Texture
            showImageViewer(asset, body);
            break;
        case 6: // Localisation
            showTextViewer(asset, body);
            break;
        case 4: // Info
        case 5: // TexturePackInfo
            showPropertiesViewer(asset, body);
            break;
        default:
            showHexViewer(asset, body);
    }
}

function makeHeader(asset) {
    const header = document.createElement('div');
    header.className = 'viewer-header';

    const info = document.createElement('div');
    info.className = 'viewer-info';
    info.innerHTML = `
        <span class="viewer-filename">${escHtml(asset.filename)}</span>
        <span class="viewer-meta">Type: ${asset.typeName} | Size: ${formatBytes(asset.size)}</span>
    `;

    const dlBtn = document.createElement('button');
    dlBtn.className = 'btn btn-primary';
    dlBtn.textContent = '⬇ ダウンロード';
    dlBtn.addEventListener('click', () => downloadAsset(asset));

    header.appendChild(info);
    header.appendChild(dlBtn);
    return header;
}

// Image viewer (PNG) with Edit tab
function showImageViewer(asset, container) {
    const tabs = document.createElement('div');
    tabs.className = 'tabs';

    const tabPreview = document.createElement('button');
    tabPreview.textContent = 'プレビュー';
    tabPreview.className   = 'tab active';
    const tabEdit = document.createElement('button');
    tabEdit.textContent = '✏️ 編集';
    tabEdit.className   = 'tab';
    tabs.appendChild(tabPreview);
    tabs.appendChild(tabEdit);
    container.appendChild(tabs);

    // ── Preview panel ──────────────────────────────────────────────────────
    const previewPanel = document.createElement('div');
    previewPanel.className = 'image-viewer';

    const blob = new Blob([asset.data], { type: 'image/png' });
    const url  = URL.createObjectURL(blob);
    const img  = document.createElement('img');
    img.src       = url;
    img.className = 'preview-image pixelated';
    img.alt       = asset.filename;
    const sizeLabel = document.createElement('div');
    sizeLabel.className   = 'img-size';
    sizeLabel.textContent = '…';
    img.onload = () => {
        sizeLabel.textContent = `${img.naturalWidth} × ${img.naturalHeight} px`;
        URL.revokeObjectURL(url);
    };
    previewPanel.appendChild(img);
    previewPanel.appendChild(sizeLabel);

    // ── Edit panel ─────────────────────────────────────────────────────────
    const editPanel = document.createElement('div');
    editPanel.style.display = 'none';
    editPanel.style.flex    = '1';
    editPanel.style.overflow = 'hidden';
    let editorBuilt = false;

    container.appendChild(previewPanel);
    container.appendChild(editPanel);

    tabPreview.addEventListener('click', () => {
        tabPreview.classList.add('active'); tabEdit.classList.remove('active');
        previewPanel.style.display = ''; editPanel.style.display = 'none';
    });
    tabEdit.addEventListener('click', () => {
        tabEdit.classList.add('active'); tabPreview.classList.remove('active');
        editPanel.style.display = 'flex'; editPanel.style.flexDirection = 'column';
        previewPanel.style.display = 'none';
        if (!editorBuilt) {
            editorBuilt = true;
            new ImageEditor(editPanel, asset, () => {
                // Refresh preview after apply
                const b2  = new Blob([asset.data], { type: 'image/png' });
                const u2  = URL.createObjectURL(b2);
                img.onload = () => {
                    sizeLabel.textContent = `${img.naturalWidth} × ${img.naturalHeight} px`;
                    URL.revokeObjectURL(u2);
                };
                img.src = u2;
            });
        }
    });
}

// Skin: 3D preview + 2D flat view + Edit
function showSkinOrImage(asset, container) {
    const tabs  = document.createElement('div');
    tabs.className = 'tabs';

    const makeTab = (label, active) => {
        const b = document.createElement('button');
        b.textContent = label;
        b.className   = 'tab' + (active ? ' active' : '');
        tabs.appendChild(b);
        return b;
    };

    const tab3d   = makeTab('3D プレビュー', true);
    const tab2d   = makeTab('2D テクスチャ', false);
    const tabEdit = makeTab('✏️ 編集', false);
    container.appendChild(tabs);

    // ── Panels ────────────────────────────────────────────────────────────
    const panel3d   = document.createElement('div');
    panel3d.className = 'skin-3d-panel';

    const panel2d = document.createElement('div');
    panel2d.className = 'image-viewer';
    panel2d.style.display = 'none';

    const panelEdit = document.createElement('div');
    panelEdit.style.display = 'none';
    panelEdit.style.flex    = '1';
    panelEdit.style.overflow = 'hidden';
    panelEdit.style.display = 'none';

    container.appendChild(panel3d);
    container.appendChild(panel2d);
    container.appendChild(panelEdit);

    // ── 2D image (lazy-built on first open) ────────────────────────────────
    let panel2dBuilt = false;
    const build2d = () => {
        if (panel2dBuilt) return;
        panel2dBuilt = true;
        const blob    = new Blob([asset.data], { type: 'image/png' });
        const url2d   = URL.createObjectURL(blob);
        const img     = document.createElement('img');
        img.src       = url2d;
        img.className = 'preview-image pixelated';
        const sizeLabel = document.createElement('div');
        sizeLabel.className = 'img-size';
        img.onload = () => {
            sizeLabel.textContent = `${img.naturalWidth} × ${img.naturalHeight} px`;
            URL.revokeObjectURL(url2d);
        };
        panel2d.appendChild(img);
        panel2d.appendChild(sizeLabel);
    };

    // ── Editor (lazy-built) ────────────────────────────────────────────────
    let editorBuilt = false;
    const buildEditor = () => {
        if (editorBuilt) return;
        editorBuilt = true;
        new ImageEditor(panelEdit, asset, (newBytes) => {
            // After apply: reload 3D renderer if it's the current tab
            if (!panel3d.style.display || panel3d.style.display === '') {
                if (skinRenderer) { skinRenderer.dispose(); skinRenderer = null; }
                skinRenderer = new SkinRenderer(panel3d);
                skinRenderer.loadSkin(newBytes);
            }
            // Refresh 2D if built
            if (panel2dBuilt) {
                panel2d.innerHTML = '';
                panel2dBuilt = false;
                build2d();
            }
        });
    };

    // ── 3D renderer ────────────────────────────────────────────────────────
    skinRenderer = new SkinRenderer(panel3d);
    skinRenderer.loadSkin(asset.data);

    // ── Tab switching ──────────────────────────────────────────────────────
    const allTabs   = [tab3d, tab2d, tabEdit];
    const allPanels = [panel3d, panel2d, panelEdit];

    const switchTab = (activeTab, activePanel, onSwitch) => {
        allTabs.forEach(t   => t.classList.remove('active'));
        allPanels.forEach(p => { p.style.display = 'none'; });
        activeTab.classList.add('active');
        activePanel.style.display = 'flex';
        activePanel.style.flexDirection = 'column';
        if (onSwitch) onSwitch();
    };

    tab3d.addEventListener('click', () => switchTab(tab3d, panel3d, () => {
        skinRenderer && skinRenderer.resize();
    }));
    tab2d.addEventListener('click', () => switchTab(tab2d, panel2d, () => {
        build2d();
    }));
    tabEdit.addEventListener('click', () => switchTab(tabEdit, panelEdit, () => {
        buildEditor();
    }));

    // ── Resize observer ────────────────────────────────────────────────────
    if (window.ResizeObserver) {
        const ro = new ResizeObserver(() => skinRenderer && skinRenderer.resize());
        ro.observe(panel3d);
    }
}

// Text viewer (.loc, .grf, etc.)
function showTextViewer(asset, container) {
    const dec = new TextDecoder('utf-8');
    let text;
    try { text = dec.decode(asset.data); }
    catch { text = Array.from(asset.data).map(b => String.fromCharCode(b)).join(''); }

    const pre = document.createElement('pre');
    pre.className = 'text-viewer';
    pre.textContent = text;
    container.appendChild(pre);
}

// Properties viewer (Info file, etc.)
function showPropertiesViewer(asset, container) {
    const props = asset.properties;
    const entries = Object.entries(props);

    if (entries.length === 0 && asset.data.length > 0) {
        // Show as text if no properties but has data
        showTextViewer(asset, container);
        return;
    }

    const table = document.createElement('table');
    table.className = 'props-table';
    const thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>プロパティ</th><th>値</th></tr>';
    const tbody = document.createElement('tbody');

    entries.forEach(([k, v]) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td class="prop-key">${escHtml(k)}</td><td class="prop-val">${escHtml(v)}</td>`;
        tbody.appendChild(tr);
    });

    if (entries.length === 0) {
        const tr = document.createElement('tr');
        tr.innerHTML = '<td colspan="2" style="opacity:0.5">プロパティなし</td>';
        tbody.appendChild(tr);
    }

    table.appendChild(thead);
    table.appendChild(tbody);
    container.appendChild(table);

    // If there's data too, show hex below
    if (asset.data.length > 0) {
        const sep = document.createElement('div');
        sep.className = 'section-sep';
        sep.textContent = 'データ (HEX)';
        container.appendChild(sep);
        showHexViewer(asset, container);
    }
}

// Hex viewer (binary files)
function showHexViewer(asset, container) {
    const maxBytes = 512;
    const data = asset.data.slice(0, maxBytes);

    const hexLines = [];
    for (let i = 0; i < data.length; i += 16) {
        const chunk = Array.from(data.slice(i, i + 16));
        const hex = chunk.map(b => b.toString(16).padStart(2, '0')).join(' ');
        const ascii = chunk.map(b => (b >= 32 && b < 127) ? String.fromCharCode(b) : '.').join('');
        const addr = i.toString(16).padStart(6, '0');
        hexLines.push(`${addr}  ${hex.padEnd(47)}  ${ascii}`);
    }

    if (asset.data.length > maxBytes) {
        hexLines.push(`\n… (${formatBytes(asset.data.length - maxBytes)} 省略)`);
    }

    const pre = document.createElement('pre');
    pre.className = 'hex-viewer';
    pre.textContent = hexLines.join('\n');
    container.appendChild(pre);
}

// ── Download asset ────────────────────────────────────────────────────────────
function downloadAsset(asset) {
    const ext = asset.filename.includes('.') ? '' : (asset.ext ? '.' + asset.ext : '');
    const name = (asset.filename.split('/').pop() || asset.filename) + ext;
    const blob = new Blob([asset.data]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
}

// ── Theme toggle ──────────────────────────────────────────────────────────────
let darkTheme = true;
themeToggleBtn.addEventListener('click', () => {
    darkTheme = !darkTheme;
    document.body.classList.toggle('light-theme', !darkTheme);
    themeToggleBtn.textContent = darkTheme ? '☀️' : '🌙';
});

// ── Utility ───────────────────────────────────────────────────────────────────
function setStatus(msg, isError = false) {
    statusText.textContent = msg;
    statusText.style.color = isError ? '#ff6b6b' : '';
}

function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function formatBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}
