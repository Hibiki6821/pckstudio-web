/**
 * PCK Studio Web — Main Application
 */

// ── State ─────────────────────────────────────────────────────────────────────
let pckData       = null;
let selectedAsset = null;
let skinRenderer  = null;
let ctxMenuTarget = null; // { asset, li }

// ── DOM refs ──────────────────────────────────────────────────────────────────
const dropZone       = document.getElementById('drop-zone');
const fileInput      = document.getElementById('file-input');
const openBtn        = document.getElementById('open-btn');
const treePanel      = document.getElementById('tree-panel');
const contentPanel   = document.getElementById('content-panel');
const welcomePanel   = document.getElementById('welcome-panel');
const statusText     = document.getElementById('status-text');
const pckInfoBar     = document.getElementById('pck-info-bar');
const searchInput    = document.getElementById('search-input');
const themeToggleBtn = document.getElementById('theme-toggle-btn');
const ctxMenu        = document.getElementById('ctx-menu');
const modalOverlay   = document.getElementById('modal-overlay');

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
document.addEventListener('dragleave', e => { if (!e.relatedTarget) dropOverlay.classList.remove('visible'); });
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

    const typeCounts = {};
    assets.forEach(a => { typeCounts[a.typeName] = (typeCounts[a.typeName] || 0) + 1; });
    const summary = Object.entries(typeCounts).map(([t, n]) => `${t}: ${n}`).join(' | ');
    pckInfoBar.textContent = `PCK Type: ${pckType}  |  ${summary}`;
    pckInfoBar.style.display = 'block';

    welcomePanel.style.display = 'none';
    contentPanel.innerHTML = '<div class="placeholder">← アセットを選択してください</div>';

    _ensureHeaderBtn('save-pck-btn',    '💾 PCKを保存',   savePck,          'btn-primary');
    _ensureHeaderBtn('export-zip-btn',  '📦 全エクスポート', exportAllAsZip,   'btn-ghost2');
    _ensureHeaderBtn('add-asset-btn',   '＋ アセット追加', showAddAssetModal, 'btn-ghost2');

    buildTree(assets);
    searchInput.value = '';
}

function _ensureHeaderBtn(id, label, handler, cls) {
    let btn = document.getElementById(id);
    if (!btn) {
        btn = document.createElement('button');
        btn.id        = id;
        btn.className = 'btn ' + cls;
        btn.textContent = label;
        btn.addEventListener('click', handler);
        openBtn.insertAdjacentElement('afterend', btn);
    }
    btn.style.display = '';
}

// ── New PCK ───────────────────────────────────────────────────────────────────
function newPck() {
    if (pckData && pckData.assets.length > 0) {
        if (!confirm('現在のPCKを閉じて新規作成しますか？')) return;
    }
    pckData = {
        pckType: 3,
        xmlVersion: 0,
        propertyLookup: [],
        littleEndian: false,
        assets: [],
        filename: 'new.pck',
    };
    onPckLoaded();
    setStatus('新規PCKを作成しました');
}

// ── Save (rebuild) PCK ────────────────────────────────────────────────────────
function savePck() {
    if (!pckData) return;
    try {
        const bytes = new PckBuilder().build(pckData);
        const blob  = new Blob([bytes], { type: 'application/octet-stream' });
        _downloadBlob(blob, pckData.filename || 'modified.pck');
        setStatus(`保存完了: ${pckData.filename}`);
    } catch (err) {
        setStatus('PCK保存エラー: ' + err.message, true);
        alert('PCKの保存に失敗しました:\n' + err.message);
    }
}

// ── Export all as ZIP ─────────────────────────────────────────────────────────
function exportAllAsZip() {
    if (!pckData || !pckData.assets.length) return;
    if (typeof JSZip === 'undefined') {
        alert('JSZipが読み込まれていません。インターネット接続を確認してください。');
        return;
    }
    const zip = new JSZip();
    pckData.assets.forEach(asset => {
        const name = asset.filename || ('asset_' + asset.type);
        zip.file(name.replace(/\\/g, '/'), asset.data);
    });
    zip.generateAsync({ type: 'blob' }).then(blob => {
        const base = (pckData.filename || 'pck').replace(/\.pck$/i, '');
        _downloadBlob(blob, base + '.zip');
        setStatus(`ZIP出力完了: ${pckData.assets.length} アセット`);
    });
}

// ── Tree building ─────────────────────────────────────────────────────────────
function buildTree(assets) {
    treePanel.innerHTML = '';
    const tree = PckParser.buildTree(assets);
    treePanel.appendChild(renderTreeNode(tree, true));
}

function renderTreeNode(node, isRoot = false) {
    const ul = document.createElement('ul');
    ul.className = isRoot ? 'tree-root' : 'tree-children';

    const sortedFolders = Object.values(node.children).sort((a, b) => a.name.localeCompare(b.name));
    sortedFolders.forEach(child => {
        const li    = document.createElement('li');
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

    const sortedAssets = [...node.assets].sort((a, b) => a.filename.localeCompare(b.filename));
    sortedAssets.forEach(asset => {
        const li    = document.createElement('li');
        li.className = 'tree-asset';
        li.dataset.filename = asset.filename;

        const label = document.createElement('div');
        label.className = 'tree-label asset-label';
        const icon      = getAssetIcon(asset);
        const shortName = asset.filename.split('/').pop() || asset.filename;
        label.innerHTML = `<span class="tree-arrow"> </span><span class="icon">${icon}</span><span class="tree-name" title="${escHtml(asset.filename)}">${escHtml(shortName)}</span><span class="type-badge type-${asset.typeName.toLowerCase()}">${asset.typeName}</span>`;

        label.addEventListener('click', () => selectAsset(asset, li));
        label.addEventListener('contextmenu', e => {
            e.preventDefault();
            showCtxMenu(asset, li, e.clientX, e.clientY);
        });
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

// ── Context menu ──────────────────────────────────────────────────────────────
function showCtxMenu(asset, li, x, y) {
    ctxMenuTarget = { asset, li };
    ctxMenu.style.left    = x + 'px';
    ctxMenu.style.top     = y + 'px';
    ctxMenu.classList.remove('hidden');
    // Adjust if off-screen
    const rect = ctxMenu.getBoundingClientRect();
    if (rect.right  > window.innerWidth)  ctxMenu.style.left = (x - rect.width)  + 'px';
    if (rect.bottom > window.innerHeight) ctxMenu.style.top  = (y - rect.height) + 'px';
}

function hideCtxMenu() { ctxMenu.classList.add('hidden'); ctxMenuTarget = null; }

ctxMenu.addEventListener('click', e => {
    const item = e.target.closest('.ctx-item');
    if (!item || !ctxMenuTarget) return;
    const { asset, li } = ctxMenuTarget;
    hideCtxMenu();
    switch (item.dataset.action) {
        case 'download': downloadAsset(asset); break;
        case 'replace':  replaceAssetDialog(asset); break;
        case 'rename':   renameAssetDialog(asset, li); break;
        case 'remove':   removeAsset(asset, li); break;
    }
});

document.addEventListener('click', e => {
    if (!ctxMenu.contains(e.target)) hideCtxMenu();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') hideCtxMenu(); });

// ── Replace asset ─────────────────────────────────────────────────────────────
function replaceAssetDialog(asset) {
    const inp = document.createElement('input');
    inp.type   = 'file';
    inp.accept = '*/*';
    inp.addEventListener('change', () => {
        const file = inp.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => {
            asset.data = new Uint8Array(ev.target.result);
            asset.size = asset.data.length;
            setStatus(`置き換え完了: ${asset.filename}`);
            if (selectedAsset === asset) showViewer(asset);
        };
        reader.readAsArrayBuffer(file);
    });
    inp.click();
}

// ── Rename asset ──────────────────────────────────────────────────────────────
function renameAssetDialog(asset, li) {
    showModal('名前変更', `
        <label class="modal-label">ファイル名</label>
        <input class="modal-input" id="rename-input" value="${escHtml(asset.filename)}" style="width:100%">
    `, [
        { label: 'キャンセル', cls: 'btn', action: closeModal },
        {
            label: '変更', cls: 'btn btn-primary', action: () => {
                const val = document.getElementById('rename-input').value.trim();
                if (!val) return;
                asset.filename = val;
                // Update li tooltip and name
                if (li) {
                    const nameEl = li.querySelector('.tree-name');
                    if (nameEl) nameEl.textContent = val.split('/').pop() || val;
                    li.dataset.filename = val;
                }
                setStatus(`名前変更: ${val}`);
                closeModal();
            }
        }
    ]);
    setTimeout(() => document.getElementById('rename-input')?.select(), 50);
}

// ── Remove asset ──────────────────────────────────────────────────────────────
function removeAsset(asset, li) {
    showModal('アセットを削除', `
        <p style="margin:0">「<strong>${escHtml(asset.filename.split('/').pop())}</strong>」を削除しますか？</p>
        <p style="margin:8px 0 0;color:var(--text-dim);font-size:12px">この操作はPCK保存後に反映されます。</p>
    `, [
        { label: 'キャンセル', cls: 'btn', action: closeModal },
        {
            label: '削除', cls: 'btn btn-danger', action: () => {
                const idx = pckData.assets.indexOf(asset);
                if (idx !== -1) pckData.assets.splice(idx, 1);
                if (li) li.remove();
                if (selectedAsset === asset) {
                    selectedAsset = null;
                    contentPanel.innerHTML = '<div class="placeholder">← アセットを選択してください</div>';
                }
                setStatus(`削除: ${asset.filename}`);
                const { assets } = pckData;
                pckInfoBar.textContent = pckInfoBar.textContent.replace(/\d+ アセット/, assets.length + ' アセット');
                closeModal();
            }
        }
    ]);
}

// ── Add asset ─────────────────────────────────────────────────────────────────
function showAddAssetModal() {
    if (!pckData) { alert('先にPCKファイルを開いてください。'); return; }

    const typeOptions = Object.entries({
        0: 'Skin (.png)', 1: 'Cape (.png)', 2: 'Texture (.png)',
        3: 'UIData', 4: 'Info', 5: 'TexturePackInfo (.pck)',
        6: 'Localisation (.loc)', 7: 'GameRules (.grf)',
        8: 'Audio (.pck)', 9: 'ColourTable (.col)',
        10: 'GameRulesHeader (.grh)', 11: 'SkinData (.pck)',
        12: 'Models (.bin)', 13: 'Behaviours (.bin)', 14: 'Material (.bin)',
    }).map(([v, l]) => `<option value="${v}">${l}</option>`).join('');

    showModal('アセットを追加', `
        <div id="add-drop" class="add-drop-zone">ファイルをドロップ または クリックして選択</div>
        <input type="file" id="add-file-input" style="display:none" accept="*/*">
        <div id="add-file-name" style="margin:6px 0;font-size:12px;color:var(--text-dim)">ファイル未選択</div>
        <label class="modal-label">ファイル名 (PCK内パス)</label>
        <input class="modal-input" id="add-name-input" placeholder="例: textures/skin.png" style="width:100%;margin-bottom:8px">
        <label class="modal-label">アセットタイプ</label>
        <select class="modal-input" id="add-type-select" style="width:100%">${typeOptions}</select>
    `, [
        { label: 'キャンセル', cls: 'btn', action: closeModal },
        {
            label: '追加', cls: 'btn btn-primary', action: () => {
                const nameVal = document.getElementById('add-name-input').value.trim();
                const typeVal = parseInt(document.getElementById('add-type-select').value);
                const fileInp = document.getElementById('add-file-input');
                if (!nameVal) { alert('ファイル名を入力してください。'); return; }
                const PckAssetType = { 0:'Skin',1:'Cape',2:'Texture',3:'UIData',4:'Info',5:'TexturePackInfo',6:'Localisation',7:'GameRules',8:'Audio',9:'ColourTable',10:'GameRulesHeader',11:'SkinData',12:'Models',13:'Behaviours',14:'Material' };
                const PckAssetExt  = { 0:'png',1:'png',2:'png',4:'',5:'pck',6:'loc',7:'grf',8:'pck',9:'col',10:'grh',11:'pck',12:'bin',13:'bin',14:'bin' };
                const doAdd = (data) => {
                    const asset = {
                        filename: nameVal.replace(/\\/g, '/'),
                        type:     typeVal,
                        typeName: PckAssetType[typeVal] || `Type${typeVal}`,
                        ext:      PckAssetExt[typeVal]  || '',
                        size:     data.length,
                        properties: {},
                        data,
                    };
                    pckData.assets.push(asset);
                    buildTree(pckData.assets);
                    setStatus(`追加: ${asset.filename}`);
                    closeModal();
                };
                if (fileInp.files[0]) {
                    const r = new FileReader();
                    r.onload = ev => doAdd(new Uint8Array(ev.target.result));
                    r.readAsArrayBuffer(fileInp.files[0]);
                } else {
                    doAdd(new Uint8Array(0));
                }
            }
        }
    ]);

    // Setup file drop/click in modal
    setTimeout(() => {
        const dropEl  = document.getElementById('add-drop');
        const fileInp = document.getElementById('add-file-input');
        if (!dropEl || !fileInp) return;
        dropEl.addEventListener('click', () => fileInp.click());
        dropEl.addEventListener('dragover', e => { e.preventDefault(); dropEl.classList.add('dragover'); });
        dropEl.addEventListener('dragleave', () => dropEl.classList.remove('dragover'));
        dropEl.addEventListener('drop', e => {
            e.preventDefault(); dropEl.classList.remove('dragover');
            const f = e.dataTransfer.files[0];
            if (f) _fillAddModalFile(f);
        });
        fileInp.addEventListener('change', () => { if (fileInp.files[0]) _fillAddModalFile(fileInp.files[0]); });
    }, 50);
}

function _fillAddModalFile(file) {
    document.getElementById('add-file-name').textContent = `選択: ${file.name}`;
    const nameInp = document.getElementById('add-name-input');
    if (!nameInp.value) nameInp.value = file.name;
    document.getElementById('add-file-input').files; // reference
}

// ── Modal helper ──────────────────────────────────────────────────────────────
function showModal(title, bodyHtml, buttons) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML    = bodyHtml;
    const footer = document.getElementById('modal-footer');
    footer.innerHTML = '';
    (buttons || []).forEach(({ label, cls, action }) => {
        const b = document.createElement('button');
        b.className   = 'btn ' + (cls || '');
        b.textContent = label;
        b.addEventListener('click', action);
        footer.appendChild(b);
    });
    modalOverlay.classList.remove('hidden');
}

function closeModal() { modalOverlay.classList.add('hidden'); }

document.getElementById('modal-close').addEventListener('click', closeModal);
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modalOverlay.classList.contains('hidden')) closeModal(); });

// ── Search / filter ───────────────────────────────────────────────────────────
searchInput.addEventListener('input', () => {
    if (!pckData) return;
    const q        = searchInput.value.toLowerCase();
    const filtered = q ? pckData.assets.filter(a => a.filename.toLowerCase().includes(q)) : pckData.assets;
    buildTree(filtered);
});

// ── Select asset ──────────────────────────────────────────────────────────────
function selectAsset(asset, li) {
    selectedAsset = asset;
    document.querySelectorAll('.tree-asset.selected').forEach(el => el.classList.remove('selected'));
    if (li) li.classList.add('selected');
    showViewer(asset);
}

// ── Content viewers ───────────────────────────────────────────────────────────
function showViewer(asset) {
    if (skinRenderer) { skinRenderer.dispose(); skinRenderer = null; }
    contentPanel.innerHTML = '';

    const header = makeHeader(asset);
    contentPanel.appendChild(header);

    const body = document.createElement('div');
    body.className = 'viewer-body';
    contentPanel.appendChild(body);

    switch (asset.type) {
        case 0: // Skin
        case 1: // Cape
            showSkinOrImage(asset, body); break;
        case 2: // Texture
            showImageViewer(asset, body); break;
        case 6: // Localisation
            showEditableTextViewer(asset, body, 'loc'); break;
        case 7: // GameRules
            showEditableTextViewer(asset, body, 'grf'); break;
        case 4: // Info
        case 5: // TexturePackInfo
            showEditablePropertiesViewer(asset, body); break;
        case 9: // ColourTable
            showColourTableViewer(asset, body); break;
        case 8: // Audio
            showAudioViewer(asset, body); break;
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

    const btns = document.createElement('div');
    btns.style.cssText = 'display:flex;gap:6px;align-items:center;flex-shrink:0';

    const replaceBtn = document.createElement('button');
    replaceBtn.className   = 'btn btn-ghost2';
    replaceBtn.textContent = '📂 置き換え';
    replaceBtn.addEventListener('click', () => replaceAssetDialog(asset));

    const renameBtn = document.createElement('button');
    renameBtn.className   = 'btn btn-ghost2';
    renameBtn.textContent = '✏️ 名前変更';
    renameBtn.addEventListener('click', () => renameAssetDialog(asset, document.querySelector(`.tree-asset[data-filename="${CSS.escape(asset.filename)}"]`)));

    const removeBtn = document.createElement('button');
    removeBtn.className   = 'btn btn-danger';
    removeBtn.textContent = '🗑️ 削除';
    removeBtn.addEventListener('click', () => removeAsset(asset, document.querySelector(`.tree-asset[data-filename="${CSS.escape(asset.filename)}"]`)));

    const dlBtn = document.createElement('button');
    dlBtn.className   = 'btn btn-primary';
    dlBtn.textContent = '⬇ ダウンロード';
    dlBtn.addEventListener('click', () => downloadAsset(asset));

    btns.appendChild(replaceBtn);
    btns.appendChild(renameBtn);
    btns.appendChild(removeBtn);
    btns.appendChild(dlBtn);
    header.appendChild(info);
    header.appendChild(btns);
    return header;
}

// ── Image viewer ──────────────────────────────────────────────────────────────
function showImageViewer(asset, container) {
    const tabs = document.createElement('div');
    tabs.className = 'tabs';
    const tabPreview = _makeTab('プレビュー', true);
    const tabEdit    = _makeTab('✏️ 編集',   false);
    tabs.appendChild(tabPreview);
    tabs.appendChild(tabEdit);
    container.appendChild(tabs);

    const previewPanel = document.createElement('div');
    previewPanel.className = 'image-viewer';

    const { img, sizeLabel } = _buildImgEl(asset);
    previewPanel.appendChild(img);
    previewPanel.appendChild(sizeLabel);

    const editPanel = document.createElement('div');
    editPanel.style.display = 'none';
    let editorBuilt = false;

    container.appendChild(previewPanel);
    container.appendChild(editPanel);

    tabPreview.addEventListener('click', () => {
        _activateTab(tabPreview, [tabEdit]);
        previewPanel.style.display = ''; editPanel.style.display = 'none';
    });
    tabEdit.addEventListener('click', () => {
        _activateTab(tabEdit, [tabPreview]);
        editPanel.style.display = 'flex'; editPanel.style.flexDirection = 'column';
        previewPanel.style.display = 'none';
        if (!editorBuilt) {
            editorBuilt = true;
            new ImageEditor(editPanel, asset, () => {
                const b2 = new Blob([asset.data], { type: 'image/png' });
                const u2 = URL.createObjectURL(b2);
                img.onload = () => { sizeLabel.textContent = `${img.naturalWidth} × ${img.naturalHeight} px`; URL.revokeObjectURL(u2); };
                img.src = u2;
            });
        }
    });
}

// ── Skin viewer (3D + 2D + Edit) ─────────────────────────────────────────────
function showSkinOrImage(asset, container) {
    const tabs    = document.createElement('div');
    tabs.className = 'tabs';
    const tab3d   = _makeTab('3D プレビュー', true);
    const tab2d   = _makeTab('2D テクスチャ', false);
    const tabEdit = _makeTab('✏️ 編集',        false);
    tabs.appendChild(tab3d);
    tabs.appendChild(tab2d);
    tabs.appendChild(tabEdit);
    container.appendChild(tabs);

    // ── 3D panel with skin controls ──────────────────────────────────────────
    const panel3dWrap = document.createElement('div');
    panel3dWrap.style.cssText = 'flex:1;display:flex;flex-direction:column;overflow:hidden';

    // Control bar (overlay toggle + slim toggle)
    const ctrlBar = document.createElement('div');
    ctrlBar.className = 'skin-ctrl-bar';

    const overlayBtn = document.createElement('button');
    overlayBtn.className   = 'btn btn-toggle active';
    overlayBtn.textContent = '👒 外層 ON';
    overlayBtn.title       = '外層（帽子・ジャケット・スリーブ・パンツ）の表示切替';

    const slimBtn = document.createElement('button');
    slimBtn.className   = 'btn btn-toggle';
    slimBtn.textContent = '👕 スリム OFF';
    slimBtn.title       = 'Alex（スリム）モデルに切替';

    ctrlBar.appendChild(overlayBtn);
    ctrlBar.appendChild(slimBtn);
    panel3dWrap.appendChild(ctrlBar);

    const panel3d = document.createElement('div');
    panel3d.className = 'skin-3d-panel';
    panel3dWrap.appendChild(panel3d);

    // ── 2D panel ─────────────────────────────────────────────────────────────
    const panel2d = document.createElement('div');
    panel2d.className    = 'image-viewer';
    panel2d.style.display = 'none';
    let panel2dBuilt = false;
    const build2d = () => {
        if (panel2dBuilt) return;
        panel2dBuilt = true;
        const { img, sizeLabel } = _buildImgEl(asset);
        panel2d.appendChild(img);
        panel2d.appendChild(sizeLabel);
    };

    // ── Edit panel ────────────────────────────────────────────────────────────
    const panelEdit = document.createElement('div');
    panelEdit.style.display = 'none';
    let editorBuilt = false;
    const buildEditor = () => {
        if (editorBuilt) return;
        editorBuilt = true;
        new ImageEditor(panelEdit, asset, (newBytes) => {
            if (skinRenderer) {
                skinRenderer.dispose();
                skinRenderer = new SkinRenderer(panel3d);
                skinRenderer.isSlim      = slimBtn.dataset.active === '1';
                skinRenderer.showOverlay = overlayBtn.dataset.active !== '0';
                skinRenderer.loadSkin(newBytes);
            }
            if (panel2dBuilt) { panel2d.innerHTML = ''; panel2dBuilt = false; build2d(); }
        });
    };

    container.appendChild(panel3dWrap);
    container.appendChild(panel2d);
    container.appendChild(panelEdit);

    // ── 3D renderer ───────────────────────────────────────────────────────────
    skinRenderer = new SkinRenderer(panel3d);
    skinRenderer.loadSkin(asset.data);

    // Overlay toggle
    overlayBtn.dataset.active = '1';
    overlayBtn.addEventListener('click', () => {
        const on = overlayBtn.dataset.active !== '0';
        const newOn = !on;
        overlayBtn.dataset.active = newOn ? '1' : '0';
        overlayBtn.textContent    = `👒 外層 ${newOn ? 'ON' : 'OFF'}`;
        overlayBtn.classList.toggle('active', newOn);
        if (skinRenderer) skinRenderer.setOverlayVisible(newOn);
    });

    // Slim toggle
    slimBtn.dataset.active = '0';
    slimBtn.addEventListener('click', () => {
        const nowSlim = slimBtn.dataset.active !== '0';
        const newSlim = !nowSlim;
        slimBtn.dataset.active = newSlim ? '1' : '0';
        slimBtn.textContent    = `👕 スリム ${newSlim ? 'ON' : 'OFF'}`;
        slimBtn.classList.toggle('active', newSlim);
        if (skinRenderer) skinRenderer.setSlim(newSlim);
    });

    // Tab switching
    const allTabs   = [tab3d, tab2d, tabEdit];
    const allPanels = [panel3dWrap, panel2d, panelEdit];
    const switchTab = (activeTab, activePanel, cb) => {
        allTabs.forEach(t   => t.classList.remove('active'));
        allPanels.forEach(p => { p.style.display = 'none'; });
        activeTab.classList.add('active');
        activePanel.style.display = 'flex';
        activePanel.style.flexDirection = 'column';
        if (cb) cb();
    };
    tab3d.addEventListener('click',   () => switchTab(tab3d,   panel3dWrap, () => skinRenderer && skinRenderer.resize()));
    tab2d.addEventListener('click',   () => switchTab(tab2d,   panel2d,     () => build2d()));
    tabEdit.addEventListener('click', () => switchTab(tabEdit, panelEdit,   () => buildEditor()));

    if (window.ResizeObserver) {
        const ro = new ResizeObserver(() => skinRenderer && skinRenderer.resize());
        ro.observe(panel3d);
    }
}

// ── Editable text viewer (LOC / GRF) ─────────────────────────────────────────
function showEditableTextViewer(asset, container, _ext) {
    const dec = new TextDecoder('utf-8');
    let text;
    try { text = dec.decode(asset.data); }
    catch { text = Array.from(asset.data).map(b => String.fromCharCode(b)).join(''); }

    const wrap = document.createElement('div');
    wrap.style.cssText = 'flex:1;display:flex;flex-direction:column;overflow:hidden';

    const toolbar = document.createElement('div');
    toolbar.className = 'editor-toolbar';
    toolbar.style.borderBottom = '1px solid var(--border)';

    const applyBtn = document.createElement('button');
    applyBtn.className   = 'btn btn-primary';
    applyBtn.textContent = '✓ 適用';
    applyBtn.style.cssText = 'font-size:12px;padding:4px 12px';

    const info = document.createElement('span');
    info.style.cssText = 'font-size:11px;color:var(--text-dim)';
    info.textContent   = `${asset.typeName} — ${formatBytes(asset.size)}`;

    toolbar.appendChild(info);
    toolbar.appendChild(applyBtn);
    wrap.appendChild(toolbar);

    const ta = document.createElement('textarea');
    ta.className = 'text-editor-ta';
    ta.value     = text;
    ta.spellcheck = false;
    wrap.appendChild(ta);
    container.appendChild(wrap);

    applyBtn.addEventListener('click', () => {
        const enc   = new TextEncoder();
        asset.data  = enc.encode(ta.value);
        asset.size  = asset.data.length;
        info.textContent = `${asset.typeName} — ${formatBytes(asset.size)}`;
        applyBtn.textContent = '✓ 保存済み';
        applyBtn.style.background = '#4ecca3';
        setTimeout(() => { applyBtn.textContent = '✓ 適用'; applyBtn.style.background = ''; }, 1200);
    });
}

// ── Editable properties viewer ────────────────────────────────────────────────
function showEditablePropertiesViewer(asset, container) {
    const props   = asset.properties || {};
    const entries = Object.entries(props);

    if (entries.length === 0 && asset.data.length > 0) {
        showEditableTextViewer(asset, container);
        return;
    }

    const toolbar = document.createElement('div');
    toolbar.className = 'editor-toolbar';
    const applyBtn = document.createElement('button');
    applyBtn.className   = 'btn btn-primary';
    applyBtn.textContent = '✓ 適用';
    applyBtn.style.cssText = 'font-size:12px;padding:4px 12px';
    const addRowBtn = document.createElement('button');
    addRowBtn.className   = 'btn btn-ghost2';
    addRowBtn.textContent = '＋ 行を追加';
    addRowBtn.style.cssText = 'font-size:12px;padding:4px 10px';
    toolbar.appendChild(applyBtn);
    toolbar.appendChild(addRowBtn);
    container.appendChild(toolbar);

    const tableWrap = document.createElement('div');
    tableWrap.style.cssText = 'flex:1;overflow:auto';

    const table = document.createElement('table');
    table.className = 'props-table';
    const thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>プロパティ</th><th>値</th><th style="width:40px"></th></tr>';
    const tbody = document.createElement('tbody');

    const addRow = (k, v) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><input class="prop-input" value="${escHtml(k)}" style="width:100%"></td>
            <td><input class="prop-input" value="${escHtml(v)}" style="width:100%"></td>
            <td><button class="btn btn-danger" style="padding:2px 6px;font-size:11px">×</button></td>`;
        tr.querySelector('button').addEventListener('click', () => tr.remove());
        tbody.appendChild(tr);
    };

    if (entries.length === 0) {
        const tr = document.createElement('tr');
        tr.innerHTML = '<td colspan="3" style="opacity:0.5;text-align:center;padding:12px">プロパティなし</td>';
        tbody.appendChild(tr);
    } else {
        entries.forEach(([k, v]) => addRow(k, v));
    }

    table.appendChild(thead);
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    container.appendChild(tableWrap);

    if (asset.data.length > 0) {
        const sep = document.createElement('div');
        sep.className = 'section-sep';
        sep.textContent = 'データ (HEX)';
        container.appendChild(sep);
        showHexViewer(asset, container);
    }

    addRowBtn.addEventListener('click', () => addRow('', ''));
    applyBtn.addEventListener('click', () => {
        const newProps = {};
        tbody.querySelectorAll('tr').forEach(tr => {
            const inputs = tr.querySelectorAll('.prop-input');
            if (inputs.length === 2) {
                const k = inputs[0].value.trim();
                const v = inputs[1].value;
                if (k) newProps[k] = v;
            }
        });
        asset.properties = newProps;
        applyBtn.textContent = '✓ 保存済み';
        applyBtn.style.background = '#4ecca3';
        setTimeout(() => { applyBtn.textContent = '✓ 適用'; applyBtn.style.background = ''; }, 1200);
    });
}

// ── Colour table viewer ───────────────────────────────────────────────────────
function showColourTableViewer(asset, container) {
    const data = asset.data;

    const wrap = document.createElement('div');
    wrap.className = 'col-viewer';

    const header = document.createElement('div');
    header.style.cssText = 'padding:10px 14px 6px;font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.5px';
    header.textContent   = `ColourTable — ${data.length} bytes`;
    wrap.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'col-grid';

    // Parse as RGBA (4 bytes per entry)
    const count = Math.floor(data.length / 4);
    if (count === 0) {
        grid.textContent = 'データなし';
    } else {
        for (let i = 0; i < count; i++) {
            const r = data[i * 4 + 0];
            const g = data[i * 4 + 1];
            const b = data[i * 4 + 2];
            const a = data[i * 4 + 3];
            const hex = `#${[r,g,b].map(v => v.toString(16).padStart(2,'0')).join('')}`;
            const swatch = document.createElement('div');
            swatch.className = 'col-swatch';
            swatch.style.background = `rgba(${r},${g},${b},${(a/255).toFixed(2)})`;
            swatch.title = `#${i}  RGBA(${r},${g},${b},${a})  ${hex}`;
            grid.appendChild(swatch);
        }
    }
    wrap.appendChild(grid);
    container.appendChild(wrap);

    const sep = document.createElement('div');
    sep.className   = 'section-sep';
    sep.textContent = 'データ (HEX)';
    container.appendChild(sep);
    showHexViewer(asset, container);
}

// ── Audio viewer ──────────────────────────────────────────────────────────────
function showAudioViewer(asset, container) {
    const data = asset.data;
    let mimeType = null;

    // Detect OGG
    if (data.length > 4 && data[0] === 0x4F && data[1] === 0x67 && data[2] === 0x67 && data[3] === 0x53) {
        mimeType = 'audio/ogg';
    }
    // Detect WAV
    else if (data.length > 4 && data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46) {
        mimeType = 'audio/wav';
    }
    // Detect MP3 (ID3 or 0xFF 0xFB)
    else if (data.length > 3 && ((data[0] === 0x49 && data[1] === 0x44 && data[2] === 0x33) || (data[0] === 0xFF && (data[1] & 0xE0) === 0xE0))) {
        mimeType = 'audio/mpeg';
    }

    const wrap = document.createElement('div');
    wrap.style.cssText = 'padding:20px;display:flex;flex-direction:column;align-items:center;gap:16px';

    if (mimeType) {
        const blob  = new Blob([data], { type: mimeType });
        const url   = URL.createObjectURL(blob);
        const audio = document.createElement('audio');
        audio.controls  = true;
        audio.src       = url;
        audio.className = 'audio-player';
        audio.addEventListener('error', () => {
            wrap.insertAdjacentHTML('afterbegin', '<div style="color:var(--red)">再生に失敗しました</div>');
        });
        wrap.appendChild(audio);
        const lbl = document.createElement('div');
        lbl.style.cssText = 'font-size:12px;color:var(--text-dim)';
        lbl.textContent   = `フォーマット: ${mimeType} — ${formatBytes(data.length)}`;
        wrap.appendChild(lbl);
        // Revoke URL when audio is not in use
        const cleanup = () => URL.revokeObjectURL(url);
        audio.addEventListener('emptied', cleanup);
    } else {
        const lbl = document.createElement('div');
        lbl.style.cssText = 'color:var(--text-dim);font-size:13px';
        lbl.textContent   = '音声形式を検出できません (OGG/WAV/MP3 以外またはPCK内包形式)';
        wrap.appendChild(lbl);
    }

    container.appendChild(wrap);

    const sep = document.createElement('div');
    sep.className   = 'section-sep';
    sep.textContent = 'データ (HEX)';
    container.appendChild(sep);
    showHexViewer(asset, container);
}

// ── Hex viewer ────────────────────────────────────────────────────────────────
function showHexViewer(asset, container) {
    const maxBytes  = 512;
    const data      = asset.data.slice(0, maxBytes);
    const hexLines  = [];
    for (let i = 0; i < data.length; i += 16) {
        const chunk = Array.from(data.slice(i, i + 16));
        const hex   = chunk.map(b => b.toString(16).padStart(2, '0')).join(' ');
        const ascii = chunk.map(b => (b >= 32 && b < 127) ? String.fromCharCode(b) : '.').join('');
        hexLines.push(`${i.toString(16).padStart(6, '0')}  ${hex.padEnd(47)}  ${ascii}`);
    }
    if (asset.data.length > maxBytes) hexLines.push(`\n… (${formatBytes(asset.data.length - maxBytes)} 省略)`);
    const pre = document.createElement('pre');
    pre.className   = 'hex-viewer';
    pre.textContent = hexLines.join('\n');
    container.appendChild(pre);
}

// ── Download asset ────────────────────────────────────────────────────────────
function downloadAsset(asset) {
    const ext  = asset.filename.includes('.') ? '' : (asset.ext ? '.' + asset.ext : '');
    const name = (asset.filename.split('/').pop() || asset.filename) + ext;
    _downloadBlob(new Blob([asset.data]), name);
}

function _downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href = url; a.download = name; a.click();
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
    if (n < 1024)           return `${n} B`;
    if (n < 1024 * 1024)    return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

// ── Tab helpers ───────────────────────────────────────────────────────────────
function _makeTab(label, active) {
    const b = document.createElement('button');
    b.textContent = label;
    b.className   = 'tab' + (active ? ' active' : '');
    return b;
}

function _activateTab(active, others) {
    active.classList.add('active');
    others.forEach(t => t.classList.remove('active'));
}

function _buildImgEl(asset) {
    const blob      = new Blob([asset.data], { type: 'image/png' });
    const url       = URL.createObjectURL(blob);
    const img       = document.createElement('img');
    img.src         = url;
    img.className   = 'preview-image pixelated';
    img.alt         = asset.filename;
    const sizeLabel = document.createElement('div');
    sizeLabel.className   = 'img-size';
    sizeLabel.textContent = '…';
    img.onload = () => {
        sizeLabel.textContent = `${img.naturalWidth} × ${img.naturalHeight} px`;
        URL.revokeObjectURL(url);
    };
    return { img, sizeLabel };
}
