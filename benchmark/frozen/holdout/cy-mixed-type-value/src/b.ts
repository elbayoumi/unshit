import { config } from './a';
import type { Config } from './a';
export type { Config };
export const read = (): Config => ({ enabled: Boolean(config) });
