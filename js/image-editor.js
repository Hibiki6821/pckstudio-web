/**
 * Canvas-based pixel image editor for PCK Studio Web.
 *
 * Features:
 *  - Pencil, Eraser, Flood-fill, Eyedropper tools
 *  - Color picker
 *  - Zoom in / out
 *  - Import image (replace texture with external PNG)
 *  - Apply changes → updates asset.data in-place
 */
class ImageEditor {
    /**
     * @param {HTMLElement} container  - DOM element to render into
     * @param {Object}      asset      - PCK asset object (asset.data will be updated on apply)
     * @param {Function}    onApply    - callback(newPngBytes: Uint8Array) fired after apply
     */
    constructor(container, asset, onApply) {
        this.container = container;
        this.asset = asset;
        this.onApply = onApply || null;

        this.tool    = 'pencil'; // pencil | eraser | fill | eyedropper
        this.color   = '#ffffff';
        this.zoom    = 8;
        this.isDragging = false;
        this.lastCell   = null; // {x, y} last drawn cell for line smoothing

        // Source-of-truth canvas (actual image resolution)
        this.imgCanvas = document.createElement('canvas');
        this.imgCtx    = this.imgCanvas.getContext('2d', { willReadFrequently: true });

        this._buildUI();
        this._loadFromAsset();
    }

    // ── UI construction ──────────────────────────────────────────────────────

    _buildUI() {
        this.container.className = 'editor-container';

        // ── Toolbar ────────────────────────────────────────────────────────
        const toolbar = document.createElement('div');
        toolbar.className = 'editor-toolbar';

        const makeTool = (icon, key, title) => {
            const btn = document.createElement('button');
            btn.className = 'editor-tool-btn' + (key === this.tool ? ' active' : '');
            btn.title = title;
            btn.textContent = icon;
            btn.addEventListener('click', () => {
                this.tool = key;
                toolbar.querySelectorAll('.editor-tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
            btn.dataset.tool = key;
            return btn;
        };

        toolbar.appendChild(makeTool('✏️', 'pencil',    '鉛筆 (Pencil)'));
        toolbar.appendChild(makeTool('🧹', 'eraser',    '消しゴム (Eraser)'));
        toolbar.appendChild(makeTool('🪣', 'fill',      '塗りつぶし (Fill)'));
        toolbar.appendChild(makeTool('💧', 'eyedropper','スポイト (Eyedropper)'));

        // separator
        const sep1 = document.createElement('div');
        sep1.className = 'editor-sep';
        toolbar.appendChild(sep1);

        // Color picker
        this.colorInput = document.createElement('input');
        this.colorInput.type = 'color';
        this.colorInput.value = this.color;
        this.colorInput.className = 'editor-color-input';
        this.colorInput.title = '描画色';
        this.colorInput.addEventListener('input', e => { this.color = e.target.value; });
        toolbar.appendChild(this.colorInput);

        // separator
        const sep2 = document.createElement('div');
        sep2.className = 'editor-sep';
        toolbar.appendChild(sep2);

        // Zoom controls
        const zoomOut = document.createElement('button');
        zoomOut.className = 'editor-tool-btn';
        zoomOut.textContent = '－';
        zoomOut.title = 'ズームアウト';
        zoomOut.addEventListener('click', () => this._setZoom(this.zoom - 2));

        this.zoomLabel = document.createElement('span');
        this.zoomLabel.className = 'editor-zoom-label';
        this.zoomLabel.textContent = `${this.zoom}×`;

        const zoomIn = document.createElement('button');
        zoomIn.className = 'editor-tool-btn';
        zoomIn.textContent = '＋';
        zoomIn.title = 'ズームイン';
        zoomIn.addEventListener('click', () => this._setZoom(this.zoom + 2));

        toolbar.appendChild(zoomOut);
        toolbar.appendChild(this.zoomLabel);
        toolbar.appendChild(zoomIn);

        // separator
        const sep3 = document.createElement('div');
        sep3.className = 'editor-sep';
        toolbar.appendChild(sep3);

        // Import image button
        this._importInput = document.createElement('input');
        this._importInput.type = 'file';
        this._importInput.accept = 'image/png,image/jpeg,image/gif,image/bmp,image/webp';
        this._importInput.style.display = 'none';
        this._importInput.addEventListener('change', e => {
            const file = e.target.files[0];
            if (file) this._importFile(file);
            this._importInput.value = '';
        });

        const importBtn = document.createElement('button');
        importBtn.className = 'btn btn-ghost';
        importBtn.style.fontSize = '12px';
        importBtn.style.padding = '4px 10px';
        importBtn.textContent = '📂 画像を読込';
        importBtn.title = '外部画像をインポートしてテクスチャを置き換え';
        importBtn.addEventListener('click', () => this._importInput.click());
        toolbar.appendChild(importBtn);
        toolbar.appendChild(this._importInput);

        // Apply button
        const applyBtn = document.createElement('button');
        applyBtn.className = 'btn btn-primary';
        applyBtn.style.fontSize = '12px';
        applyBtn.style.padding = '4px 12px';
        applyBtn.textContent = '✓ 適用';
        applyBtn.title = '変更を適用してアセットデータを更新';
        applyBtn.addEventListener('click', () => this._applyChanges());
        toolbar.appendChild(applyBtn);

        this.container.appendChild(toolbar);

        // ── Canvas wrapper ─────────────────────────────────────────────────
        this.canvasWrap = document.createElement('div');
        this.canvasWrap.className = 'editor-canvas-wrap';

        this.displayCanvas = document.createElement('canvas');
        this.displayCanvas.id = 'editor-display-canvas';
        this.displayCanvas.style.cursor = 'crosshair';

        this._setupCanvasEvents();

        this.canvasWrap.appendChild(this.displayCanvas);
        this.container.appendChild(this.canvasWrap);
    }

    // ── Load PNG from asset ──────────────────────────────────────────────────

    _loadFromAsset() {
        const blob = new Blob([this.asset.data], { type: 'image/png' });
        const url  = URL.createObjectURL(blob);
        const img  = new Image();
        img.onload = () => {
            this.imgCanvas.width  = img.naturalWidth;
            this.imgCanvas.height = img.naturalHeight;
            this.imgCtx.clearRect(0, 0, img.naturalWidth, img.naturalHeight);
            this.imgCtx.drawImage(img, 0, 0);
            URL.revokeObjectURL(url);
            this._render();
        };
        img.onerror = () => URL.revokeObjectURL(url);
        img.src = url;
    }

    // ── Canvas events ────────────────────────────────────────────────────────

    _setupCanvasEvents() {
        const dc = this.displayCanvas;

        dc.addEventListener('mousedown', e => {
            this.isDragging = true;
            this.lastCell = null;
            this._handlePointer(e);
        });
        dc.addEventListener('mousemove', e => {
            if (!this.isDragging) return;
            this._handlePointer(e);
        });
        dc.addEventListener('mouseup',    () => { this.isDragging = false; this.lastCell = null; });
        dc.addEventListener('mouseleave', () => { this.isDragging = false; this.lastCell = null; });

        dc.addEventListener('touchstart', e => {
            e.preventDefault();
            this.isDragging = true;
            this.lastCell = null;
            this._handlePointer(e.touches[0]);
        }, { passive: false });
        dc.addEventListener('touchmove', e => {
            e.preventDefault();
            if (!this.isDragging) return;
            this._handlePointer(e.touches[0]);
        }, { passive: false });
        dc.addEventListener('touchend', () => { this.isDragging = false; this.lastCell = null; });

        // Mouse wheel zoom
        dc.addEventListener('wheel', e => {
            e.preventDefault();
            this._setZoom(this.zoom + (e.deltaY < 0 ? 2 : -2));
        }, { passive: false });
    }

    _handlePointer(e) {
        const rect = this.displayCanvas.getBoundingClientRect();
        const dx = e.clientX - rect.left;
        const dy = e.clientY - rect.top;
        const ix = Math.floor(dx / this.zoom);
        const iy = Math.floor(dy / this.zoom);
        const w  = this.imgCanvas.width;
        const h  = this.imgCanvas.height;
        if (ix < 0 || ix >= w || iy < 0 || iy >= h) return;

        // Avoid redundant operations on same cell
        if (this.lastCell && this.lastCell.x === ix && this.lastCell.y === iy
            && this.tool !== 'eyedropper') return;
        this.lastCell = { x: ix, y: iy };

        switch (this.tool) {
            case 'pencil':    this._drawPixel(ix, iy);   break;
            case 'eraser':    this._erasePixel(ix, iy);  break;
            case 'fill':      if (!this.isDragging || !this.lastCell._filled) {
                                  this._floodFill(ix, iy);
                                  this.lastCell._filled = true;
                              } break;
            case 'eyedropper': this._pickColor(ix, iy);  break;
        }
    }

    // ── Tools ────────────────────────────────────────────────────────────────

    _drawPixel(ix, iy) {
        const [r, g, b] = this._hexToRgb(this.color);
        const imageData = this.imgCtx.getImageData(ix, iy, 1, 1);
        imageData.data[0] = r;
        imageData.data[1] = g;
        imageData.data[2] = b;
        imageData.data[3] = 255;
        this.imgCtx.putImageData(imageData, ix, iy);
        this._renderCell(ix, iy);
    }

    _erasePixel(ix, iy) {
        this.imgCtx.clearRect(ix, iy, 1, 1);
        this._renderCell(ix, iy);
    }

    _floodFill(startX, startY) {
        const w = this.imgCanvas.width;
        const h = this.imgCanvas.height;
        const imageData = this.imgCtx.getImageData(0, 0, w, h);
        const data = imageData.data;

        const idx = (x, y) => (y * w + x) * 4;
        const si  = idx(startX, startY);
        const sr  = data[si], sg = data[si + 1], sb = data[si + 2], sa = data[si + 3];

        const [nr, ng, nb] = this._hexToRgb(this.color);
        if (sr === nr && sg === ng && sb === nb && sa === 255) return; // same color

        const visited = new Uint8Array(w * h);
        const queue   = [startX + startY * w];
        visited[startX + startY * w] = 1;

        while (queue.length > 0) {
            const pos = queue.pop();
            const x   = pos % w;
            const y   = (pos / w) | 0;
            const i   = pos * 4;

            if (data[i] !== sr || data[i+1] !== sg || data[i+2] !== sb || data[i+3] !== sa) continue;

            data[i] = nr; data[i+1] = ng; data[i+2] = nb; data[i+3] = 255;

            const neighbors = [
                x > 0     ? pos - 1 : -1,
                x < w - 1 ? pos + 1 : -1,
                y > 0     ? pos - w : -1,
                y < h - 1 ? pos + w : -1,
            ];
            for (const n of neighbors) {
                if (n >= 0 && !visited[n]) { visited[n] = 1; queue.push(n); }
            }
        }

        this.imgCtx.putImageData(imageData, 0, 0);
        this._render();
    }

    _pickColor(ix, iy) {
        const d = this.imgCtx.getImageData(ix, iy, 1, 1).data;
        if (d[3] === 0) return; // transparent — don't pick
        this.color = `#${[d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join('')}`;
        this.colorInput.value = this.color;
        // Auto-switch back to pencil after picking
        this.tool = 'pencil';
        this.container.querySelector('[data-tool="pencil"]')?.classList.add('active');
        this.container.querySelector('[data-tool="eyedropper"]')?.classList.remove('active');
    }

    // ── Zoom ─────────────────────────────────────────────────────────────────

    _setZoom(z) {
        this.zoom = Math.max(1, Math.min(32, z));
        this.zoomLabel.textContent = `${this.zoom}×`;
        this._render();
    }

    // ── Rendering ────────────────────────────────────────────────────────────

    _render() {
        const iw = this.imgCanvas.width;
        const ih = this.imgCanvas.height;
        if (!iw || !ih) return;

        const cw = iw * this.zoom;
        const ch = ih * this.zoom;

        this.displayCanvas.width  = cw;
        this.displayCanvas.height = ch;

        const ctx = this.displayCanvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;

        // Checkerboard background (transparency indicator)
        const cs = Math.max(4, Math.min(this.zoom, 16));
        for (let y = 0; y < ch; y += cs) {
            for (let x = 0; x < cw; x += cs) {
                ctx.fillStyle = ((x / cs + y / cs) % 2 === 0) ? '#444455' : '#333344';
                ctx.fillRect(x, y, cs, cs);
            }
        }

        // Draw image scaled up
        ctx.drawImage(this.imgCanvas, 0, 0, cw, ch);

        // Grid lines (only when zoom >= 4)
        if (this.zoom >= 4) {
            ctx.strokeStyle = 'rgba(0,0,0,0.25)';
            ctx.lineWidth   = 0.5;
            ctx.beginPath();
            for (let x = 0; x <= cw; x += this.zoom) {
                ctx.moveTo(x, 0); ctx.lineTo(x, ch);
            }
            for (let y = 0; y <= ch; y += this.zoom) {
                ctx.moveTo(0, y); ctx.lineTo(cw, y);
            }
            ctx.stroke();
        }
    }

    /** Partial re-render for a single cell (fast path for pencil/eraser). */
    _renderCell(ix, iy) {
        const ctx = this.displayCanvas.getContext('2d');
        const z   = this.zoom;
        const x   = ix * z, y = iy * z;

        // Checkerboard
        const cs = Math.max(4, Math.min(z, 16));
        for (let dy = 0; dy < z; dy += cs) {
            for (let dx = 0; dx < z; dx += cs) {
                const gx = Math.floor((x + dx) / cs);
                const gy = Math.floor((y + dy) / cs);
                ctx.fillStyle = ((gx + gy) % 2 === 0) ? '#444455' : '#333344';
                ctx.fillRect(x + dx, y + dy, cs, cs);
            }
        }

        // Pixel
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(this.imgCanvas, ix, iy, 1, 1, x, y, z, z);

        // Grid border
        if (z >= 4) {
            ctx.strokeStyle = 'rgba(0,0,0,0.25)';
            ctx.lineWidth   = 0.5;
            ctx.strokeRect(x, y, z, z);
        }
    }

    // ── Import image ─────────────────────────────────────────────────────────

    _importFile(file) {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            this.imgCanvas.width  = img.naturalWidth;
            this.imgCanvas.height = img.naturalHeight;
            this.imgCtx.clearRect(0, 0, img.naturalWidth, img.naturalHeight);
            this.imgCtx.drawImage(img, 0, 0);
            URL.revokeObjectURL(url);
            this._render();
        };
        img.onerror = () => { URL.revokeObjectURL(url); alert('画像の読み込みに失敗しました'); };
        img.src = url;
    }

    // ── Apply changes ─────────────────────────────────────────────────────────

    _applyChanges() {
        this.imgCanvas.toBlob(blob => {
            blob.arrayBuffer().then(ab => {
                const bytes = new Uint8Array(ab);
                this.asset.data = bytes;
                this.asset.size = bytes.length;
                if (this.onApply) this.onApply(bytes);
                // Flash apply button green briefly
                const btn = this.container.querySelector('.btn-primary');
                if (btn) {
                    const orig = btn.textContent;
                    btn.textContent = '✓ 適用しました';
                    btn.style.background = '#4ecca3';
                    setTimeout(() => {
                        btn.textContent = orig;
                        btn.style.background = '';
                    }, 1200);
                }
            });
        }, 'image/png');
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    _hexToRgb(hex) {
        const n = parseInt(hex.replace('#', ''), 16);
        return [(n >> 16) & 0xFF, (n >> 8) & 0xFF, n & 0xFF];
    }
}
