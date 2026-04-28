// Simple launcher to start the API server
// Avoids yargs issues by directly requiring the built app

const path = require('path');

// Set environment variables
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
process.env.PORT = process.env.PORT || '3002';

// Change to the dist directory and require the app
const appPath = path.join(__dirname, 'dist', 'app.js');
console.log('Loading app from:', appPath);

// Clear module cache to ensure fresh load
delete require.cache[require.resolve(appPath)];

const { startServer } = require(appPath);

// Start the server
startServer();
