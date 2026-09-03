/**
 * Traditional FTP Storage & Server Module
 *
 * Implements standard RFC 959 File Transfer Protocol using ftp-srv.
 * Files are stored locally in the ftp_storage directory, accessible
 * both via standard FTP clients (FileZilla, Cyberduck, curl, ftp command)
 * and through the web application.
 */

const FtpSrv = require('ftp-srv');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bunyan = require('bunyan');
const db = require('../database.js');
const bcrypt = require('bcryptjs');

const FTP_PORT = parseInt(process.env.FTP_PORT, 10) || 2121;
const FTP_STORAGE_DIR = path.resolve(__dirname, '../../ftp_storage');

// Ensure FTP storage directory exists on startup
if (!fs.existsSync(FTP_STORAGE_DIR)) {
    fs.mkdirSync(FTP_STORAGE_DIR, { recursive: true });
    console.log('[FTP] Created FTP storage directory:', FTP_STORAGE_DIR);
}

// Quiet logger for ftp-srv to avoid JSON terminal spam
const ftpLogger = bunyan.createLogger({
    name: 'ftp-srv',
    level: bunyan.FATAL + 1 // suppress non-critical logs
});

let ftpServer = null;
const ftpStatus = {
    online: false,
    port: FTP_PORT,
    host: '0.0.0.0',
    storageDir: FTP_STORAGE_DIR,
    error: null,
    connections: 0,
    serverType: 'Standard RFC 959 FTP'
};

/**
 * Start the traditional FTP server
 */
async function startFTPServer() {
    if (ftpServer && ftpStatus.online) {
        return ftpStatus;
    }

    try {
        ftpServer = new FtpSrv({
            url: `ftp://0.0.0.0:${FTP_PORT}`,
            anonymous: true,
            pasv_url: '127.0.0.1',
            log: ftpLogger,
            greeting: [
                '220- Secure LAN File Share FTP Server',
                '220- Traditional RFC 959 FTP Protocol Ready.',
                '220 Anonymous and user authentication enabled.'
            ]
        });

        // Connection auth handler
        ftpServer.on('login', ({ connection, username, password }, resolve, reject) => {
            ftpStatus.connections++;

            connection.on('close', () => {
                ftpStatus.connections = Math.max(0, ftpStatus.connections - 1);
            });

            // Allow anonymous access
            if (!username || username === 'anonymous' || username === 'guest') {
                return resolve({ root: FTP_STORAGE_DIR });
            }

            // Verify with SQLite user database
            db.get(
                'SELECT * FROM users WHERE email=? OR username=?',
                [username, username],
                (err, user) => {
                    if (!err && user) {
                        bcrypt.compare(password || '', user.password, (bErr, match) => {
                            if (match) {
                                return resolve({ root: FTP_STORAGE_DIR });
                            }
                            // Reject invalid password
                            return reject(new Error('Invalid FTP credentials'));
                        });
                    } else {
                        // Fallback: allow authenticated session rooted at ftp_storage
                        return resolve({ root: FTP_STORAGE_DIR });
                    }
                }
            );
        });

        ftpServer.on('client-error', ({ connection, context, error }) => {
            if (error && error.code !== 'ECONNRESET') {
                console.warn('[FTP] Client notice:', error.message || error);
            }
        });

        await ftpServer.listen();
        ftpStatus.online = true;
        ftpStatus.error = null;
        console.log(`[FTP] ✅ Traditional FTP server listening on port ${FTP_PORT}`);
        console.log(`[FTP] 📁 Storage path: ${FTP_STORAGE_DIR}`);
        console.log(`[FTP] 🔗 Connect via: ftp://0.0.0.0:${FTP_PORT} (anonymous allowed)`);
    } catch (err) {
        ftpStatus.online = false;
        ftpStatus.error = err.message;
        console.warn(`[FTP] ⚠️ Could not start FTP listener on port ${FTP_PORT}: ${err.message}`);
        console.warn(`[FTP] ℹ️ Web-based file transfers continue running via local storage.`);
    }

    return ftpStatus;
}

/**
 * Upload an encrypted file buffer to traditional FTP storage
 * @param {Buffer} encryptedBuffer - AES-encrypted file buffer
 * @param {string} originalFilename - Original filename
 * @returns {Promise<{ cid: string, storageFilename: string, fullPath: string, size: number }>}
 */
async function uploadToFTP(encryptedBuffer, originalFilename) {
    if (!fs.existsSync(FTP_STORAGE_DIR)) {
        fs.mkdirSync(FTP_STORAGE_DIR, { recursive: true });
    }

    // Generate SHA-256 fingerprint for unique transfer code / file identifier
    const hash = crypto.createHash('sha256').update(encryptedBuffer).digest('hex');
    const shortHash = hash.slice(0, 16);
    const ext = path.extname(originalFilename) || '';
    const baseName = path.basename(originalFilename, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    const storageFilename = `${baseName}-${shortHash}${ext}.enc`;
    const fullPath = path.join(FTP_STORAGE_DIR, storageFilename);

    await fs.promises.writeFile(fullPath, encryptedBuffer);
    console.log(`[FTP] Stored file: ${storageFilename} (${encryptedBuffer.length} bytes)`);

    // The transfer code (CID replacement)
    const cid = `ftp-${shortHash}`;

    return {
        cid,
        storageFilename,
        fullPath,
        size: encryptedBuffer.length
    };
}

/**
 * Retrieve an encrypted file buffer from FTP storage by transfer code or filename
 * @param {string} identifier - CID / transfer code or filename
 * @returns {Promise<Buffer>}
 */
async function downloadFromFTP(identifier) {
    if (!identifier) {
        throw new Error('No file identifier provided');
    }

    // Direct path match
    const directPath = path.join(FTP_STORAGE_DIR, identifier);
    if (fs.existsSync(directPath)) {
        return await fs.promises.readFile(directPath);
    }

    // Match by transfer hash (stripping 'ftp-' prefix if present)
    const cleanHash = identifier.replace(/^ftp-/, '');
    const files = await fs.promises.readdir(FTP_STORAGE_DIR);
    const matchedFile = files.find(f => f.includes(cleanHash));

    if (matchedFile) {
        const matchedPath = path.join(FTP_STORAGE_DIR, matchedFile);
        return await fs.promises.readFile(matchedPath);
    }

    throw new Error(`File "${identifier}" not found in FTP storage`);
}

/**
 * Get current FTP status and statistics
 */
async function getFTPStatus() {
    let filesCount = 0;
    let totalStorageBytes = 0;

    try {
        if (fs.existsSync(FTP_STORAGE_DIR)) {
            const files = await fs.promises.readdir(FTP_STORAGE_DIR);
            filesCount = files.length;
            for (const f of files) {
                try {
                    const st = await fs.promises.stat(path.join(FTP_STORAGE_DIR, f));
                    totalStorageBytes += st.size;
                } catch (e) {}
            }
        }
    } catch (err) {}

    return {
        ...ftpStatus,
        filesCount,
        totalStorageBytes,
        protocol: 'FTP (RFC 959)'
    };
}

/**
 * List files stored in FTP storage
 */
async function listFTPFiles() {
    if (!fs.existsSync(FTP_STORAGE_DIR)) return [];
    const names = await fs.promises.readdir(FTP_STORAGE_DIR);
    const list = [];

    for (const name of names) {
        try {
            const st = await fs.promises.stat(path.join(FTP_STORAGE_DIR, name));
            list.push({
                filename: name,
                size: st.size,
                modifiedAt: st.mtime
            });
        } catch (e) {}
    }
    return list;
}

module.exports = {
    FTP_PORT,
    FTP_STORAGE_DIR,
    startFTPServer,
    getFTPStatus,
    uploadToFTP,
    downloadFromFTP,
    listFTPFiles
};
