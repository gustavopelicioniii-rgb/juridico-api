/**
 * Root entry point - redirects to minha-api
 */
const { spawn } = require('child_process');
const path = require('path');

const args = process.argv.slice(2);
const scriptPath = path.join(__dirname, 'minha-api', 'dist', 'server.js');

const child = spawn('node', [scriptPath, ...args], {
  cwd: path.join(__dirname, 'minha-api'),
  stdio: 'inherit'
});

child.on('exit', (code) => {
  process.exit(code);
});
