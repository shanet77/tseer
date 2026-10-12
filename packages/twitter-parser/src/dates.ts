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

export function fromUnixSeconds(seconds: number): string {
  if (seconds <= 0) return "";
  return new Date(seconds * 1000).toISOString();
}

export function fromUnixMilliseconds(ms: number): string {
  if (ms <= 0) return "";
  return new Date(ms).toISOString();
}
