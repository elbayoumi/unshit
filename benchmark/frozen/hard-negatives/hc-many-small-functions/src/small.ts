function add(a: number, b: number): number { return a + b; }
function sub(a: number, b: number): number { return a - b; }
function mul(a: number, b: number): number { return a * b; }
function div(a: number, b: number): number { return a / b; }
function mod(a: number, b: number): number { return a % b; }
function neg(a: number): number { return -a; }
function abs(a: number): number { return a < 0 ? -a : a; }
function clamp(x: number): number { return x > 1 ? 1 : 0; }
console.log(add(1, sub(2, mul(3, div(4, mod(5, 2))))), neg(1), abs(-2), clamp(3));
