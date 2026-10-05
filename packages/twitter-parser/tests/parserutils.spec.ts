import { describe, expect, it } from "vitest";
import { fromUnixSeconds, parseIsoDate, parseTwitterDate } from "../src/dates.ts";
import {
  at,
  boolDef,
  each,
  entryId,
  expandedUrl,
  idFromEntry,
  idString,
  imageStr,
  imageVal,
  num,
  numDef,
  orNull,
  pick,
  str,
  strDef,
  strVal,
  typeName,
} from "../src/json.ts";
import {
  anchor,
  cmpSlice,
  deduplicate,
  extractHashtags,
  extractSlice,
  extractUrls,
  isTwitterUrl,
  replacedWith,
  replaceHashtags,
  replaceMentions,
  shortLink,
  xmlEscape,
} from "../src/slices.ts";

describe("json accessors", () => {
  const js = { a: "x", b: { c: 3, d: null }, e: [1, 2], f: true };

  it('walks paths like js{"a","b"} and defaults like getStr/getInt', () => {
    expect(at(js, "b", "c")).toBe(3);
    expect(at(js, "b", "d")).toBeUndefined();
    expect(at(js, "missing", "deep")).toBeUndefined();
    expect(str(js, "a")).toBe("x");
    expect(str(js, "b", "c")).toBe("");
    expect(str(js, "missing")).toBe("");
    expect(num(js, "b", "c")).toBe(3);
    expect(num(js, "a")).toBe(0);
    expect(numDef(js, 7, "a")).toBe(7);
    expect(boolDef(js, false, "f")).toBe(true);
    expect(boolDef(js, false, "a")).toBe(false);
    expect(strDef(js, "dflt", "missing")).toBe("dflt");
    expect(each(js, "e")).toHaveLength(2);
    expect(each(js, "a")).toHaveLength(0);
  });

  it("ports select, ?, getTypeName, getEntryId, getStrVal, getImageStr", () => {
    expect(pick(undefined, null, { x: 1 })).toEqual({ x: 1 });
    expect(pick()).toBeUndefined();
    expect(orNull(null)).toBeUndefined();
    expect(orNull(5)).toBe(5);
    expect(typeName({ __typename: "Tweet" })).toBe("Tweet");
    expect(typeName({ type: "TimelinePinEntry" })).toBe("TimelinePinEntry");
    expect(entryId({ entry_id: "tweet-1" })).toBe("tweet-1");
    expect(strVal({ string_value: "v" }, "d")).toBe("v");
    expect(strVal({ string_value: "" }, "d")).toBe("d");
    expect(imageStr("https://pbs.twimg.com/media/abc.jpg")).toBe("media/abc.jpg");
    expect(imageStr("https://video.twimg.com/x.png")).toBe("video.twimg.com/x.png");
    expect(imageVal({ image_value: { url: "https://pbs.twimg.com/pic.png" } })).toBe("pic.png");
    expect(expandedUrl({ url: "t.co", expanded_url: "x.com/full" })).toBe("x.com/full");
    expect(expandedUrl({ url: "t.co" })).toBe("t.co");
  });

  it("ports getId/idString: digits after the last dash, empty when not numeric", () => {
    expect(idString("tweet-1234567")).toBe("");
    expect(idFromEntry("tweet-1234567")).toBe("1234567");
    expect(idFromEntry("123")).toBe("123");
    expect(idFromEntry("cursor-bottom-abc")).toBe("");
    expect(idString("")).toBe("");
    expect(idString("12x3")).toBe("");
  });
});

describe("dates", () => {
  it("parses Twitter's '+0000' format into ISO UTC", () => {
    expect(parseTwitterDate("Tue Aug 08 20:19:24 +0000 2023")).toBe("2023-08-08T20:19:24.000Z");
    expect(parseTwitterDate("short")).toBe("");
  });

  it("parses ISO dates and unix seconds", () => {
    expect(parseIsoDate("2024-01-02T03:04:05Z")).toBe("2024-01-02T03:04:05.000Z");
    expect(parseIsoDate("garbage")).toBe("");
    expect(fromUnixSeconds(1700000000)).toBe("2023-11-14T22:13:20.000Z");
    expect(fromUnixSeconds(0)).toBe("");
  });
});

describe("slices", () => {
  it("detects twitter urls like utils.nim isTwitterUrl", () => {
    expect(isTwitterUrl("https://twitter.com/user")).toBe(true);
    expect(isTwitterUrl("https://x.com/user")).toBe(true);
    expect(isTwitterUrl("https://video.pscp.tv/x")).toBe(true);
    expect(isTwitterUrl("http://sub.video.pscp.tv/x")).toBe(true);
    expect(isTwitterUrl("https://evil.com/twitter.com")).toBe(false);
    expect(isTwitterUrl("nonsense")).toBe(false);
  });

  it("shortens links like formatters.nim shortLink", () => {
    expect(shortLink("https://www.example.com/a/very/long/url/segments/here")).toBe(
      "example.com/a/very/long/url/…",
    );
    expect(shortLink("https://t.co/abc")).toBe("t.co/abc");
  });

  it("builds anchors with escaped attributes", () => {
    expect(anchor("text", "https://x.com/a&b")).toBe('<a href="https://x.com/a&b">text</a>');
    expect(anchor("text", "/x", 'a"b')).toBe('<a href="/x" title="a&quot;b">text</a>');
  });

  it("extracts entity slices", () => {
    expect(extractSlice({ indices: [3, 9] })).toEqual({ a: 3, b: 9 });
    expect(extractSlice({})).toEqual({ a: 0, b: 0 });
    const repls: Parameters<typeof replacedWith>[1] = [];
    extractUrls(
      repls,
      { url: "https://t.co/x", expanded_url: "https://x.com/foo", indices: [0, 4] },
      10,
    );
    expect(repls[0]).toEqual({
      kind: "url",
      url: "https://x.com/foo",
      display: "x.com/foo",
      a: 0,
      b: 4,
    });
    extractHashtags(repls, { indices: [10, 14] });
    expect(repls[1]).toEqual({ kind: "hashtag", a: 10, b: 14 });
  });

  it("splices urls and hashtags into the text as html", () => {
    const runes = [..."look https://t.co/ab and #tag end"];
    const repls = [
      { kind: "url" as const, a: 5, b: 20, url: "https://x.com/foo", display: "x.com/foo" },
      { kind: "hashtag" as const, a: 25, b: 29 },
    ];
    const html = replacedWith(runes, repls, { a: 0, b: runes.length });
    expect(html).toBe(
      'look <a href="https://x.com/foo">x.com/foo</a> and <a href="/search?f=tweets&q=%23tag">#tag</a> end',
    );
  });

  it("filters out-of-range slices instead of throwing", () => {
    const runes = [..."short"];
    const html = replacedWith(
      runes,
      [{ kind: "url", a: 3, b: 400, url: "https://x.com", display: "x.com" }],
      {
        a: 0,
        b: runes.length,
      },
    );
    expect(html).toBe("short");
  });

  it("dedups by start index and sorts with the ported cmp quirk", () => {
    const repls = [
      { kind: "url" as const, a: 5, b: 9, url: "", display: "" },
      { kind: "url" as const, a: 5, b: 3, url: "", display: "" },
      { kind: "hashtag" as const, a: 2, b: 4 },
    ];
    deduplicate(repls);
    repls.sort(cmpSlice);
    expect(repls.map((r) => r.a)).toEqual([2, 5]);
  });

  it("ports the mention and hashtag regex post-processing", () => {
    expect(replaceMentions("hi @bob_1!")).toBe('hi <a href="/bob_1">@bob_1</a>!');
    expect(replaceHashtags("nice #day_2 ok")).toBe(
      'nice <a href="/search?f=tweets&q=%23day_2">#day_2</a> ok',
    );
    expect(replaceHashtags("$TSLA to the moon")).toBe(
      '<a href="/search?f=tweets&q=%23TSLA">$TSLA</a> to the moon',
    );
  });

  it("escapes xml the way xmltree.escape does", () => {
    expect(xmlEscape("<a & 'b' \"c\">")).toBe("&lt;a &amp; &apos;b&apos; &quot;c&quot;&gt;");
  });
});
