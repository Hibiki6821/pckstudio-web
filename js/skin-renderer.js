/**
 * 3D Minecraft Skin Renderer using Three.js
 *
 * Supports 64×32 (classic) and 64×64 (modern) skin textures.
 * Mouse drag / touch to rotate the model.
 */
class SkinRenderer {
    constructor(container) {
        this.container = container;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.character = null;
        this.animFrame = null;
        this.isDragging = false;
        this.prevMouse = { x: 0, y: 0 };
        this.rotY = 0.4;
        this.rotX = 0.15;
        this._init();
    }

    _init() {
        const w = this.container.clientWidth || 400;
        const h = this.container.clientHeight || 500;

        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x23233a);

        // Camera
        this.camera = new THREE.PerspectiveCamera(35, w / h, 0.1, 1000);
        this.camera.position.set(0, 5, 72);
        this.camera.lookAt(0, 2, 0);

        // Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: false });
        this.renderer.setSize(w, h);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.container.appendChild(this.renderer.domElement);

        // Grid
        const grid = new THREE.GridHelper(50, 10, 0x3a3a5c, 0x2e2e4a);
        grid.position.y = -16.5;
        this.scene.add(grid);

        this._setupControls();
        this._animate();
    }

    /**
     * Load a skin from raw PNG bytes (Uint8Array).
     */
    loadSkin(pngBytes) {
        const blob = new Blob([pngBytes], { type: 'image/png' });
        const url = URL.createObjectURL(blob);
        const loader = new THREE.TextureLoader();
        loader.load(url, (texture) => {
            texture.magFilter = THREE.NearestFilter;
            texture.minFilter = THREE.NearestFilter;
            texture.needsUpdate = true;
            URL.revokeObjectURL(url);
            this._buildCharacter(texture);
        }, undefined, (err) => {
            console.error('Skin texture load error:', err);
        });
    }

    /**
     * Create a body part (limb) mesh with custom UV mapping.
     *
     * Face order in Three.js BoxGeometry:
     *   0: +x (right / character's LEFT)
     *   1: -x (left  / character's RIGHT)
     *   2: +y (top)
     *   3: -y (bottom)
     *   4: +z (front)
     *   5: -z (back)
     *
     * uvFaces: { px, nx, py, ny, pz, nz }
     *   Each value is [x1, y1, x2, y2] in skin texture pixels.
     *
     * @param {number} w Width
     * @param {number} h Height
     * @param {number} d Depth
     * @param {THREE.Texture} texture
     * @param {Object} uvFaces
     * @param {boolean} [mirrorX=false] Swap px/nx UVs (for mirroring classic limbs)
     */
    _createLimb(w, h, d, texture, uvFaces, mirrorX = false) {
        const geo = new THREE.BoxGeometry(w, h, d);
        const uvAttr = geo.attributes.uv;
        const texW = 64;
        const texH = texture.image ? texture.image.height : 64;

        const faces = mirrorX
            ? { ...uvFaces, px: uvFaces.nx, nx: uvFaces.px }
            : uvFaces;

        // Face slot → UV face key
        const faceKeys = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];

        faceKeys.forEach((key, faceIdx) => {
            const uv = faces[key];
            if (!uv) return;
            const [x1, y1, x2, y2] = uv;
            const i = faceIdx * 4;
            // Normalize: v is flipped because texture Y=0 is at top, UV Y=0 is at bottom
            const u1 = x1 / texW, u2 = x2 / texW;
            const v1 = 1 - y2 / texH, v2 = 1 - y1 / texH;
            // BoxGeometry UV order per face: [top-left, top-right, bottom-left, bottom-right]
            uvAttr.setXY(i + 0, u1, v2); // top-left
            uvAttr.setXY(i + 1, u2, v2); // top-right
            uvAttr.setXY(i + 2, u1, v1); // bottom-left
            uvAttr.setXY(i + 3, u2, v1); // bottom-right
        });
        uvAttr.needsUpdate = true;

        const mat = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            alphaTest: 0.01,
        });
        return new THREE.Mesh(geo, mat);
    }

    _buildCharacter(texture) {
        if (this.character) {
            this.scene.remove(this.character);
            this.character.traverse(o => {
                if (o.geometry) o.geometry.dispose();
                if (o.material) o.material.dispose();
            });
        }

        const texH = texture.image ? texture.image.height : 64;
        const is64x64 = texH >= 64;

        this.character = new THREE.Group();
        const T = texture;

        // ── HEAD ──────────────────────────────────────────────────────────────
        // UV layout: top(8,0→16,8), bottom(16,0→24,8),
        //            right(0,8→8,16), front(8,8→16,16), left(16,8→24,16), back(24,8→32,16)
        const head = this._createLimb(8, 8, 8, T, {
            py: [8,  0, 16,  8], // top
            ny: [16, 0, 24,  8], // bottom
            px: [16, 8, 24, 16], // +x = char's left face
            nx: [0,  8,  8, 16], // -x = char's right face
            pz: [8,  8, 16, 16], // front
            nz: [24, 8, 32, 16], // back
        });
        head.position.set(0, 12, 0);
        this.character.add(head);

        // ── BODY ──────────────────────────────────────────────────────────────
        const body = this._createLimb(8, 12, 4, T, {
            py: [20, 16, 28, 20],
            ny: [28, 16, 36, 20],
            px: [28, 20, 32, 32],
            nx: [16, 20, 20, 32],
            pz: [20, 20, 28, 32],
            nz: [32, 20, 40, 32],
        });
        body.position.set(0, 2, 0);
        this.character.add(body);

        // ── RIGHT ARM (character's right = -x side) ───────────────────────────
        const rightArmUV = {
            py: [44, 16, 48, 20],
            ny: [48, 16, 52, 20],
            px: [48, 20, 52, 32],
            nx: [40, 20, 44, 32],
            pz: [44, 20, 48, 32],
            nz: [52, 20, 56, 32],
        };
        const rightArm = this._createLimb(4, 12, 4, T, rightArmUV);
        rightArm.position.set(-6, 2, 0);
        this.character.add(rightArm);

        // ── LEFT ARM (character's left = +x side) ────────────────────────────
        let leftArm;
        if (is64x64) {
            leftArm = this._createLimb(4, 12, 4, T, {
                py: [36, 48, 40, 52],
                ny: [40, 48, 44, 52],
                px: [40, 52, 44, 64],
                nx: [32, 52, 36, 64],
                pz: [36, 52, 40, 64],
                nz: [44, 52, 48, 64],
            });
        } else {
            // Classic skin: mirror right arm
            leftArm = this._createLimb(4, 12, 4, T, rightArmUV, true);
        }
        leftArm.position.set(6, 2, 0);
        this.character.add(leftArm);

        // ── RIGHT LEG (character's right = -x, near center) ──────────────────
        const rightLegUV = {
            py: [4,  16,  8, 20],
            ny: [8,  16, 12, 20],
            px: [8,  20, 12, 32],
            nx: [0,  20,  4, 32],
            pz: [4,  20,  8, 32],
            nz: [12, 20, 16, 32],
        };
        const rightLeg = this._createLimb(4, 12, 4, T, rightLegUV);
        rightLeg.position.set(-2, -10, 0);
        this.character.add(rightLeg);

        // ── LEFT LEG (character's left = +x, near center) ────────────────────
        let leftLeg;
        if (is64x64) {
            leftLeg = this._createLimb(4, 12, 4, T, {
                py: [20, 48, 24, 52],
                ny: [24, 48, 28, 52],
                px: [24, 52, 28, 64],
                nx: [16, 52, 20, 64],
                pz: [20, 52, 24, 64],
                nz: [28, 52, 32, 64],
            });
        } else {
            leftLeg = this._createLimb(4, 12, 4, T, rightLegUV, true);
        }
        leftLeg.position.set(2, -10, 0);
        this.character.add(leftLeg);

        this.scene.add(this.character);
    }

    _setupControls() {
        const el = this.renderer.domElement;

        const onDown = (x, y) => { this.isDragging = true; this.prevMouse = { x, y }; };
        const onMove = (x, y) => {
            if (!this.isDragging) return;
            this.rotY += (x - this.prevMouse.x) * 0.012;
            this.rotX += (y - this.prevMouse.y) * 0.012;
            this.rotX = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, this.rotX));
            this.prevMouse = { x, y };
        };
        const onUp = () => { this.isDragging = false; };

        el.addEventListener('mousedown',  e => onDown(e.clientX, e.clientY));
        el.addEventListener('mousemove',  e => onMove(e.clientX, e.clientY));
        el.addEventListener('mouseup',    onUp);
        el.addEventListener('mouseleave', onUp);

        el.addEventListener('touchstart', e => { const t = e.touches[0]; onDown(t.clientX, t.clientY); }, { passive: true });
        el.addEventListener('touchmove',  e => { const t = e.touches[0]; onMove(t.clientX, t.clientY); e.preventDefault(); }, { passive: false });
        el.addEventListener('touchend',   onUp);
    }

    _animate() {
        this.animFrame = requestAnimationFrame(() => this._animate());
        if (this.character) {
            this.character.rotation.y = this.rotY;
            this.character.rotation.x = this.rotX;
            if (!this.isDragging) this.rotY += 0.006;
        }
        this.renderer.render(this.scene, this.camera);
    }

    resize() {
        const w = this.container.clientWidth;
        const h = this.container.clientHeight;
        if (!w || !h) return;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
    }

    dispose() {
        if (this.animFrame) cancelAnimationFrame(this.animFrame);
        if (this.renderer) {
            this.renderer.dispose();
            this.renderer.domElement.remove();
        }
    }
}
