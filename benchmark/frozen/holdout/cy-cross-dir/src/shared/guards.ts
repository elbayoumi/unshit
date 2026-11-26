import { place } from '../features/orders/service';
export const allow = (scope: string): string => scope + place();
