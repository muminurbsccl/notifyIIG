import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LoginForm } from "@/components/login-form";

vi.mock("server-only", () => ({}));
vi.mock("@/app/login/actions", () => ({
  beginSignIn: vi.fn(),
  signInWithPassword: vi.fn(),
  requestMagicLink: vi.fn(),
}));

describe("LoginForm", () => {
  it("renders only the email field on step 1 (no tabs, no password field)", () => {
    const html = renderToString(createElement(LoginForm, {}));
    expect(html).toContain('name="email"');
    expect(html).not.toContain('name="password"');
    expect(html).not.toContain("login-modes");
    expect(html).toContain("Continue");
  });

  it("renders the password step with the email, different-email link, and link escape", () => {
    const html = renderToString(
      createElement(LoginForm, { step: "password", email: "person@example.com" }),
    );
    expect(html).toContain('name="step"');
    expect(html).toContain('value="password"');
    expect(html).toContain('value="person@example.com"');
    expect(html).toContain("person@example.com");
    expect(html).toContain('name="password"');
    expect(html).toContain("Not you?");
    expect(html).toContain("Email me a sign-in link instead");
  });

  it("renders the combined email + password form for method=password", () => {
    const html = renderToString(createElement(LoginForm, { method: "password" }));
    expect(html).toContain('name="email"');
    expect(html).toContain('name="password"');
    expect(html).toContain('href="/login?method=link"');
    expect(html).toContain("No password?");
  });

  it("renders the magic-link form for method=link", () => {
    const html = renderToString(createElement(LoginForm, { method: "link" }));
    expect(html).toContain('name="email"');
    expect(html).not.toContain('name="password"');
    expect(html).toContain("Email me a sign-in link");
  });

  it("renders the link-sent success notice", () => {
    const html = renderToString(createElement(LoginForm, { notice: "link-sent" }));
    expect(html).toContain("notice-success");
    expect(html).toContain("sign-in link is on its way");
  });

  it("renders the invalid-credentials warning", () => {
    const html = renderToString(createElement(LoginForm, { error: "invalid-credentials" }));
    expect(html).toContain("notice-warning");
    expect(html).toContain("email or password was not accepted");
  });
});