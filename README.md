# Secure LAN File Sharing System (Traditional FTP)

A fast, encrypted, local-area-network (LAN) file-sharing platform powered by a built-in **Traditional RFC 959 FTP Server**, Express REST API, Socket.IO real-time peer messaging, and AES-256 client/server encryption.

## 🚀 Quick Start

### 1. Installation
Install all dependencies with a single command:
```bash
npm install
```

### 2. Start the Server
Launch the application:
```bash
node server.js
```

The system will start both services automatically:
- **Web Application & REST API**: `http://localhost:3000`
- **Traditional FTP Server**: `ftp://0.0.0.0:2121`
- **UDP Peer Discovery**: Automatically scans and broadcasts to devices on the same LAN WiFi.

---

## 📁 Traditional FTP Access

The built-in FTP server stores files in the `./ftp_storage/` folder. You can connect using any standard FTP client:

### FileZilla / Cyberduck / WinSCP:
- **Host**: Your local LAN IP (e.g. `192.168.1.50` or `127.0.0.1`)
- **Port**: `2121`
- **Protocol**: FTP (Plain / Standard)
- **Logon Type**: Anonymous (or use registered user credentials)

### Command Line FTP:
```bash
ftp 127.0.0.1 2121
# User: anonymous
# Password: [Enter]
```

### cURL:
```bash
# List files:
curl ftp://127.0.0.1:2121/

# Download a file:
curl -O ftp://127.0.0.1:2121/<filename>
```

---

## 🔒 Security & Architecture

1. **AES-256 File Encryption**: Files uploaded through the Web UI are encrypted with a random cryptographic key before being saved into the FTP storage.
2. **Transfer Codes**: Each upload generates a unique transfer code (e.g., `ftp-a1b2c3d4...`) and encryption key.
3. **LAN Peer Discovery**: Peers automatically discover each other using lightweight UDP broadcasts.
4. **Decentralized Ledger**: File uploads and downloads are logged to an immutable SQLite blockchain block audit trail.
5. **Real-time Peer Chat**: Share file transfer codes and chat with peers without internet access.
