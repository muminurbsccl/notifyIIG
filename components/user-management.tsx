"use client";

import { useEffect, useState } from "react";

type User = {
  id: string;
  email: string | null;
  full_name: string;
  role: string;
  active: boolean;
};

const ROLES = ["admin", "provider_manager", "operations_editor", "auditor", "viewer"];

export function UserManagement() {
  const [users, setUsers] = useState<User[]>([]);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState("viewer");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState("");

  async function load() {
    const response = await fetch("/api/users");
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message ?? "Users could not be loaded");
    setUsers(body.users ?? []);
  }

  useEffect(() => {
    load().catch((cause) => setError(cause instanceof Error ? cause.message : "Users could not be loaded"));
  }, []);

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setResult("");
    const response = await fetch("/api/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, fullName, role, active: true, ...(password ? { password } : {}) }),
    });
    const body = await response.json();
    if (!response.ok) {
      setError(body.error?.message ?? "User could not be created");
      return;
    }
    setEmail("");
    setFullName("");
    setPassword("");
    setResult("User created successfully");
    await load();
  }

  async function toggle(user: User) {
    setError("");
    const response = await fetch(`/api/users/${user.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active: !user.active }),
    });
    const body = await response.json();
    if (!response.ok) {
      setError(body.error?.message ?? "User could not be updated");
      return;
    }
    await load();
  }

  async function changeRole(user: User, nextRole: string) {
    const response = await fetch(`/api/users/${user.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: nextRole }),
    });
    const body = await response.json();
    if (!response.ok) setError(body.error?.message ?? "Role could not be updated");
    else await load();
  }

  return (
    <>
      <div className="data-card">
        <h2 className="section-heading">Invite or create user</h2>
        <p className="muted form-help">Leave the password blank to send an invitation email. Public signup remains disabled.</p>
        <form className="form-stack" onSubmit={create}>
          <div className="form-row">
            <label>Email<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            <label>Full name<input value={fullName} onChange={(event) => setFullName(event.target.value)} /></label>
          </div>
          <div className="form-row">
            <label>Role<select value={role} onChange={(event) => setRole(event.target.value)}>{ROLES.map((value) => <option key={value}>{value}</option>)}</select></label>
            <label>Set password (optional)<input minLength={8} type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          </div>
          <button className="button button-primary" type="submit">Create user</button>
        </form>
      </div>
      {error && <p className="notice notice-warning" role="alert">{error}</p>}
      {result && <p className="notice notice-success" role="status">{result}</p>}
      <div className="data-card stack-gap table-scroll">
        <h2 className="section-heading">User access</h2>
        <table>
          <thead><tr><th>Email</th><th>Name</th><th>Role</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>{users.map((user) => <tr key={user.id}>
            <td>{user.email ?? "—"}</td><td>{user.full_name || "—"}</td>
            <td><select aria-label={`Role for ${user.email}`} value={user.role} onChange={(event) => changeRole(user, event.target.value)}>{ROLES.map((value) => <option key={value}>{value}</option>)}</select></td>
            <td>{user.active ? "Active" : "Inactive"}</td>
            <td><button className="button button-secondary" type="button" onClick={() => toggle(user)}>{user.active ? "Deactivate" : "Activate"}</button></td>
          </tr>)}</tbody>
        </table>
      </div>
    </>
  );
}
