const anyValue = 1;
type AnyPayload = { id: number };
const payload: AnyPayload = { id: anyValue };
console.log(payload);
