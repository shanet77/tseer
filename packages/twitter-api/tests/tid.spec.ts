import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createTidGenerator, parseTidPairs } from "../src/tid.ts";

const KEYWORD = "obfiowerehiring";
const TID_EPOCH = 1682924400;
const PAIR = {
  animationKey: "animation-key-1",
  verification: Buffer.from([9, 8, 7, 6, 5, 4, 3, 2, 1]).toString("base64"),
};
const SECOND_PAIR = { animationKey: "animation-key-2", verification: PAIR.verification };

function pairsBody(pairs: unknown[]): string {
  return JSON.stringify(pairs);
}

describe("parseTidPairs", () => {
  it("parses a non-empty pair array", () => {
    expect(parseTidPairs(pairsBody([PAIR]))).toEqual([PAIR]);
  });

  it.each([
    ["not json", "nope"],
    ["not an array", "{}"],
    ["empty array", "[]"],
    ["missing field", JSON.stringify([{ animationKey: "a" }])],
    ["wrong field type", JSON.stringify([{ animationKey: 1, verification: "v" }])],
  ])("throws nitter's message for %s", (_label, raw) => {
    expect(() => parseTidPairs(raw)).toThrow(`Parsing pairs failed: ${raw}`);
  });
});

describe("createTidGenerator", () => {
  it("builds the sha256/xor transaction id over GET!path!time+key", async () => {
    const now = () => TID_EPOCH + 12345;
    const gen = createTidGenerator({
      fetchPairs: async () => pairsBody([PAIR]),
      now,
      random: () => 0, // pair index 0, xor byte 0
    });
    const tid = await gen.genTid("/i/api/graphql/abc/User");

    const timeNow = 12345;
    const timeBytes = Buffer.alloc(4);
    timeBytes.writeUInt32LE(timeNow, 0);
    const hash = createHash("sha256")
      .update(`GET!/i/api/graphql/abc/User!${timeNow}${KEYWORD}${PAIR.animationKey}`, "utf8")
      .digest();
    const expected = Buffer.concat([
      Buffer.from([0]), // random byte 0 → no visible xor
      Buffer.from(PAIR.verification, "base64"),
      timeBytes,
      hash.subarray(0, 16),
      Buffer.from([3]),
    ]);

    expect(tid).toBe(expected.toString("base64").replaceAll("=", ""));
    expect(tid).not.toContain("=");
  });

  it("xors every byte with the leading random byte", async () => {
    let call = 0;
    const values = [0, 0b10101010]; // pair sample, then xor byte
    const gen = createTidGenerator({
      fetchPairs: async () => pairsBody([PAIR]),
      now: () => TID_EPOCH + 1,
      random: () => {
        const value = values[call] ?? 0;
        call += 1;
        return value / 256;
      },
    });
    const decoded = Buffer.from(await gen.genTid("/x"), "base64");
    const randomNum = decoded[0] ?? 0;
    expect(randomNum).toBe(0b10101010);
    const body = Buffer.alloc(decoded.length - 1);
    for (let i = 0; i < body.length; i++) body[i] = (decoded[i + 1] as number) ^ randomNum;
    // Body layout: key bytes + 4 time bytes + 16 hash bytes + the trailing 3.
    expect(body[body.length - 1]).toBe(3);
    const keyBytes = Buffer.from(PAIR.verification, "base64");
    expect(body.subarray(0, keyBytes.length)).toEqual(keyBytes);
    const timeBytes = Buffer.alloc(4);
    timeBytes.writeUInt32LE(1, 0);
    expect(body.subarray(keyBytes.length, keyBytes.length + 4)).toEqual(timeBytes);
  });

  it("samples a random pair and refreshes the cache after the ttl", async () => {
    let clock = TID_EPOCH + 10;
    const fetchPairs = vi.fn(async () => pairsBody([PAIR, SECOND_PAIR]));
    const gen = createTidGenerator({
      fetchPairs,
      now: () => clock,
      random: () => 0.75, // pair index floor(0.75 * 2) = 1 → SECOND_PAIR
      ttlSec: 3600,
    });

    const first = await gen.genTid("/p");
    const second = await gen.genTid("/p");
    expect(fetchPairs).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);

    clock += 3601;
    await gen.genTid("/p");
    expect(fetchPairs).toHaveBeenCalledTimes(2);
  });

  it("serves the stale cache on a non-200 refresh", async () => {
    let clock = TID_EPOCH + 10;
    let calls = 0;
    const gen = createTidGenerator({
      fetchPairs: async () => {
        calls += 1;
        return calls === 1 ? pairsBody([PAIR]) : undefined;
      },
      now: () => clock,
      random: () => 0,
      ttlSec: 1,
    });
    await gen.genTid("/p");
    clock += 2; // past the ttl → refresh attempted → non-200 → serve stale
    expect(await gen.genTid("/p")).toBeTruthy();
    expect(calls).toBe(2);
  });

  it("throws when no pairs could be fetched", async () => {
    const gen = createTidGenerator({
      fetchPairs: async () => undefined,
      now: () => TID_EPOCH + 10,
      random: () => 0,
    });
    await expect(gen.genTid("/p")).rejects.toThrow("Failed to fetch x-client-transaction-id pairs");
  });

  it("propagates a transport failure from the pair fetch", async () => {
    const gen = createTidGenerator({
      fetchPairs: async () => {
        throw new Error("network down");
      },
      now: () => TID_EPOCH + 10,
      random: () => 0,
    });
    await expect(gen.genTid("/p")).rejects.toThrow("network down");
  });
});
