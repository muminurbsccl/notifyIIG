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
  const [editing, setEditing] = useState<User | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPassword, setEditPassword] = useState("");

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

  function beginEdit(user: User) {
    setEditing(user);
    setEditName(user.full_name);
    setEditEmail(user.email ?? "");
    setEditPassword("");
  }

  async function saveEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const response = await fetch(`/api/users/${editing.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fullName: editName, email: editEmail, ...(editPassword ? { password: editPassword } : {}) }),
    });
    const body = await response.json();
    if (!response.ok) setError(body.error?.message ?? "User could not be updated");
    else { setEditing(null); setResult("User updated successfully"); await load(); }
  }

  async function remove(user: User) {
    if (!window.confirm(`Delete ${user.email ?? "this user"}? This cannot be undone.`)) return;
    const response = await fetch(`/api/users/${user.id}`, { method: "DELETE" });
    const body = await response.json();
    if (!response.ok) setError(body.error?.message ?? "User could not be deleted");
    else { setResult("User deleted successfully"); await load(); }
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
            <td><div className="form-actions"><button className="button button-secondary" type="button" onClick={() => beginEdit(user)}>Edit</button><button className="button button-secondary" type="button" onClick={() => toggle(user)}>{user.active ? "Deactivate" : "Activate"}</button><button className="button button-secondary" type="button" onClick={() => remove(user)}>Delete</button></div></td>
          </tr>)}</tbody>
        </table>
      </div>
      {editing && <div className="data-card stack-gap">
        <h2 className="section-heading">Edit {editing.email}</h2>
        <form className="form-stack" onSubmit={saveEdit}>
          <label>Full name<input value={editName} onChange={(event) => setEditName(event.target.value)} /></label>
          <label>Email<input required type="email" value={editEmail} onChange={(event) => setEditEmail(event.target.value)} /></label>
          <label>New password (optional)<input minLength={8} type="password" value={editPassword} onChange={(event) => setEditPassword(event.target.value)} /></label>
          <div className="form-actions"><button className="button button-primary" type="submit">Save user</button><button className="button button-secondary" type="button" onClick={() => setEditing(null)}>Cancel</button></div>
        </form>
      </div>}
    </>
  );
}
