declare type Deep<T> = T extends string ? string : T extends number ? number : T extends boolean ? boolean : T extends object ? object : never;
declare type Other<T> = T extends { a: infer A } ? A : T extends { b: infer B } ? B : T extends Array<infer C> ? C : T extends Map<infer D, infer E> ? [D, E] : never;
declare function overloaded(x: string): string;
declare function overloaded(x: number): number;
declare function overloaded(x: boolean): boolean;
