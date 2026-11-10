/** A transition said no: the message is what `aleph` prints on stderr before it exits 1. It imports nothing, so the UI and the store can catch it without the transitions. */
export class Refusal extends Error {}
export function refuse(msg: string): never { throw new Refusal(msg); }
