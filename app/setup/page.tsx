import { BrandLogo } from "@/components/brand-logo";

export default function SetupPage() {
  return (
    <main className="setup-page">
      <section className="setup-card" aria-labelledby="setup-title">
        <BrandLogo />
        <p className="eyebrow">Deployment setup</p>
        <h1 id="setup-title">Connect the application services</h1>
        <p className="muted">
          This deployment is missing the public Supabase URL or anonymous key.
          Add the values from <code>.env.example</code> to the local environment
          or Vercel project settings, then restart the application.
        </p>
        <ol className="setup-list">
          <li>Create or select the approved Supabase project.</li>
          <li>Run the migration and safe provider seed from the repository.</li>
          <li>Add public Supabase values to the preview or production environment.</li>
          <li>Keep service-role and channel credentials server-only.</li>
        </ol>
        <p className="notice notice-warning">
          Vercel Hobby is suitable for technical proof-of-concept use only. Confirm
          an approved organizational production plan before go-live.
        </p>
      </section>
    </main>
  );
}
