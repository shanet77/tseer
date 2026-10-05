/**
 * Date parsing — the port of `parserutils.nim`'s `getTime`/`getDateTime`/
 * `getTimeFromMs`/`getTimeFromMsStr` and `experimental/parser/utils.nim`'s
 * `parseTwitterDate`/`parseIsoDate`.
 *
 * The TS domain type is an ISO 8601 UTC string (`@tseer/types` `DateTime`),
 * so every failure mode — field absent, wrong length, unparseable — becomes
 * the empty string ("not set"), which is what Nim's zero-value `DateTime`
 * encodes for the cache/JSON seam.
 */

const TWITTER_DATE =
  /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{2}) (\d{2}):(\d{2}):(\d{2}) \+0000 (\d{4})$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;

const MONTHS = new Map(
  ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map(
    (name, index) => [name, index],
  ),
);

function isoUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): string {
  return new Date(Date.UTC(year, month, day, hour, minute, second)).toISOString();
}

/** Port of `parseTwitterDate` / parserutils' `getTime` (the `"ddd MMM dd hh:mm:ss '+0000' yyyy"` format). */
export function parseTwitterDate(date: string): string {
  const match = TWITTER_DATE.exec(date);
  if (match === null) return "";
  const month = MONTHS.get(match[2] as string);
  if (month === undefined) return "";
  return isoUtc(
    Number(match[7]),
    month,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  );
}

/** Port of `parseIsoDate` / parserutils' `getDateTime` (`yyyy-MM-dd'T'HH:mm:ss'Z'`). */
export function parseIsoDate(date: string): string {
  const match = ISO_DATE.exec(date);
  if (match === null) return "";
  return new Date(
    Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6]),
    ),
  ).toISOString();
}

/** Unix seconds → ISO 8601 (article `first_published_at_secs`); non-positive → `""`. */
export function fromUnixSeconds(seconds: number): string {
  if (seconds <= 0) return "";
  return new Date(seconds * 1000).toISOString();
}

/** Unix *milliseconds* → ISO 8601; non-positive → `""`. */
export function fromUnixMilliseconds(ms: number): string {
  if (ms <= 0) return "";
  return new Date(ms).toISOString();
}
