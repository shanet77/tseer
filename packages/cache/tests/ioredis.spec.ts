import { describe, expect, it, vi } from "vitest";
import { createIoredisClient } from "../src/ioredis.ts";

describe("createIoredisClient", () => {
  it("reports client error events through onClientError", async () => {
    const onClientError = vi.fn();
    const client = (await createIoredisClient({
      host: "127.0.0.1",
      port: 1,
      onClientError,
    })) as unknown as {
      emit(event: string, err: Error): unknown;
      quit(): Promise<unknown>;
      disconnect(): void;
    };
    try {
      client.emit("error", new Error("boom"));
    } finally {
      await client.quit().catch(() => client.disconnect());
    }
    expect(onClientError).toHaveBeenCalledTimes(1);
    expect((onClientError.mock.calls[0] as unknown[])[0]).toBeInstanceOf(Error);
  });
});
