export const a = 1;
export function loadB(): Promise<unknown> { return import('./b'); }
