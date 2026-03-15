/**
 * PCK Binary Format Builder
 * Rebuilds a PCK archive from parsed pckData, preserving endianness.
 */
class PckBuilder {
    /**
     * Build a PCK binary from the pckData object returned by PckParser.parse().
     * @param {Object} pckData
     * @returns {Uint8Array}
     */
    build(pckData) {
        const { pckType, xmlVersion, propertyLookup, littleEndian, assets } = pckData;
        const le = !!littleEndian;
        const chunks = [];

        const writeInt32 = (v) => {
            const buf = new Uint8Array(4);
            new DataView(buf.buffer).setInt32(0, v, le);
            chunks.push(buf);
        };

        const writeUint32 = (v) => {
            const buf = new Uint8Array(4);
            new DataView(buf.buffer).setUint32(0, v, le);
            chunks.push(buf);
        };

        // String: [Int32 charCount][UTF-16 bytes][Int32 padding=0]
        const writeString = (str) => {
            writeInt32(str.length);
            if (str.length > 0) {
                const buf = new Uint8Array(str.length * 2);
                const dv = new DataView(buf.buffer);
                for (let i = 0; i < str.length; i++) {
                    const code = str.charCodeAt(i);
                    if (le) {
                        dv.setUint8(i * 2,     code & 0xFF);
                        dv.setUint8(i * 2 + 1, (code >> 8) & 0xFF);
                    } else {
                        dv.setUint8(i * 2,     (code >> 8) & 0xFF);
                        dv.setUint8(i * 2 + 1, code & 0xFF);
                    }
                }
                chunks.push(buf);
            }
            writeInt32(0); // padding
        };

        // ── Header ─────────────────────────────────────────────────────────
        writeUint32(pckType);

        // ── LookUp Table ───────────────────────────────────────────────────
        const lookupEntries = [];
        if (Array.isArray(propertyLookup)) {
            propertyLookup.forEach((name, index) => {
                if (name !== undefined) lookupEntries.push([index, name]);
            });
        }
        writeInt32(lookupEntries.length);
        const hasXmlVersion = lookupEntries.some(([, name]) => name === 'XMLVERSION');
        for (const [index, name] of lookupEntries) {
            writeInt32(index);
            writeString(name);
        }
        if (hasXmlVersion) {
            writeInt32(xmlVersion || 0);
        }

        // ── Asset Entries ──────────────────────────────────────────────────
        writeInt32(assets.length);
        for (const asset of assets) {
            writeInt32(asset.data.length); // actual (possibly modified) size
            writeInt32(asset.type);
            writeString(asset.filename.replace(/\//g, '\\')); // PCK uses backslashes
        }

        // ── Asset Contents ─────────────────────────────────────────────────
        for (const asset of assets) {
            const propEntries = Object.entries(asset.properties || {});
            writeInt32(propEntries.length);
            for (const [key, value] of propEntries) {
                let keyIndex = Array.isArray(propertyLookup)
                    ? propertyLookup.indexOf(key)
                    : -1;
                writeInt32(keyIndex >= 0 ? keyIndex : 0);
                writeString(value);
            }
            const data = asset.data instanceof Uint8Array
                ? asset.data
                : new Uint8Array(asset.data);
            chunks.push(data);
        }

        // ── Combine all chunks ─────────────────────────────────────────────
        const totalSize = chunks.reduce((s, c) => s + c.byteLength, 0);
        const result = new Uint8Array(totalSize);
        let offset = 0;
        for (const chunk of chunks) {
            result.set(chunk, offset);
            offset += chunk.byteLength;
        }
        return result;
    }
}
