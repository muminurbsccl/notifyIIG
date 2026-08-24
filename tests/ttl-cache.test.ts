import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { ttlCache } = await import("@/lib/server/ttl-cache");

describe("ttlCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads once and serves repeated calls from cache within the ttl", async () => {
    const loader = vi.fn().mockResolvedValue(["provider-a"]);
    const key = "user-1:providers:";

    const first = await ttlCache(key, 15_000, loader);
    vi.advanceTimersByTime(10_000);
    const second = await ttlCache(key, 15_000, loader);

    expect(first).toEqual(["provider-a"]);
    expect(second).toEqual(["provider-a"]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("expires after the ttl and reloads", async () => {
    let generation = 0;
    const loader = vi.fn().mockImplementation(async () => {
      generation += 1;
      return { generation };
    });
    const key = "user-2:providers:";

    await ttlCache<{ generation: number }>(key, 15_000, loader);
    vi.advanceTimersByTime(15_001);
    const reloaded = await ttlCache<{ generation: number }>(key, 15_000, loader);

    expect(reloaded.generation).toBe(2);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("isolates different keys", async () => {
    const loaderA = vi.fn().mockResolvedValue("value-a");
    const loaderB = vi.fn().mockResolvedValue("value-b");

    const a = await ttlCache("key-a", 15_000, loaderA);
    const b = await ttlCache("key-b", 15_000, loaderB);

    expect(a).toBe("value-a");
    expect(b).toBe("value-b");
    expect(loaderA).toHaveBeenCalledTimes(1);
    expect(loaderB).toHaveBeenCalledTimes(1);
  });

  it("does not cache rejected loads so the next call retries", async () => {
    const loader = vi.fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce("recovered");

    await expect(ttlCache("key-c", 15_000, loader)).rejects.toThrow("transient");
    const result = await ttlCache("key-c", 15_000, loader);

    expect(result).toBe("recovered");
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
