// After changing any game file, run:  node tools/bump-version.js
// It raises the ?v=N number on the script/style links in index.html, so browsers (and GitHub Pages' cache)
// load the new files instead of old copies.
const fs = require('fs'), path = require('path');
const p = path.join(__dirname, '..', 'index.html');
let s = fs.readFileSync(p, 'utf8');
const m = s.match(/\?v=(\d+)/);
const next = (m ? +m[1] : 0) + 1;
s = s.replace(/(src="js\/[a-z]+\.js|href="css\/style\.css)(\?v=\d+)?"/g, `$1?v=${next}"`);
fs.writeFileSync(p, s);
console.log('index.html now uses ?v=' + next);
