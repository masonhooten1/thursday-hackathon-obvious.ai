/**
 * StayRadar API contracts — the single source of truth for every wire shape
 * (spec art_XasJ5Kw8). TS types are inferred from the zod schemas; route
 * handlers and services never hand-roll their own shapes.
 */
export * from "./error";
export * from "./lead";
export * from "./property";
export * from "./search";
export * from "./shared";
