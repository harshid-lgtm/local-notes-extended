#!/usr/bin/env node
// Browser mode: `npm start` runs the vault server and opens the UI in your browser.
'use strict';

const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const { createVaultServer } = require('./core');

const args = process.argv.slice(2);
const port = Number(args[args.indexOf('--port') + 1]) || Number(process.env.LOCAL_NOTES_PORT) || 4321;
const configDir = process.env.LOCAL_NOTES_CONFIG
  || path.join(process.env.APPDATA || process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'local-notes');

const { server } = createVaultServer({ configDir, publicDir: path.join(__dirname, '..', 'public') });
server.listen(port, '127.0.0.1', () => {
  const url = `http://localhost:${port}`;
  console.log(`\n  Local Notes is running at ${url}\n  Press Ctrl+C to stop.\n`);
  if (!args.includes('--no-open')) {
    const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
    exec(cmd, () => {});
  }
});
