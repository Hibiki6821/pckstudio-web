/**
 * PCK Binary Format Parser
 * Minecraft Legacy Console Edition / Console Edition .pck archive reader
 *
 * Format (Big Endian by default, Little Endian for Xbox One / PS4 / Vita):
 *   [Int32]  pckType          — must be >= 3 and <= 0x00F00000
 *   [Section] LookUpTable     — property name index table
 *   [Section] AssetEntries    — asset metadata (type, size, filename)
 *   [Section] AssetContents   — for each asset: properties then raw data
 *
 * Strings: [Int32 charCount][UTF-16 data (charCount*2 bytes)][Int32 padding=0]
 */

const PckAssetType = {
    0:  'Skin',
    1:  'Cape',
    2:  'Texture',
    3:  'UIData',
    4:  'Info',
    5:  'TexturePackInfo',
    6:  'Localisation',
    7:  'GameRules',
    8:  'Audio',
    9:  'ColourTable',
    10: 'GameRulesHeader',
    11: 'SkinData',
    12: 'Models',
    13: 'Behaviours',
    14: 'Material',
};

const PckAssetExt = {
    0:  'png',
    1:  'png',
    2:  'png',
    4:  '',
    5:  'pck',
    6:  'loc',
    7:  'grf',
    8:  'pck',
    9:  'col',
    10: 'grh',
    11: 'pck',
    12: 'bin',
    13: 'bin',
    14: 'bin',
};

class PckParser {
    /**
     * Parse a PCK file from an ArrayBuffer.
     * @param {ArrayBuffer} arrayBuffer
     * @returns {{pckType: number, xmlVersion: number, assets: Array}}
     */
    parse(arrayBuffer) {
        // Try big-endian first (Xbox 360, PS3, Wii U), then little-endian
        try {
            return this._parseWithEndian(arrayBuffer, false);
        } catch (e) {
            try {
                return this._parseWithEndian(arrayBuffer, true);
            } catch (e2) {
                throw new Error('PCKファイルの解析に失敗しました: ' + e.message);
            }
        }
    }

    _parseWithEndian(arrayBuffer, littleEndian) {
        const view = new DataView(arrayBuffer);
        let offset = 0;

        const readInt32 = () => {
            if (offset + 4 > arrayBuffer.byteLength) throw new Error('Unexpected end of file at offset ' + offset);
            const v = view.getInt32(offset, littleEndian);
            offset += 4;
            return v;
        };

        const readUint32 = () => {
            if (offset + 4 > arrayBuffer.byteLength) throw new Error('Unexpected end of file');
            const v = view.getUint32(offset, littleEndian);
            offset += 4;
            return v;
        };

        const readString = () => {
            const charCount = readInt32();
            if (charCount < 0 || charCount > 65536) throw new Error(`Invalid string length: ${charCount}`);
            const bytes = new Uint8Array(arrayBuffer, offset, charCount * 2);
            offset += charCount * 2;
            // Decode UTF-16
            let str = '';
            if (littleEndian) {
                for (let i = 0; i < bytes.length; i += 2) {
                    str += String.fromCharCode(bytes[i] | (bytes[i + 1] << 8));
                }
            } else {
                for (let i = 0; i < bytes.length; i += 2) {
                    str += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
                }
            }
            offset += 4; // padding (always 0x00000000)
            return str;
        };

        // === Header ===
        const pckType = readUint32();
        if (pckType < 3 || pckType > 0x00F00000) {
            throw new Error(`Invalid pckType: 0x${pckType.toString(16)}`);
        }

        // === LookUp Table (property name index) ===
        const lookupCount = readInt32();
        if (lookupCount < 0 || lookupCount > 10000) throw new Error(`Invalid lookup count: ${lookupCount}`);
        const propertyLookup = [];
        let hasXmlVersion = false;

        for (let i = 0; i < lookupCount; i++) {
            const index = readInt32();
            const name = readString();
            propertyLookup[index] = name;
            if (name === 'XMLVERSION') hasXmlVersion = true;
        }

        let xmlVersion = 0;
        if (hasXmlVersion) {
            xmlVersion = readInt32();
        }

        // === Asset Entries ===
        const assetCount = readInt32();
        if (assetCount < 0 || assetCount > 500000) throw new Error(`Invalid asset count: ${assetCount}`);

        const assets = [];
        for (let i = 0; i < assetCount; i++) {
            const size = readInt32();
            const type = readInt32();
            const filename = readString().replace(/\\/g, '/');
            assets.push({
                filename,
                type,
                typeName: PckAssetType[type] || `Type${type}`,
                ext: PckAssetExt[type] || '',
                size,
                properties: {},
                data: null,
            });
        }

        // === Asset Contents ===
        for (const asset of assets) {
            const propCount = readInt32();
            if (propCount < 0 || propCount > 1000) throw new Error(`Invalid property count: ${propCount}`);
            for (let p = 0; p < propCount; p++) {
                const keyIndex = readInt32();
                const value = readString();
                const key = propertyLookup[keyIndex] !== undefined ? propertyLookup[keyIndex] : `key${keyIndex}`;
                asset.properties[key] = value;
            }
            if (offset + asset.size > arrayBuffer.byteLength) {
                throw new Error(`Asset data out of bounds for ${asset.filename}`);
            }
            // Slice to copy (safer than view for long-lived references)
            asset.data = new Uint8Array(arrayBuffer, offset, asset.size);
            offset += asset.size;
        }

        return {
            pckType,
            xmlVersion,
            propertyLookup,
            littleEndian,
            assets,
        };
    }

    /**
     * Build a virtual folder tree from a flat list of assets.
     * @param {Array} assets
     * @returns {Object} tree node
     */
    static buildTree(assets) {
        const root = { name: '', children: {}, assets: [] };

        for (const asset of assets) {
            const parts = asset.filename.split('/').filter(Boolean);
            let node = root;
            for (let i = 0; i < parts.length - 1; i++) {
                const part = parts[i];
                if (!node.children[part]) {
                    node.children[part] = { name: part, children: {}, assets: [] };
                }
                node = node.children[part];
            }
            node.assets.push(asset);
        }

        return root;
    }
}
