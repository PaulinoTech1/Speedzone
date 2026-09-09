"use client";

import { useState } from "react";
import AdminInventory from "@/components/admin/AdminInventory";
import InventoryPhotoOptimizer from "@/components/admin/InventoryPhotoOptimizer";
import TestDriveSubmissions from "@/components/admin/TestDriveSubmissions";

export default function AdminPage() {
  const [authenticated, setAuthenticated] = useState(false);

  return (
    <>
      <AdminInventory onAuthChange={setAuthenticated} />
      {authenticated && <>
        <InventoryPhotoOptimizer />
        <TestDriveSubmissions />
      </>}
    </>
  );
}
