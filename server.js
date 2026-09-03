/**
 * Secure LAN File Sharing System - Main Server Entry Point
 *
 * Runs Express HTTP server (serving the frontend UI and REST API)
 * and the traditional FTP server (for direct FTP client file transfers).
 */

require('./backend/server.js');
