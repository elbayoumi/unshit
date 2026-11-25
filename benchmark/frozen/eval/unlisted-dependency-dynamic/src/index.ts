import a from 'listed-pkg';
async function load() { const m = await import('dynamic-unlisted'); return m; }
const r = require('required-unlisted');
console.log(a, load, r);
