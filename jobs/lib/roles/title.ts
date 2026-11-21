/**
 * The one title writer: generated text that is not yet an issue title (a worker's
 * `FOLLOWUP:` line, a lesson, a landing's manual check) is cut to a title mechanically, with no model call.
 */

const TITLE = 60;

/** The source with each leading `<words>: ` removed, cut to `max` characters at a word boundary, with no final period. */
export function cutTitle(source: string, max = TITLE): string {
  let t = source.trim();
  for (let m = /^[^:]*: /.exec(t); m; m = /^[^:]*: /.exec(t)) t = t.slice(m[0].length).trim();
  t = t.replace(/: /g, " ");
  if (t.length > max) {
    const head = t.slice(0, max + 1);
    const i = head.lastIndexOf(" ");
    t = (i > 0 ? head.slice(0, i) : head.slice(0, max)).trim();
  }
  return t.replace(/[.\s]+$/, "");
}

/** `group` and `cutTitle(rest)` in the room `group` leaves. */
export const fit = async (group: string, rest: string): Promise<string> => group + cutTitle(rest, TITLE - group.length);
