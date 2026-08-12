import { describe, expect, it } from "vitest";
import { renderPlainTextTemplate, renderTemplate } from "@/lib/domain/templates";

describe("notification templates", () => {
  it("escapes untrusted values for HTML output", () => {
    expect(renderTemplate("Circuit {{circuit_id}}", { circuit_id: "<USID>" })).toBe(
      "Circuit &lt;USID&gt;",
    );
  });

  it("rejects unknown variables and keeps plain text free of tags", () => {
    expect(() => renderTemplate("{{missing}}", {})).toThrow("Unknown template variable");
    expect(renderPlainTextTemplate("<p>{{name}}</p>", { name: "<b>Owner</b>" })).toBe("Owner");
  });
});
