import { describe, expect, it } from "vitest";
import { buildExpiryEmail } from "@/lib/domain/notification-email";

describe("professional notification email", () => {
  it("includes branded HTML, essential facts, and a text fallback", () => {
    const email = buildExpiryEmail({ circuitId: "IIG<42>", expiryDate: "2026-12-31", milestoneLabel: "4-month reminder" });
    expect(email.subject).toContain("IIG<42>");
    expect(email.bodyHtml).toContain("BSCPLC IPT NotifySystem");
    expect(email.bodyHtml).toContain("IIG&lt;42&gt;");
    expect(email.bodyHtml).toContain("2026-12-31");
    expect(email.bodyHtml).toContain("role=\"presentation\"");
    expect(email.bodyText).toContain("Circuit: IIG<42>");
    expect(email.bodyText).toContain("4-month reminder");
  });
});
