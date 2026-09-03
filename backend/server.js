// ================= LOAD ENV =================
require('dotenv').config();

// ================= IMPORTS =================
const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const { Server } = require('socket.io');

const db = require('./database.js');
const { startFTPServer, getFTPStatus, FTP_PORT } = require('./config/ftp.js');
const discovery = require('./lan-discovery');

// ----- ROUTES -----
const authRoutes = require('./auth/auth.routes.js');
const fileRoutes = require('./files/files.routes.js');
const initSocket = require('./chat/socket.js');

// ================= APP =================
const app = express();

// ================= MIDDLEWARE =================
app.use(cors({
    origin: "*",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ================= SERVE FRONTEND =================
app.use(express.static(path.join(__dirname, '../frontend')));

// ================= API ROUTES =================
app.use('/api/auth', authRoutes);
app.use('/api/files', fileRoutes);

// ================= TEST =================
app.get('/api/test', (req, res) => {
    res.json({ message: "Backend + FTP Storage API Working!" });
});

// =====================================================
// 📊 DASHBOARD STATS API
// =====================================================
app.get("/api/files/stats", (req, res) => {
    db.get("SELECT COUNT(*) as totalFiles FROM files", (err, fileRow) => {
        db.get("SELECT COUNT(*) as totalUsers FROM users", (err, userRow) => {
            db.get("SELECT SUM(size) as totalSize FROM files", (err, sizeRow) => {
                res.json({
                    totalFiles: fileRow ? fileRow.totalFiles : 0,
                    totalUsers: userRow ? userRow.totalUsers : 0,
                    totalSize: sizeRow && sizeRow.totalSize ? sizeRow.totalSize : 0,
                    networkStatus: "Online"
                });
            });
        });
    });
});

// =====================================================
// 📂 FILE HISTORY API
// =====================================================
app.get("/api/files/history", (req, res) => {
    db.all(
        "SELECT filename, size, uploadedAt as createdAt FROM files ORDER BY uploadedAt DESC LIMIT 10",
        [],
        (err, rows) => {
            if (err) return res.status(500).json({ error: "Database error" });
            res.json({ history: rows || [] });
        }
    );
});

// =====================================================
// 🔗 TRANSACTIONS (BLOCKCHAIN LEDGER)
// =====================================================
app.get("/api/files/transactions", (req, res) => {
    db.all(
        "SELECT * FROM blocks ORDER BY id DESC LIMIT 10",
        [],
        (err, rows) => {
            if (err) return res.status(500).json({ error: "Database error" });
            res.json({ transactions: rows || [] });
        }
    );
});

// =====================================================
// 👥 ACTIVE PEERS — from LAN discovery
// =====================================================
app.get("/api/files/peers", (req, res) => {
    const peers = discovery.getActivePeers().map(p => ({
        id: p.userId,
        username: p.username,
        ip: p.ip,
        port: p.port,
        ftpPort: p.ftpPort || FTP_PORT
    }));
    res.json({ peers });
});

// =====================================================
// 🌐 MY SERVER INFO (so frontend knows own IP)
// =====================================================
app.get("/api/my-info", (req, res) => {
    const info = discovery.getMyInfo();
    res.json({
        ...info,
        ftpPort: FTP_PORT
    });
});

// =====================================================
// 💬 CHAT RELAY ENDPOINT
// =====================================================
app.post("/api/chat/relay", (req, res) => {
    const data = req.body;
    if (!data || !data.toUserId) {
        return res.status(400).json({ error: "Missing toUserId" });
    }
    const delivered = socketHandler.relayMessage(data);
    if (delivered) {
        res.json({ success: true });
    } else {
        res.json({ success: false, warning: "User not found by userId, broadcast attempted" });
    }
});

// =====================================================
// 👤 USER ACTIVITY
// =====================================================
app.get("/api/user-activity/:userId", (req, res) => {
    const userId = req.params.userId;
    const result = {};

    db.all(
        "SELECT filename, cid, size, encryptionKey as key, uploadedAt FROM files WHERE userId=? ORDER BY uploadedAt DESC",
        [userId],
        (err, files) => {
            if (err) return res.status(500).json({ error: "Database error" });
            result.files = files || [];

            db.get(
                "SELECT SUM(size) as total FROM files WHERE userId=?",
                [userId],
                (err, sizeRow) => {
                    result.totalSize = sizeRow?.total || 0;

                    db.all(
                        "SELECT * FROM blocks ORDER BY id DESC LIMIT 10",
                        (err, blocks) => {
                            result.transactions = blocks || [];
                            res.json(result);
                        }
                    );
                }
            );
        }
    );
});

// =====================================================
// 📂 MY FILES (for file code sharing in chat)
// =====================================================
app.get("/api/files/my-files", (req, res) => {
    const authHeader = req.headers["authorization"];
    let userId = 1;

    if (authHeader) {
        try {
            const token = authHeader.split(" ")[1];
            const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
            userId = payload.id;
        } catch(e) {}
    }

    db.all(
        "SELECT filename, cid, size, encryptionKey as key, uploadedAt FROM files WHERE userId=? ORDER BY uploadedAt DESC",
        [userId],
        (err, rows) => {
            if (err) return res.status(500).json({ error: "Database error" });
            res.json({ files: rows || [] });
        }
    );
});

// =====================================================
// 📁 FTP SERVER STATUS
// =====================================================
app.get("/api/ftp-status", async (req, res) => {
    const status = await getFTPStatus();
    res.json(status);
});

// Backward-compatible alias for cached clients
app.get("/api/ipfs-status", async (req, res) => {
    const status = await getFTPStatus();
    res.json({
        online: status.online,
        version: "Traditional FTP Server (Port " + status.port + ")"
    });
});

// ================= SOCKET.IO =================
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const socketHandler = initSocket(io);

// ================= START SERVER =================
const PORT = 3000;

server.listen(PORT, "0.0.0.0", () => {
    console.log("===========================================");
    console.log("🚀 Secure LAN File Share Server Started");
    console.log("🌐 Server listening on 0.0.0.0:" + PORT);
    console.log("📡 Socket.IO + Auth + Upload + LAN Discovery Ready");
    console.log("===========================================");

    // Start traditional FTP server
    startFTPServer().then(status => {
        if (status.online) {
            console.log("✅ Traditional FTP Server online on port " + status.port);
            console.log("   Storage Root: " + status.storageDir);
        } else {
            console.warn("⚠️ FTP listener not active: " + (status.error || "Port unavailable"));
            console.warn("   Web-based storage is fully operational.");
        }
    }).catch(err => {
        console.warn("FTP Server startup notice:", err.message);
    });

    // Start LAN UDP peer discovery
    discovery.start({
        port: PORT,
        ftpPort: FTP_PORT,
        username: "Server",
        userId: "server"
    });
});

module.exports = { app, server };
