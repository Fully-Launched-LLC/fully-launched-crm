// Owner name from website text (scanner) and the check the Sales UI applies
// to names already stored (older scans guessed things like "throughout the").
// Confident or nothing: the UI shows "Owner: unknown" rather than a guess.
//
// A name is two capitalized parts (optional middle initial), neither a
// common English / business word, found
//   - within the same sentence as, and at most ~40 characters from, a role
//     word: owner, co-owner, founder, co-founder, president, proprietor, CEO,
//     owner/operator, "owned and operated by", "founded by", or
//   - after "My name is" / "I'm" / "I am" when an ownership word (own,
//     owned, owner, owning, founded, founder, started) follows within 400
//     characters (About pages written in the first person).

const NAME_RE = /\b([A-Z][a-z]+(?:\s[A-Z]\.)?\s(?:Mc|Mac|O'|O’|De|Van|Von)?[A-Z][a-z]+(?:-[A-Z][a-z]+)?)\b/g;

const ROLE_RE =
  /\b(?:co-?owners?|owners?(?:\s?\/\s?operators?)?|co-?founders?|founders?|president|proprietors?|ceo|owned\s(?:and|&)\soperated\sby|founded\sby|owned\sby)\b/i;

const FIRST_PERSON_RE = /\b(?:my\sname\sis|i['’]m|i\sam)\s$/i;
const OWNERSHIP_RE = /\b(?:own|owned|owner|owning|founded|founder|started)\b/i;

// Capitalized words that are not names (sentence starts, nav, trades,
// places that show up next to "owner").
const NOT_NAME = new Set(
  (
    "the our we us about contact home call free read learn more your this that these those book get view all click " +
    "service services heating cooling air conditioning plumbing electric electrical roofing hvac company team family " +
    "business inc llc ltd corp co owner owners founder founders president ceo proprietor meet since with and for from " +
    "best quality local today schedule now new old north south east west central great first second best top " +
    "home homes house houses customer customers client clients welcome hello thank thanks why how what when where who " +
    "years year day days month months mr mrs ms dr st ave road street suite floor main " +
    "repair repairs install installation maintenance comfort energy solutions group partners associates " +
    "january february march april may june july august september october november december " +
    "monday tuesday wednesday thursday friday saturday sunday our story mission vision values " +
    "privacy policy terms careers reviews testimonials gallery financing specials offers coupons emergency " +
    "illinois chicago naperville wheaton county city state united states america american"
  ).split(" ")
);

export function plausibleOwnerName(s: string | null | undefined): s is string {
  if (!s) return false;
  const parts = s.trim().split(/\s+/).filter((p) => !/^[A-Z]\.$/.test(p));
  if (parts.length !== 2) return false;
  return parts.every((p) => /^(?:Mc|Mac|O'|O’|De|Van|Von)?[A-Z][a-z]+(?:-[A-Z][a-z]+)?$/.test(p) && !NOT_NAME.has(p.toLowerCase()));
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;|&#8217;/g, "'")
    .replace(/\s+/g, " ");
}

export function findOwnerName(html: string): string | null {
  const text = htmlToText(html);
  let best: { name: string; dist: number } | null = null;
  for (const m of Array.from(text.matchAll(NAME_RE))) {
    const name = m[1];
    if (!plausibleOwnerName(name)) continue;
    const start = m.index ?? 0;
    const end = start + name.length;

    const before = text.slice(Math.max(0, start - 200), start);
    if (FIRST_PERSON_RE.test(before) && OWNERSHIP_RE.test(text.slice(end, end + 400))) return name;

    // Role word in the same sentence, close by, on either side.
    const left = before.slice(-60);
    const leftSentence = left.split(/[.!?]\s/).pop() ?? "";
    const right = text.slice(end, end + 60);
    const rightSentence = right.split(/[.!?]\s/)[0] ?? "";
    const lms = Array.from(leftSentence.matchAll(new RegExp(ROLE_RE.source, "gi")));
    const lm = lms[lms.length - 1];
    const rm = rightSentence.match(ROLE_RE);
    const dl = lm ? leftSentence.length - ((lm.index ?? 0) + lm[0].length) : Infinity;
    const dr = rm ? rm.index ?? 0 : Infinity;
    const dist = Math.min(dl, dr);
    if (dist <= 40 && (!best || dist < best.dist)) best = { name, dist };
  }
  return best?.name ?? null;
}
