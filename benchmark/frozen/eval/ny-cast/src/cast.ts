const raw: unknown = getValue();
const value = raw as any;
console.log(value);
declare function getValue(): unknown;
