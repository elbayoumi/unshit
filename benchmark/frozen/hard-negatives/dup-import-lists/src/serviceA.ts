import { a, b, c, d, e, f, g, h } from './deps';
function serviceA(x) { if (x) return a(x); return b(x); }
console.log(serviceA(1));
