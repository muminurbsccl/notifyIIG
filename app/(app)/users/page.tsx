import { requireProfile } from "@/lib/auth";
import { UserManagement } from "@/components/user-management";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  await requireProfile(["admin"]);
  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">Administration</p>
          <h1>Users</h1>
        </div>
      </header>
      <UserManagement />
    </>
  );
}
