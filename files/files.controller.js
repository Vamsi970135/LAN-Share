const db         = require('../database.js');
const mime       = require('mime-types');
const CryptoJS   = require('crypto-js');
const axios      = require('axios');
const discovery  = require('../lan-discovery');

const { uploadToIPFS, downloadFromIPFS } = require('../config/ipfs.js');
const { addBlock }                        = require('../ledger/blockchain.js');

// ─────────────────────────────────────────────────────────────
// HELPER — extract userId from JWT header
// ─────────────────────────────────────────────────────────────
function getUserId(req) {
    let userId = 1;
    const authHeader = req.headers['authorization'];
    if (authHeader) {
        try {
            const token   = authHeader.split(' ')[1];
            const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
            userId = payload.id;
        } catch(e) {}
    }
    return userId;
}

// ─────────────────────────────────────────────────────────────
// UPLOAD FILE
//   1. AES-encrypt the file
//   2. Upload encrypted buffer to IPFS → get real Qm... CID
//   3. Save CID + key to DB
//   4. Broadcast CID+key to all discovered LAN peers
// ─────────────────────────────────────────────────────────────
exports.uploadFile = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        const userId = getUserId(req);

        // AES encrypt
        const key        = CryptoJS.lib.WordArray.random(16).toString();
        const base64Data = req.file.buffer.toString('base64');
        const encrypted  = CryptoJS.AES.encrypt(base64Data, key).toString();
        const encBuf     = Buffer.from(encrypted);

        // Upload to IPFS — returns a real Qm... CID
        const cid = await uploadToIPFS(encBuf, req.file.originalname);

        const myInfo = discovery.getMyInfo();

        // Save to DB
        db.run(
            'INSERT INTO files(userId, filename, cid, size, encryptionKey, ownerIp, ownerPort) VALUES(?,?,?,?,?,?,?)',
            [userId, req.file.originalname, cid, req.file.size, key, myInfo.ip || null, myInfo.port || 5000],
            function(err) {
                if (err) console.error('[DB] Insert error:', err);
            }
        );

        addBlock({
            action:    'UPLOAD',
            filename:  req.file.originalname,
            cid,
            size:      req.file.size,
            timestamp: new Date().toISOString()
        });

        console.log('[Upload] File:', req.file.originalname, '| CID:', cid);

        // ── Broadcast CID + key to all active LAN peers ──────
        const peers = discovery.getActivePeers();
        peers.forEach(peer => {
            axios.post(`http://${peer.ip}:${peer.port}/api/files/register-cid`, {
                cid,
                key,
                filename:  req.file.originalname,
                size:      req.file.size,
                ownerIp:   myInfo.ip,
                ownerPort: myInfo.port || 5000
            })
            .then(()  => console.log('[Upload] CID broadcasted to peer:', peer.ip + ':' + peer.port))
            .catch(e  => console.warn('[Upload] Could not broadcast to peer:', peer.ip, '-', e.message));
        });

        res.json({ message: 'File uploaded successfully', cid, key });

    } catch (err) {
        console.error('[Upload] Error:', err.message);

        // Give a clear message if IPFS node is not running
        if (err.message.includes('IPFS Desktop') || err.message.includes('ECONNREFUSED')) {
            return res.status(503).json({
                error: 'IPFS Desktop is not running. Please open IPFS Desktop and wait for the node to start, then try again.'
            });
        }
        res.status(500).json({ error: 'Upload failed: ' + err.message });
    }
};

// ─────────────────────────────────────────────────────────────
// REGISTER CID  (peer B receives CID+key from peer A and saves it)
// ─────────────────────────────────────────────────────────────
exports.registerCid = (req, res) => {
    const { cid, key, filename, size, ownerIp, ownerPort } = req.body;

    if (!cid || !key || !filename) {
        return res.status(400).json({ error: 'cid, key, and filename are required' });
    }

    const userId = getUserId(req);

    db.get('SELECT id, ownerIp FROM files WHERE cid=?', [cid], (err, row) => {
        if (row && row.ownerIp) {
            // Already registered — update ownerIp if we got a better one
            if (ownerIp) {
                db.run('UPDATE files SET ownerIp=?, ownerPort=? WHERE cid=?',
                    [ownerIp, ownerPort || 5000, cid]);
            }
            return res.json({ message: 'CID already registered', cid });
        }

        if (row && !row.ownerIp && ownerIp) {
            db.run('UPDATE files SET ownerIp=?, ownerPort=? WHERE cid=?',
                [ownerIp, ownerPort || 5000, cid]);
            return res.json({ message: 'CID owner updated', cid });
        }

        db.run(
            'INSERT INTO files(userId, filename, cid, size, encryptionKey, ownerIp, ownerPort) VALUES(?,?,?,?,?,?,?)',
            [userId, filename, cid, size || 0, key, ownerIp || null, ownerPort || 5000],
            function(err) {
                if (err) {
                    console.error('[registerCid] DB error:', err);
                    return res.status(500).json({ error: 'Failed to register CID' });
                }
                console.log('[registerCid] Registered:', filename, '|', cid, '| from:', ownerIp);
                res.json({ message: 'CID registered successfully', cid });
            }
        );
    });
};

// ─────────────────────────────────────────────────────────────
// DOWNLOAD FILE
//   1. Look up CID in DB to get the encryption key
//   2. Fetch encrypted content from IPFS using the CID
//   3. Decrypt and stream back to the browser
// ─────────────────────────────────────────────────────────────
exports.downloadFile = async (req, res) => {
    try {
        const cid = req.params.cid;

        db.get(
            'SELECT filename, encryptionKey FROM files WHERE cid=?',
            [cid],
            async (err, row) => {
                if (err)  return res.status(500).json({ message: 'Database error' });
                if (!row) return res.status(404).json({
                    message: 'CID not found in your database. Ask the sender to share it, or use "Register CID" to add it manually.'
                });

                const { filename, encryptionKey: key } = row;
                const contentType = mime.lookup(filename) || 'application/octet-stream';

                // Fetch encrypted bytes from IPFS
                let encryptedText;
                try {
                    const buf = await downloadFromIPFS(cid);
                    encryptedText = buf.toString();
                } catch (ipfsErr) {
                    console.error('[Download] IPFS fetch error:', ipfsErr.message);

                    if (ipfsErr.message.includes('IPFS Desktop') || ipfsErr.message.includes('ECONNREFUSED')) {
                        return res.status(503).json({
                            message: 'IPFS Desktop is not running. Please open IPFS Desktop and wait for the node to start, then try again.'
                        });
                    }
                    return res.status(502).json({
                        message: 'Could not fetch file from IPFS: ' + ipfsErr.message
                    });
                }

                // Decrypt
                try {
                    const decrypted  = CryptoJS.AES.decrypt(encryptedText, key);
                    const base64Data = decrypted.toString(CryptoJS.enc.Utf8);

                    if (!base64Data) {
                        return res.status(500).json({ message: 'Decryption failed — key may be wrong or file is corrupted' });
                    }

                    const originalBuffer = Buffer.from(base64Data, 'base64');

                    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
                    res.setHeader('Content-Type', contentType);

                    addBlock({ action: 'DOWNLOAD', filename, cid, timestamp: new Date().toISOString() });
                    console.log('[Download] Served:', filename, 'CID:', cid);
                    res.send(originalBuffer);

                } catch (decErr) {
                    res.status(500).json({ message: 'Decryption error: ' + decErr.message });
                }
            }
        );
    } catch (err) {
        console.error('[Download] Unexpected error:', err);
        res.status(500).json({ message: 'Download failed: ' + err.message });
    }
};

// ─────────────────────────────────────────────────────────────
// GET MY FILES
// ─────────────────────────────────────────────────────────────
exports.getMyFiles = (req, res) => {
    const userId = getUserId(req);
    db.all(
        'SELECT id, filename, cid, size, encryptionKey as key FROM files WHERE userId=? ORDER BY id DESC',
        [userId],
        (err, rows) => {
            if (err) return res.status(500).json({ error: 'DB error' });
            res.json({ files: rows || [] });
        }
    );
};

// ─────────────────────────────────────────────────────────────
// STATS
// ─────────────────────────────────────────────────────────────
exports.getStats = (req, res) => {
    db.get('SELECT COUNT(*) as totalFiles FROM files', (err, filesRow) => {
        db.get('SELECT COUNT(*) as totalUsers FROM users', (err, usersRow) => {
            db.get('SELECT SUM(size) as totalSize FROM files', (err, sizeRow) => {
                res.json({
                    totalFiles:    filesRow ? filesRow.totalFiles : 0,
                    totalUsers:    usersRow ? usersRow.totalUsers : 0,
                    totalSize:     sizeRow && sizeRow.totalSize ? sizeRow.totalSize : 0,
                    networkStatus: 'Online'
                });
            });
        });
    });
};
