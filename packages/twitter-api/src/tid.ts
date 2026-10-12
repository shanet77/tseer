import { createHash } from "node:crypto";

const DEFAULT_KEYWORD = "obfiowerehiring";
const PAIRS_URL =
  "https://raw.githubusercontent.com/fa0311/x-client-transaction-id-pair-dict/refs/heads/main/pair.json";
const TTL_SEC = 60 * 60;
const TID_EPOCH = 1682924400;

export interface TidPair {
  animationKey: string;
  verification: string;
}

export function parseTidPairs(raw: string): TidPair[] {
  const fail = (): never => {
    throw new Error(`Parsing pairs failed: ${raw}`);
  };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fail();
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return fail();
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) return fail();
    const { animationKey, verification } = entry as Record<string, unknown>;
    if (typeof animationKey !== "string" || typeof verification !== "string") return fail();
  }
  return parsed as TidPair[];
}

export interface TidGeneratorOptions {
  fetchPairs?: ((url: string) => Promise<string | undefined>) | undefined;
  now?: (() => number) | undefined;
  random?: (() => number) | undefined;
  ttlSec?: number | undefined;
}

export interface TidGenerator {
  genTid(path: string): Promise<string>;
}

const defaultFetchPairs = async (url: string): Promise<string | undefined> => {
  const response = await fetch(url);
  if (response.status !== 200) return undefined;
  return response.text();
};

export function createTidGenerator(options: TidGeneratorOptions = {}): TidGenerator {
  const fetchPairs = options.fetchPairs ?? defaultFetchPairs;
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));
  const random = options.random ?? Math.random;
  const ttlSec = options.ttlSec ?? TTL_SEC;

  let cachedPairs: TidPair[] = [];
  let lastCached = 0;

  async function getPair(): Promise<TidPair> {
    if (cachedPairs.length === 0 || now() - lastCached > ttlSec) {
      const body = await fetchPairs(PAIRS_URL);
      if (body !== undefined) {
        cachedPairs = parseTidPairs(body);
        lastCached = now();
      }
    }
    if (cachedPairs.length === 0) {
      throw new Error("Failed to fetch x-client-transaction-id pairs");
    }
    return cachedPairs[Math.floor(random() * cachedPairs.length)] as TidPair;
  }

  return {
    async genTid(path: string): Promise<string> {
      const pair = await getPair();
      const timeNow = now() - TID_EPOCH;

      const timeBytes = Buffer.alloc(4);
      timeBytes.writeUInt32LE(timeNow >>> 0, 0);

      const data = `GET!${path}!${timeNow}${DEFAULT_KEYWORD}${pair.animationKey}`;
      const hash = createHash("sha256").update(data, "utf8").digest();

      const keyBytes = Buffer.from(pair.verification, "base64");
      const bytes = Buffer.concat([keyBytes, timeBytes, hash.subarray(0, 16), Buffer.from([3])]);

      const randomNum = Math.floor(random() * 256);
      const out = Buffer.alloc(bytes.length + 1);
      out[0] = randomNum;
      for (let i = 0; i < bytes.length; i++) out[i + 1] = (bytes[i] as number) ^ randomNum;

      return out.toString("base64").replaceAll("=", "");
    },
  };
}
