/**
 * IPFS via Kubo HTTP API
 *
 * Requires IPFS Desktop to be open and running.
 * Default API endpoint: http://127.0.0.1:5001
 *
 * Workflow:
 *   Upload  → verify IPFS node is alive → encrypt buffer → POST /api/v0/add → get real Qm... CID
 *             also saves a copy to /uploads folder locally
 *   Download → POST /api/v0/cat?arg=<CID> → decrypt buffer
 */

const axios    = require('axios');
const FormData = require('form-data');
const fs       = require('fs');
const path     = require('path');

const KUBO_API    = process.env.IPFS_API_URL || 'http://127.0.0.1:5001';
const UPLOADS_DIR = path.join(__dirname, '../../uploads');

// Ensure local uploads directory exists on startup
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    console.log('[IPFS] Created local uploads directory:', UPLOADS_DIR);
}

/**
 * STRICT node check — throws a human-readable error if IPFS Desktop
 * is not running or not yet fully ready.
 * Must be awaited BEFORE any /api/v0/add or /api/v0/cat call.
 */
async function assertNodeOnline() {
    let res;
    try {
        res = await axios.post(`${KUBO_API}/api/v0/id`, null, { timeout: 5000 });
    } catch (connErr) {
        // ECONNREFUSED  → Desktop is not open at all
        // ETIMEDOUT     → Desktop is open but node is still booting
        const reason = connErr.code === 'ECONNREFUSED'
            ? 'IPFS Desktop is not open. Please start IPFS Desktop and wait for the node to come online (tray icon turns green), then try again.'
            : 'Cannot reach IPFS node at ' + KUBO_API + ' (' + connErr.message + '). Make sure IPFS Desktop is fully started.';
        throw new Error(reason);
    }

    // Connected but node hasn't finished initialising yet
    if (!res.data || !res.data.ID) {
        throw new Error(
            'IPFS node is still starting up. Wait a few seconds for IPFS Desktop to finish loading, then try again.'
        );
    }

    console.log('[IPFS] Node online — ID:', res.data.ID);
}

/**
 * Upload encrypted buffer to IPFS.
 * Saves a local copy to /uploads as well.
 * Returns the real CID (Qm...) assigned by the IPFS node.
 */
exports.uploadToIPFS = async (encryptedBuffer, filename) => {
    // ── HARD GATE: refuse to proceed if IPFS Desktop is not running ──────
    await assertNodeOnline();   // throws immediately with a clear message if offline

    const form = new FormData();
    form.append('file', encryptedBuffer, {
        filename:    filename || 'encrypted',
        contentType: 'application/octet-stream',
        knownLength: encryptedBuffer.length
    });

    let response;
    try {
        response = await axios.post(
            `${KUBO_API}/api/v0/add?pin=true`,
            form,
            {
                headers:           form.getHeaders(),
                maxContentLength:  Infinity,
                maxBodyLength:     Infinity,
                timeout:           60000,
                // Kubo returns NDJSON (one JSON object per line).
                // responseType:'text' prevents axios from auto-parsing the
                // whole body as one JSON object, which causes "Hash missing".
                responseType:      'text',
                transformResponse: [(data) => data]
            }
        );
    } catch (err) {
        if (err.code === 'ECONNREFUSED') {
            throw new Error('IPFS Desktop is not running. Please open it and try again.');
        }
        throw new Error('IPFS upload request failed: ' + err.message);
    }

    // ── Parse NDJSON response ────────────────────────────────────────────
    const rawText = typeof response.data === 'string'
        ? response.data
        : JSON.stringify(response.data);

    const lines = rawText
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0)
        .map(l => { try { return JSON.parse(l); } catch (e) { return null; } })
        .filter(Boolean);

    console.log('[IPFS] /add response lines:', JSON.stringify(lines));

    const entry = lines.find(l => l.Hash);
    if (!entry) {
        throw new Error('IPFS add response missing Hash — raw response: ' + rawText.slice(0, 300));
    }

    const cid = entry.Hash;
    console.log('[IPFS] Pinned:', filename, '→ CID:', cid);

    // ── Save encrypted copy locally ──────────────────────────────────────
    const safeFilename = cid + '_' + (filename || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
    const localPath    = path.join(UPLOADS_DIR, safeFilename);
    try {
        fs.writeFileSync(localPath, encryptedBuffer);
        console.log('[IPFS] Local copy saved:', localPath);
    } catch (fsErr) {
        console.warn('[IPFS] Could not save local copy:', fsErr.message);
    }

    return cid;
};

/**
 * Download encrypted content from IPFS by CID.
 * Returns a Buffer of the encrypted bytes.
 */
exports.downloadFromIPFS = async (cid) => {
    // Also gate downloads — no point trying if node is offline
    await assertNodeOnline();

    try {
        const response = await axios.post(
            `${KUBO_API}/api/v0/cat?arg=${encodeURIComponent(cid)}`,
            null,
            {
                responseType:     'arraybuffer',
                maxContentLength: Infinity,
                timeout:          60000
            }
        );
        console.log('[IPFS] Downloaded CID:', cid, '| bytes:', response.data.byteLength);
        return Buffer.from(response.data);
    } catch (err) {
        if (err.code === 'ECONNREFUSED') {
            throw new Error('IPFS Desktop is not running. Please open it and try again.');
        }
        throw new Error('IPFS download failed for CID ' + cid + ': ' + err.message);
    }
};

/**
 * Check if the Kubo node is reachable (used by the /api/ipfs-status endpoint).
 * Returns { online: true, id, version } or { online: false, error }
 */
exports.checkIPFSNode = async () => {
    try {
        const res = await axios.post(`${KUBO_API}/api/v0/id`, null, { timeout: 5000 });
        if (!res.data || !res.data.ID) return { online: false, error: 'Node not ready' };
        return { online: true, id: res.data.ID, version: res.data.AgentVersion };
    } catch (err) {
        return { online: false, error: err.message };
    }
};

exports.KUBO_API    = KUBO_API;
exports.UPLOADS_DIR = UPLOADS_DIR;
