import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import vercelConfig from "../vercel.json";

function jpegDimensions(buffer: Buffer): { width: number; height: number } {
  expect(buffer.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  const startOfFrameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);
  let offset = 2;
  while (offset + 8 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    if (startOfFrameMarkers.has(marker)) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    const segmentLength = buffer.readUInt16BE(offset + 2);
    if (segmentLength < 2) break;
    offset += segmentLength + 2;
  }
  throw new Error("JPEG start-of-frame marker was not found");
}

describe("deployment foundation", () => {
  it("declares one daily expiry-notification cron", () => {
    expect(vercelConfig.crons).toEqual([
      {
        path: "/api/cron/expiry-notifications",
        schedule: "0 3 * * *",
      },
    ]);
  });

  it("ships a tracked environment variable template for deployments", async () => {
    const template = await readFile(new URL("../env.example", import.meta.url), "utf8");
    expect(template).toContain("NEXT_PUBLIC_SUPABASE_URL=");
    expect(template).toContain("SUPABASE_SERVICE_ROLE_KEY=");
    expect(template).toContain("CRON_SECRET=");
  });

  it("bundles and renders the official BSCPLC logo locally", async () => {
    const logo = await readFile(new URL("../public/brand/bscplc-logo.jpg", import.meta.url));
    const component = await readFile(new URL("../components/brand-logo.tsx", import.meta.url), "utf8");
    const dimensions = jpegDimensions(logo);
    expect(logo.byteLength).toBeGreaterThan(1_000);
    expect(dimensions.width).toBe(320);
    expect(component).toContain('/brand/bscplc-logo.jpg');
    expect(component).toContain('alt="BSCPLC logo"');
    expect(component).toContain(`width={${dimensions.width}}`);
    expect(component).toContain(`height={${dimensions.height}}`);
    expect(component).not.toContain("<strong>BSCPLC</strong>");
  });
});
