'use strict';
const fs = require('fs');
const path = require('path');

const entry = `'use strict';\nrequire('./app').startServer();\n`;
const dest = path.join(__dirname, '..', 'dist', 'server.js');
fs.writeFileSync(dest, entry);
console.log('dist/server.js written');
