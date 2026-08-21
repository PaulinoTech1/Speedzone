import { AdminPortal } from "@/components/admin/AdminPortal";
import { imageLimits } from "@/lib/server/env";

export const dynamic = "force-dynamic";

export default function AdminPage() {
  const encryptedDraftsEnabled =
    process.env.ENABLE_ENCRYPTED_LOCAL_DRAFTS?.trim().toLowerCase() === "true";
  const limits = imageLimits();

  return (
    <AdminPortal
      encryptedDraftsEnabled={encryptedDraftsEnabled}
      maximumImageBytes={limits.maximumBytes}
      maximumImageDimension={limits.maximumDimension}
    />
  );
}
