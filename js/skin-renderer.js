/**
 * 3D Minecraft Skin Renderer using Three.js
 *
 * Supports 64×32 (classic) and 64×64 (modern) skin textures.
 * Features: overlay (second layer) toggle, Alex/slim arm toggle.
 * Mouse drag / touch to rotate the model.
 */
class SkinRenderer {
    constructor(container) {
        this.container = container;
        this.scene       = null;
        this.camera      = null;
        this.renderer    = null;
        this.character   = null;
        this.overlayGroup = null;
        this.animFrame   = null;
        this.isDragging  = false;
        this.prevMouse   = { x: 0, y: 0 };
        this.rotY = 0.4;
        this.rotX = 0.15;

        // Toggles (can be changed via setSlim / setOverlayVisible before or after loadSkin)
        this.isSlim      = false;
        this.showOverlay = true;

        this._currentTexture = null;
        this._init();
    }

    _init() {
        const w = this.container.clientWidth  || 400;
        const h = this.container.clientHeight || 500;

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x1e1e1e);

        this.camera = new THREE.PerspectiveCamera(35, w / h, 0.1, 1000);
        this.camera.position.set(0, 5, 72);
        this.camera.lookAt(0, 2, 0);

        this.renderer = new THREE.WebGLRenderer({ antialias: false });
        this.renderer.setSize(w, h);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.container.appendChild(this.renderer.domElement);

        const grid = new THREE.GridHelper(50, 10, 0x3a3a3a, 0x2a2a2a);
        grid.position.y = -16.5;
        this.scene.add(grid);

        this._setupControls();
        this._animate();
    }

    /** Load a skin from raw PNG bytes (Uint8Array). */
    loadSkin(pngBytes) {
        const blob = new Blob([pngBytes], { type: 'image/png' });
        const url  = URL.createObjectURL(blob);
        new THREE.TextureLoader().load(url, (texture) => {
            texture.magFilter = THREE.NearestFilter;
            texture.minFilter = THREE.NearestFilter;
            texture.needsUpdate = true;
            URL.revokeObjectURL(url);
            this._buildCharacter(texture);
        }, undefined, () => URL.revokeObjectURL(url));
    }

    /**
     * Create a body-part (limb) mesh with custom UV mapping.
     *
     * Face slot order in Three.js BoxGeometry:
     *   0: +x  1: -x  2: +y  3: -y  4: +z  5: -z
     *
     * uvFaces: { px, nx, py, ny, pz, nz }
     *   Each value: [x1, y1, x2, y2] in skin-texture pixels.
     */
    _createLimb(w, h, d, texture, uvFaces, mirrorX = false) {
        const geo    = new THREE.BoxGeometry(w, h, d);
        const uvAttr = geo.attributes.uv;
        const texW   = 64;
        const texH   = texture.image ? texture.image.height : 64;

        const faces = mirrorX
            ? { ...uvFaces, px: uvFaces.nx, nx: uvFaces.px }
            : uvFaces;

        const faceKeys = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];
        faceKeys.forEach((key, faceIdx) => {
            const uv = faces[key];
            if (!uv) return;
            const [x1, y1, x2, y2] = uv;
            const i  = faceIdx * 4;
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
            map: texture, transparent: true, alphaTest: 0.01,
        });
        return new THREE.Mesh(geo, mat);
    }

    _buildCharacter(texture) {
        // Clean up previous character
        if (this.character) {
            this.scene.remove(this.character);
            this.character.traverse(o => {
                if (o.geometry) o.geometry.dispose();
                if (o.material) o.material.dispose();
            });
        }

        this._currentTexture = texture;
        const texH    = texture.image ? texture.image.height : 64;
        const is64x64 = texH >= 64;
        const slim    = this.isSlim;

        this.character    = new THREE.Group();
        this.overlayGroup = null;
        const T = texture;

        // ── BASE LAYER ─────────────────────────────────────────────────────────

        // HEAD
        const head = this._createLimb(8, 8, 8, T, {
            py: [8,  0, 16,  8],
            ny: [16, 0, 24,  8],
            px: [16, 8, 24, 16],
            nx: [0,  8,  8, 16],
            pz: [8,  8, 16, 16],
            nz: [24, 8, 32, 16],
        });
        head.position.set(0, 12, 0);
        this.character.add(head);

        // BODY
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

        // RIGHT ARM  (Steve 4px wide / Alex 3px wide)
        const rightArmUV_s = {
            py: [44, 16, 48, 20], ny: [48, 16, 52, 20],
            nx: [40, 20, 44, 32], pz: [44, 20, 48, 32],
            px: [48, 20, 52, 32], nz: [52, 20, 56, 32],
        };
        const rightArmUV_a = {
            py: [44, 16, 47, 20], ny: [47, 16, 50, 20],
            nx: [40, 20, 44, 32], pz: [44, 20, 47, 32],
            px: [47, 20, 51, 32], nz: [51, 20, 54, 32],
        };
        const rightArmUV = slim ? rightArmUV_a : rightArmUV_s;
        const rightArm = this._createLimb(slim ? 3 : 4, 12, 4, T, rightArmUV);
        rightArm.position.set(slim ? -5.5 : -6, 2, 0);
        this.character.add(rightArm);

        // LEFT ARM
        let leftArm;
        if (is64x64) {
            const leftArmUV_s = {
                py: [36, 48, 40, 52], ny: [40, 48, 44, 52],
                nx: [32, 52, 36, 64], pz: [36, 52, 40, 64],
                px: [40, 52, 44, 64], nz: [44, 52, 48, 64],
            };
            const leftArmUV_a = {
                py: [36, 48, 39, 52], ny: [39, 48, 42, 52],
                nx: [32, 52, 36, 64], pz: [36, 52, 39, 64],
                px: [39, 52, 43, 64], nz: [43, 52, 46, 64],
            };
            leftArm = this._createLimb(slim ? 3 : 4, 12, 4, T, slim ? leftArmUV_a : leftArmUV_s);
        } else {
            leftArm = this._createLimb(slim ? 3 : 4, 12, 4, T, rightArmUV, true);
        }
        leftArm.position.set(slim ? 5.5 : 6, 2, 0);
        this.character.add(leftArm);

        // RIGHT LEG
        const rightLegUV = {
            py: [4,  16,  8, 20], ny: [8,  16, 12, 20],
            nx: [0,  20,  4, 32], pz: [4,  20,  8, 32],
            px: [8,  20, 12, 32], nz: [12, 20, 16, 32],
        };
        const rightLeg = this._createLimb(4, 12, 4, T, rightLegUV);
        rightLeg.position.set(-2, -10, 0);
        this.character.add(rightLeg);

        // LEFT LEG
        let leftLeg;
        if (is64x64) {
            leftLeg = this._createLimb(4, 12, 4, T, {
                py: [20, 48, 24, 52], ny: [24, 48, 28, 52],
                nx: [16, 52, 20, 64], pz: [20, 52, 24, 64],
                px: [24, 52, 28, 64], nz: [28, 52, 32, 64],
            });
        } else {
            leftLeg = this._createLimb(4, 12, 4, T, rightLegUV, true);
        }
        leftLeg.position.set(2, -10, 0);
        this.character.add(leftLeg);

        // ── OVERLAY LAYER (64×64 only) ────────────────────────────────────────
        if (is64x64) {
            const og = new THREE.Group();
            this.overlayGroup = og;

            // HAT  (head overlay – slightly larger: 9×9×9)
            const hat = this._createLimb(9, 9, 9, T, {
                py: [40, 0, 48, 8], ny: [48, 0, 56, 8],
                nx: [32, 8, 40, 16], pz: [40, 8, 48, 16],
                px: [48, 8, 56, 16], nz: [56, 8, 64, 16],
            });
            hat.position.set(0, 12, 0);
            og.add(hat);

            // JACKET  (body overlay – 9×13×5)
            const jacket = this._createLimb(9, 13, 5, T, {
                py: [20, 32, 28, 36], ny: [28, 32, 36, 36],
                nx: [16, 36, 20, 48], pz: [20, 36, 28, 48],
                px: [28, 36, 32, 48], nz: [32, 36, 40, 48],
            });
            jacket.position.set(0, 2, 0);
            og.add(jacket);

            // RIGHT SLEEVE
            const rSleeveUV_s = {
                py: [44, 32, 48, 36], ny: [48, 32, 52, 36],
                nx: [40, 36, 44, 48], pz: [44, 36, 48, 48],
                px: [48, 36, 52, 48], nz: [52, 36, 56, 48],
            };
            const rSleeveUV_a = {
                py: [44, 32, 47, 36], ny: [47, 32, 50, 36],
                nx: [40, 36, 44, 48], pz: [44, 36, 47, 48],
                px: [47, 36, 51, 48], nz: [51, 36, 54, 48],
            };
            const rSleeve = this._createLimb(slim ? 4 : 5, 13, 5, T, slim ? rSleeveUV_a : rSleeveUV_s);
            rSleeve.position.set(slim ? -5.5 : -6, 2, 0);
            og.add(rSleeve);

            // LEFT SLEEVE
            const lSleeveUV_s = {
                py: [52, 48, 56, 52], ny: [56, 48, 60, 52],
                nx: [48, 52, 52, 64], pz: [52, 52, 56, 64],
                px: [56, 52, 60, 64], nz: [60, 52, 64, 64],
            };
            const lSleeveUV_a = {
                py: [52, 48, 55, 52], ny: [55, 48, 58, 52],
                nx: [48, 52, 52, 64], pz: [52, 52, 55, 64],
                px: [55, 52, 59, 64], nz: [59, 52, 62, 64],
            };
            const lSleeve = this._createLimb(slim ? 4 : 5, 13, 5, T, slim ? lSleeveUV_a : lSleeveUV_s);
            lSleeve.position.set(slim ? 5.5 : 6, 2, 0);
            og.add(lSleeve);

            // RIGHT PANTS  (5×13×5)
            const rPants = this._createLimb(5, 13, 5, T, {
                py: [4, 32,  8, 36], ny: [8, 32, 12, 36],
                nx: [0, 36,  4, 48], pz: [4, 36,  8, 48],
                px: [8, 36, 12, 48], nz: [12, 36, 16, 48],
            });
            rPants.position.set(-2, -10, 0);
            og.add(rPants);

            // LEFT PANTS  (5×13×5)
            const lPants = this._createLimb(5, 13, 5, T, {
                py: [4, 48,  8, 52], ny: [8, 48, 12, 52],
                nx: [0, 52,  4, 64], pz: [4, 52,  8, 64],
                px: [8, 52, 12, 64], nz: [12, 52, 16, 64],
            });
            lPants.position.set(2, -10, 0);
            og.add(lPants);

            og.visible = this.showOverlay;
            this.character.add(og);
        }

        this.scene.add(this.character);
    }

    /** Toggle overlay (hat, jacket, sleeves, pants) visibility. */
    setOverlayVisible(v) {
        this.showOverlay = v;
        if (this.overlayGroup) this.overlayGroup.visible = v;
    }

    /** Toggle Alex/slim (3-pixel-wide) arms. Rebuilds the character mesh. */
    setSlim(slim) {
        if (this.isSlim === slim) return;
        this.isSlim = slim;
        if (this._currentTexture) this._buildCharacter(this._currentTexture);
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
