// The pieces every agent call shares: the shell quote and the model ids.

export const q = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

export const OPUS_MODEL = "claude-opus-5-5";
/** The director's model (director.ts). */
