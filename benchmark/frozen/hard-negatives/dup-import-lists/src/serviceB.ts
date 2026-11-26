import { a, b, c, d, e, f, g, h } from './deps';
function serviceB(x) { return x ? c(x) : d(x); }
console.log(serviceB(1));
