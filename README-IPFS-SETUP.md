# IPFS Desktop Setup Guide

This project uses **IPFS Desktop** for file storage and sharing.
Every person on the LAN must have IPFS Desktop installed and open before using the app.

---

## Step 1 — Install IPFS Desktop

Go to: https://github.com/ipfs/ipfs-desktop/releases

Download the right installer for your OS:

| OS | File to download |
|----|-----------------|
| Windows | `IPFS-Desktop-Setup-x.x.x.exe` |
| macOS | `IPFS-Desktop-x.x.x.dmg` |
| Linux | `ipfs-desktop-x.x.x-linux-x86_64.AppImage` |

Install it normally (double-click the installer).

---

## Step 2 — Open IPFS Desktop

Launch IPFS Desktop from your Start Menu / Applications folder.

When it starts you will see a **planet/cube icon in your system tray** (bottom-right on Windows, top-right on macOS).

- 🟢 **Green icon** = node is running, you're good to go
- 🟡 **Yellow icon** = node is starting, wait a few seconds
- 🔴 **Red icon** = something went wrong, try restarting IPFS Desktop

---

## Step 3 — Configure CORS (one-time setup, required)

IPFS Desktop's node needs to allow requests from the app.

1. Open IPFS Desktop
2. Click the tray icon → **Settings**
3. Scroll down to **IPFS Config** and click **Edit Config**
4. Find the `"API"` section and make it look like this:

```json
"API": {
  "HTTPHeaders": {
    "Access-Control-Allow-Origin": ["*"],
    "Access-Control-Allow-Methods": ["PUT", "POST", "GET"]
  }
}
```

5. Click **Save** and then **Restart** the node (Settings → Restart)

> ⚡ You only need to do this once per machine.

---

## Step 4 — Start the App Backend

Open a terminal in the project folder and run:

```bash
cd backend
npm install
node server.js
```

Open your browser at: **http://localhost:5000**

The app will show a coloured status bar on the Upload and Download pages:
- 🟢 **IPFS Node Online** — everything is ready
- 🔴 **IPFS Desktop is not running** — open IPFS Desktop first

---

## How File Sharing Works

| Step | What happens |
|------|-------------|
| **Upload** | File is AES-encrypted locally → uploaded to your IPFS Desktop node → real `Qm...` CID returned |
| **Share** | CID + encryption key are shared with peers over LAN chat automatically |
| **Download** | Peer fetches encrypted file from IPFS using the CID → decrypts locally |

Because the file lives on IPFS, **any peer whose IPFS Desktop node has the file can serve it** — not just the original uploader.

---

## Each Person's Checklist

Before using the app, every team member should confirm:

- [ ] IPFS Desktop is installed
- [ ] IPFS Desktop is open (tray icon is green)
- [ ] CORS config has been set (Step 3 above — one time only)
- [ ] Backend server is running (`node server.js`)
- [ ] Connected to the same WiFi network as teammates

---

## Troubleshooting

**"IPFS Desktop is not running"** on the upload/download page
→ Open IPFS Desktop and wait for the green tray icon, then refresh the page.

**File uploads but peer can't download**
→ Make sure the peer also has IPFS Desktop open. IPFS will route the file from your node to theirs automatically.

**CORS error in the browser console**
→ Re-do Step 3. Make sure you saved and restarted the node.

**Port conflict (5001 already in use)**
→ Something else is using port 5001. Restart IPFS Desktop or change `IPFS_API_URL` in `backend/.env`.
