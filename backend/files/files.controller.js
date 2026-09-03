const db = require('../database.js');
const mime = require('mime-types');
const CryptoJS = require('crypto-js');
const axios = require('axios');
const discovery = require('../lan-discovery');

const { uploadToFTP, downloadFromFTP, getFTPStatus, listFTPFiles, FTP_PORT } = require('../config/ftp.js');
const { addBlock } = require('../ledger/blockchain.js');

// ─────────────────────────────────────────────────────────────
// HELPER — extract userId from JWT header
// ─────────────────────────────────────────────────────────────
function getUserId(req) {
    let userId = 1;
    const authHeader = req.headers['authorization'];
    if (authHeader) {
        try {
            const token = authHeader.split(' ')[1];
            const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
            userId = payload.id;
        } catch (e) {}
    }
    return userId;
}

// ─────────────────────────────────────────────────────────────
// UPLOAD FILE
//   1. AES-encrypt the file
//   2. Store encrypted buffer in FTP storage directory
//   3. Save CID (transfer code) + key to DB
//   4. Broadcast CID+key to all discovered LAN peers
// ─────────────────────────────────────────────────────────────
exports.uploadFile = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        const userId = getUserId(req);

        // AES encrypt
        const key = CryptoJS.lib.WordArray.random(16).toString();
        const base64Data = req.file.buffer.toString('base64');
        const encrypted = CryptoJS.AES.encrypt(base64Data, key).toString();
        const encBuf = Buffer.from(encrypted);

        // Upload to Traditional FTP storage
        const uploadResult = await uploadToFTP(encBuf, req.file.originalname);
        const cid = uploadResult.cid;
        const myInfo = discovery.getMyInfo();

        // Save to DB
        db.run(
            'INSERT INTO files(userId, filename, cid, size, encryptionKey, ownerIp, ownerPort) VALUES(?,?,?,?,?,?,?)',
            [userId, req.file.originalname, cid, req.file.size, key, myInfo.ip || null, myInfo.port || 3000],
            function (err) {
                if (err) console.error('[DB] Insert error:', err);
            }
        );

        addBlock({
            action: 'UPLOAD_FTP',
            filename: req.file.originalname,
            cid,
            size: req.file.size,
            timestamp: new Date().toISOString()
        });

        console.log('[Upload] File:', req.file.originalname, '| Transfer Code:', cid, '| Stored on FTP');

        // ── Broadcast CID + key to all active LAN peers ──────
        const peers = discovery.getActivePeers();
        peers.forEach(peer => {
            axios.post(`http://${peer.ip}:${peer.port}/api/files/register-cid`, {
                cid,
                key,
                filename: req.file.originalname,
                size: req.file.size,
                ownerIp: myInfo.ip,
                ownerPort: myInfo.port || 3000,
                ftpPort: FTP_PORT
            })
            .then(() => console.log('[Upload] Transfer Code broadcasted to peer:', peer.ip + ':' + peer.port))
            .catch(e => console.warn('[Upload] Could not broadcast to peer:', peer.ip, '-', e.message));
        });

        res.json({
            message: 'File uploaded successfully to FTP storage',
            cid,
            key,
            filename: req.file.originalname,
            size: req.file.size,
            ftpPort: FTP_PORT,
            ftpUrl: `ftp://${myInfo.ip || '127.0.0.1'}:${FTP_PORT}/${uploadResult.storageFilename}`
        });

    } catch (err) {
        console.error('[Upload] Error:', err.message);
        res.status(500).json({ error: 'Upload failed: ' + err.message });
    }
};

// ─────────────────────────────────────────────────────────────
// REGISTER CID / TRANSFER CODE (peer B receives CID+key from peer A and saves it)
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
                    [ownerIp, ownerPort || 3000, cid]);
            }
            return res.json({ message: 'Transfer Code already registered', cid });
        }

        if (row && !row.ownerIp && ownerIp) {
            db.run('UPDATE files SET ownerIp=?, ownerPort=? WHERE cid=?',
                [ownerIp, ownerPort || 3000, cid]);
            return res.json({ message: 'Owner updated for Transfer Code', cid });
        }

        db.run(
            'INSERT INTO files(userId, filename, cid, size, encryptionKey, ownerIp, ownerPort) VALUES(?,?,?,?,?,?,?)',
            [userId, filename, cid, size || 0, key, ownerIp || null, ownerPort || 3000],
            function (err) {
                if (err) {
                    console.error('[registerCid] DB error:', err);
                    return res.status(500).json({ error: 'Failed to register file code' });
                }
                console.log('[registerCid] Registered:', filename, '|', cid, '| from:', ownerIp);
                res.json({ message: 'File registered successfully', cid });
            }
        );
    });
};

// ─────────────────────────────────────────────────────────────
// DOWNLOAD FILE
//   1. Look up CID in DB to get the encryption key
//   2. Fetch encrypted content from traditional FTP storage
//   3. Decrypt and stream back to the browser
// ─────────────────────────────────────────────────────────────
exports.downloadFile = async (req, res) => {
    try {
        const cid = req.params.cid;

        db.get(
            'SELECT filename, encryptionKey, ownerIp, ownerPort FROM files WHERE cid=?',
            [cid],
            async (err, row) => {
                if (err) return res.status(500).json({ message: 'Database error' });
                if (!row) {
                    return res.status(404).json({
                        message: 'File code not found in your database. Ask the sender to share it, or use "Register CID" to add it manually.'
                    });
                }

                const { filename, encryptionKey: key, ownerIp, ownerPort } = row;
                const contentType = mime.lookup(filename) || 'application/octet-stream';

                // Fetch encrypted bytes from local FTP storage or remote peer fallback
                let encryptedText;
                try {
                    const buf = await downloadFromFTP(cid);
                    encryptedText = buf.toString();
                } catch (ftpErr) {
                    console.warn('[Download] Local FTP fetch failed, checking peer fallback:', ftpErr.message);

                    // If file is stored on a peer's server, attempt to fetch from peer
                    if (ownerIp && ownerPort) {
                        try {
                            const peerUrl = `http://${ownerIp}:${ownerPort}/api/files/download/${encodeURIComponent(cid)}`;
                            console.log('[Download] Fetching from peer:', peerUrl);
                            const peerRes = await axios.get(peerUrl, { responseType: 'arraybuffer', timeout: 8000 });
                            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
                            res.setHeader('Content-Type', contentType);
                            return res.send(Buffer.from(peerRes.data));
                        } catch (peerErr) {
                            console.error('[Download] Peer fetch also failed:', peerErr.message);
                        }
                    }

                    return res.status(404).json({
                        message: 'Could not fetch file from FTP storage: ' + ftpErr.message
                    });
                }

                // Decrypt
                try {
                    const decrypted = CryptoJS.AES.decrypt(encryptedText, key);
                    const base64Data = decrypted.toString(CryptoJS.enc.Utf8);

                    if (!base64Data) {
                        return res.status(500).json({ message: 'Decryption failed — key may be wrong or file is corrupted' });
                    }

                    const originalBuffer = Buffer.from(base64Data, 'base64');

                    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
                    res.setHeader('Content-Type', contentType);

                    addBlock({ action: 'DOWNLOAD_FTP', filename, cid, timestamp: new Date().toISOString() });
                    console.log('[Download] Served:', filename, 'Code:', cid);
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
        'SELECT id, filename, cid, size, encryptionKey as key, uploadedAt FROM files WHERE userId=? ORDER BY id DESC',
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
                    totalFiles: filesRow ? filesRow.totalFiles : 0,
                    totalUsers: usersRow ? usersRow.totalUsers : 0,
                    totalSize: sizeRow && sizeRow.totalSize ? sizeRow.totalSize : 0,
                    networkStatus: 'Online'
                });
            });
        });
    });
};

// ─────────────────────────────────────────────────────────────
// FTP SERVER STATUS
// ─────────────────────────────────────────────────────────────
exports.getFTPStatus = async (req, res) => {
    try {
        const status = await getFTPStatus();
        res.json(status);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────
// LIST FTP FILES
// ─────────────────────────────────────────────────────────────
exports.listFTPFiles = async (req, res) => {
    try {
        const files = await listFTPFiles();
        res.json({ files });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
