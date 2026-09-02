/**
 * chat.js — Full LAN peer-to-peer chat.
 *
 * Messages are sent via Socket.IO to the local server, which relays
 * them via HTTP POST to the target peer's server, which then pushes
 * them to the recipient's browser via Socket.IO.
 *
 * CID sharing works the same way — the CID is sent as a special
 * message type that renders as a downloadable file card.
 */
document.addEventListener("DOMContentLoaded", () => {

    const socket = window.GlobalSocket.getSocket();
    const myUserId = window.GlobalSocket.getUserId();

    const peerListEl = document.getElementById("peer-list");
    const noPeers = document.getElementById("no-peers");
    const startBtn = document.getElementById("start-chat");
    const sendBtn = document.getElementById("send-btn");
    const shareCidBtn = document.getElementById("share-cid-btn");
    const input = document.getElementById("chat-input");
    const chatMessages = document.getElementById("chat-messages");
    const chatHeader = document.getElementById("chat-header");
    const cidModal = document.getElementById("cid-modal");
    const cidList = document.getElementById("cid-list");
    const closeCidModal = document.getElementById("close-cid-modal");
    const connectionStatus = document.getElementById("connection-status");

    let selectedPeer = null; // { userId, username, ip, port }

    // ===== Restore peer from localStorage (coming from peers.html) =====
    const savedPeerId   = localStorage.getItem("chatPeer");
    const savedPeerName = localStorage.getItem("chatPeerName");
    const savedPeerIp   = localStorage.getItem("chatPeerIp");
    const savedPeerPort = localStorage.getItem("chatPeerPort");

    if (savedPeerId && savedPeerName) {
        // Pre-select and activate chat immediately
        selectedPeer = {
            userId: savedPeerId,
            username: savedPeerName,
            ip: savedPeerIp,
            port: parseInt(savedPeerPort) || 5000
        };
        activateChat(selectedPeer);
        localStorage.removeItem("chatPeer");
        localStorage.removeItem("chatPeerName");
        localStorage.removeItem("chatPeerIp");
        localStorage.removeItem("chatPeerPort");
    }

    // ===== Message Rendering =====
    function addMessage(text, sender, sent, type, filename) {
        const wrapper = document.createElement("div");
        wrapper.className = "flex " + (sent ? "justify-end" : "justify-start") + " mb-3";

        const bubble = document.createElement("div");
        bubble.className = "message-bubble " + (sent ? "sent" : "received");

        if (type === "cid") {
            // Use our own server download API — it handles decryption automatically
            const downloadUrl = "download.html?cid=" + encodeURIComponent(text);
            bubble.innerHTML = `
                <p class="text-xs font-semibold opacity-70 mb-1">${sender}</p>
                <div class="cid-card">
                    <div class="flex items-center gap-2 mb-2">
                        <svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                        </svg>
                        <span class="font-semibold text-sm">${filename || 'Shared File'}</span>
                    </div>
                    <p class="text-xs opacity-70 mb-2 font-mono break-all">CID: ${text}</p>
                    <a href="${downloadUrl}"
                        class="inline-flex items-center gap-1 bg-blue-500 hover:bg-blue-600 text-white text-xs font-semibold px-3 py-1.5 rounded-md transition-colors">
                        📥 Download File
                    </a>
                    <p class="text-xs opacity-50 mt-1">Click to decrypt &amp; download</p>
                </div>`;
        } else {
            bubble.innerHTML = `<p class="text-xs font-semibold opacity-70 mb-1">${sender}</p><p>${text}</p>`;
        }

        wrapper.appendChild(bubble);
        chatMessages.appendChild(wrapper);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    function addSystemMessage(text) {
        const div = document.createElement("div");
        div.className = "text-center text-gray-400 text-xs my-3 flex items-center gap-2 justify-center";
        div.innerHTML = `<span class="border-t border-gray-200 flex-1"></span><span>${text}</span><span class="border-t border-gray-200 flex-1"></span>`;
        chatMessages.appendChild(div);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    function activateChat(peer) {
        selectedPeer = peer;
        if (chatHeader) chatHeader.textContent = peer.username;
        if (connectionStatus) connectionStatus.textContent = peer.ip + ":" + peer.port;

        const avatar = document.getElementById("peer-avatar");
        if (avatar) avatar.textContent = peer.username.charAt(0).toUpperCase();

        const badge = document.getElementById("online-badge");
        if (badge) badge.classList.remove("hidden");

        sendBtn.disabled = false;
        shareCidBtn.disabled = false;
        input.disabled = false;
        input.focus();
        addSystemMessage("💬 Chatting with " + peer.username + " · " + peer.ip + ":" + peer.port);
    }

    // ===== Peer List (from Socket.IO lan-peers event) =====
    function renderPeerList(peers) {
        peerListEl.innerHTML = "";

        // Filter out self
        const filtered = peers.filter(p => String(p.userId) !== String(myUserId));

        if (filtered.length === 0) {
            if (noPeers) noPeers.style.display = "block";
            startBtn.disabled = true;
            return;
        }
        if (noPeers) noPeers.style.display = "none";

        filtered.forEach(peer => {
            const div = document.createElement("div");
            div.className = "peer-item";
            div.dataset.peerId = peer.userId;
            div.innerHTML = `
                <div class="flex items-center gap-2">
                    <div class="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-sm flex-shrink-0">
                        ${peer.username.charAt(0).toUpperCase()}
                    </div>
                    <div>
                        <p class="font-semibold text-sm">${peer.username}</p>
                        <p class="text-green-500 text-xs flex items-center gap-1">
                            <span class="w-1.5 h-1.5 bg-green-500 rounded-full inline-block animate-pulse"></span>
                            Online · <span class="font-mono text-xs text-gray-400">${peer.ip}</span>
                        </p>
                    </div>
                </div>`;

            div.onclick = () => {
                document.querySelectorAll(".peer-item").forEach(p => p.classList.remove("selected"));
                div.classList.add("selected");
                startBtn.disabled = false;
                // Store pending selection
                startBtn._pendingPeer = {
                    userId: peer.userId,
                    username: peer.username,
                    ip: peer.ip,
                    port: peer.port
                };
            };

            peerListEl.appendChild(div);

            // Auto-select if this peer matches our saved selection
            if (selectedPeer && String(peer.userId) === String(selectedPeer.userId)) {
                div.classList.add("selected");
            }
        });
    }

    socket.on("lan-peers", (peers) => {
        renderPeerList(peers);
    });

    // Also poll as fallback
    async function pollPeers() {
        try {
            const res = await fetch("/api/files/peers");
            const data = await res.json();
            renderPeerList(data.peers || []);
        } catch (e) {}
    }
    pollPeers();
    setInterval(pollPeers, 5000);

    // ===== Start Chat button =====
    startBtn.onclick = () => {
        const peer = startBtn._pendingPeer;
        if (!peer) return;
        activateChat(peer);
        startBtn.disabled = true;
    };

    // ===== Send text =====
    sendBtn.onclick = sendMessage;
    input.onkeydown = (e) => { if (e.key === "Enter") sendMessage(); };

    function sendMessage() {
        if (!selectedPeer) { showToast("Select a peer first"); return; }
        const msg = input.value.trim();
        if (!msg) return;

        socket.emit("send-message", {
            toPeerIp: selectedPeer.ip,
            toPeerPort: selectedPeer.port,
            toUserId: selectedPeer.userId,
            message: msg
        });

        addMessage(msg, "You", true, "text");
        input.value = "";
    }

    // ===== Receive message =====
    socket.on("receive-message", async (data) => {
        addMessage(data.message, data.from, false, data.type || "text", data.filename);

        // If it is a CID share, auto-register into our local DB so we can download it
        if (data.type === "cid" && data.message && data.key) {
            try {
                const token = localStorage.getItem("token");
                await fetch("/api/files/register-cid", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": "Bearer " + token
                    },
                    body: JSON.stringify({
                        cid:       data.message,
                        storageId: data.storageId || "",
                        key:       data.key,
                        filename:  data.filename || "shared-file",
                        size:      data.size || 0,
                        ownerIp:   data.ownerIp   || data.fromIp   || "",  // ← FIX: use fromIp as fallback
                        ownerPort: data.ownerPort || data.fromPort || 5000 // ← FIX: use fromPort as fallback
                    })
                });
                console.log("[Chat] CID auto-registered:", data.message, "owner:", data.ownerIp || data.fromIp);
            } catch(e) {
                console.warn("[Chat] Could not auto-register CID:", e.message);
            }
        }
    });

    // ===== Relay errors =====
    socket.on("relay-error", (data) => {
        showToast("⚠️ " + data.message, true);
    });

    // ===== Share CID Modal =====
    shareCidBtn.onclick = async () => {
        if (!selectedPeer) { showToast("Select a peer first"); return; }
        cidList.innerHTML = "<p class='text-gray-500 text-sm text-center py-4'>Loading your files...</p>";
        cidModal.classList.remove("hidden");

        try {
            const token = localStorage.getItem("token");
            const res = await fetch("/api/files/my-files", {
                headers: { Authorization: "Bearer " + token }
            });
            const data = await res.json();
            const files = data.files || [];

            if (files.length === 0) {
                cidList.innerHTML = "<p class='text-gray-400 text-sm text-center py-8'>No uploaded files found.<br>Upload a file first using the Upload page.</p>";
                return;
            }

            cidList.innerHTML = "";
            files.forEach(file => {
                const btn = document.createElement("button");
                btn.className = "cid-file-btn w-full text-left p-3 rounded-lg border border-gray-200 hover:border-blue-400 hover:bg-blue-50 transition-all flex items-center gap-3";
                btn.innerHTML = `
                    <div class="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                        <svg class="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                        </svg>
                    </div>
                    <div class="overflow-hidden flex-1">
                        <p class="font-semibold text-sm text-gray-800 truncate">${file.filename}</p>
                        <p class="text-xs text-gray-400 font-mono truncate">CID: ${file.cid}</p>
                        <p class="text-xs text-gray-400">${formatBytes(file.size)}</p>
                    </div>
                    <svg class="w-4 h-4 text-blue-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
                    </svg>`;
                btn.onclick = () => shareCid(file.cid, file.filename, file.key || "", file.size || 0, file.storageId || "");
                cidList.appendChild(btn);
            });
        } catch (e) {
            cidList.innerHTML = "<p class='text-red-400 text-sm text-center py-4'>Failed to load files.</p>";
        }
    };

    closeCidModal.onclick = () => cidModal.classList.add("hidden");
    cidModal.onclick = (e) => { if (e.target === cidModal) cidModal.classList.add("hidden"); };

    function shareCid(cid, filename, key, size, storageId) {
        if (!selectedPeer) return;
        socket.emit("send-cid", {
            toPeerIp:  selectedPeer.ip,
            toPeerPort: selectedPeer.port,
            toUserId:  selectedPeer.userId,
            cid,
            storageId,   // disk UUID — peer needs this to fetch the raw file
            filename,
            key,         // encryption key — peer needs this to decrypt
            size
        });
        addMessage(cid, "You", true, "cid", filename);
        cidModal.classList.add("hidden");
    }

    // ===== Helpers =====
    function formatBytes(bytes) {
        if (!bytes) return "Unknown size";
        if (bytes < 1024) return bytes + " B";
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
        return (bytes / (1024 * 1024)).toFixed(1) + " MB";
    }

    function showToast(msg, isError) {
        const toast = document.createElement("div");
        toast.className = "fixed bottom-6 right-6 px-4 py-3 rounded-lg text-white text-sm font-medium shadow-lg z-50 transition-all " +
            (isError ? "bg-red-500" : "bg-gray-800");
        toast.textContent = msg;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }
});
