// Loads the engine source files into one shared scope (the same way the page bundle does)
// and returns the requested top-level names.
const fs = require('fs');
const path = require('path');
const ENGINE_FILES = require('../engine-files.js');

module.exports = function load(names) {
  const dir = path.join(__dirname, '..', 'src');
  const src = ENGINE_FILES
    .filter(function (f) { return fs.existsSync(path.join(dir, f)); })
    .map(function (f) { return fs.readFileSync(path.join(dir, f), 'utf8'); })
    .join('\n;\n');
  return new Function("'use strict';\n" + src + '\nreturn {' + names.join(',') + '};')();
};
