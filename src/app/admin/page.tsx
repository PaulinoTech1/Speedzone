import { AdminPortal } from "@/components/admin/AdminPortal";
import { requireAdminPage } from "@/lib/server/auth/admin-page";
import { imageLimits } from "@/lib/server/env";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  // Server-side gate: unauthenticated visitors are redirected to sign in
  // before any dashboard markup is rendered or sent to the browser.
  await requireAdminPage();

  const encryptedDraftsEnabled =
    process.env.ENABLE_ENCRYPTED_LOCAL_DRAFTS?.trim().toLowerCase() === "true";
  const limits = imageLimits();

  return (
    <AdminPortal
      encryptedDraftsEnabled={encryptedDraftsEnabled}
      maximumImageBytes={limits.maximumBytes}
      maximumImageDimension={limits.maximumDimension}
      sanityProjectId={process.env.NEXT_PUBLIC_SANITY_PROJECT_ID ?? null}
      sanityDataset={process.env.NEXT_PUBLIC_SANITY_DATASET ?? null}
    />
  );
}
