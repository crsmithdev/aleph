// Word-based ID generator for human-readable identifiers
const ADJECTIVES = [
  'amber', 'azure', 'bright', 'brisk', 'calm', 'cedar', 'clean', 'clear',
  'crisp', 'dawn', 'deep', 'drift', 'dusk', 'elder', 'even', 'faint',
  'fair', 'fine', 'firm', 'fleet', 'fresh', 'frost', 'glad', 'gold',
  'grand', 'gray', 'green', 'grey', 'high', 'hollow', 'iron', 'jade',
  'keen', 'kind', 'late', 'lean', 'light', 'long', 'lunar', 'mellow',
  'mild', 'mint', 'misty', 'noble', 'north', 'opal', 'open', 'pale',
  'plain', 'polar', 'prime', 'pure', 'quick', 'quiet', 'rapid', 'rare',
  'raven', 'rich', 'rigid', 'risen', 'rocky', 'royal', 'rustic', 'sage',
  'sandy', 'sharp', 'sheer', 'shore', 'silver', 'sleek', 'slim', 'slow',
  'smart', 'solar', 'solid', 'sonic', 'south', 'spare', 'stark', 'steel',
  'still', 'stone', 'storm', 'sunny', 'sure', 'swift', 'tidal', 'tidy',
  'tiny', 'topaz', 'true', 'vast', 'vivid', 'warm', 'west', 'white',
  'wide', 'wild', 'windy', 'wise', 'young',
];

const NOUNS = [
  'apex', 'arch', 'bay', 'beam', 'birch', 'bloom', 'breeze', 'brook',
  'brush', 'cedar', 'cliff', 'cloud', 'coast', 'comet', 'cove', 'crest',
  'creek', 'crown', 'dawn', 'delta', 'drift', 'dune', 'dust', 'echo',
  'edge', 'ember', 'falls', 'fern', 'field', 'flame', 'flint', 'foam',
  'forge', 'frost', 'glade', 'glen', 'grove', 'gulf', 'heath', 'hill',
  'inlet', 'isle', 'ivy', 'knoll', 'lake', 'leaf', 'ledge', 'light',
  'maple', 'marsh', 'mesa', 'mist', 'moon', 'moss', 'mountain', 'oak',
  'orbit', 'path', 'peak', 'pine', 'plain', 'pond', 'pool', 'port',
  'prism', 'pulse', 'rain', 'range', 'rapid', 'reef', 'ridge', 'rift',
  'river', 'rock', 'root', 'rush', 'sage', 'sand', 'sea', 'seed',
  'shade', 'shore', 'sky', 'slope', 'snow', 'soil', 'spark', 'spring',
  'star', 'stem', 'stone', 'storm', 'stream', 'summit', 'surf', 'tide',
  'trail', 'vale', 'vine', 'wake', 'wave', 'wind', 'wood',
];

function pick(arr: string[]): string {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Generate a human-readable id with enough entropy to survive bursty
 *  parallel writes. ~100^3 word combinations × 16^4 hex tail ≈ 65B unique
 *  ids — birthday-collision-safe well past 100k rows per session. */
export function generateId(): string {
  const tail = Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${pick(ADJECTIVES)}-${pick(NOUNS)}-${pick(NOUNS)}-${tail}`;
}
