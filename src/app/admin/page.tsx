"use client";

import { useCallback, useState } from "react";
import AdminInventory from "@/components/admin/AdminInventory";
import AdminDiagnostics from "@/components/admin/AdminDiagnostics";
import TestDriveSubmissions from "@/components/admin/TestDriveSubmissions";

export default function AdminPage() {
  const [authenticated, setAuthenticated] = useState(false);
  const [inventoryAuthenticated, setInventoryAuthenticated] = useState(false);
  const handleAuthChange = useCallback((passkeyAuthenticated: boolean, inventoryAuthorized = passkeyAuthenticated) => {
    setAuthenticated(passkeyAuthenticated);
    setInventoryAuthenticated(inventoryAuthorized);
  }, []);

  return (
    <>
      <AdminInventory onAuthChange={handleAuthChange} />
      {inventoryAuthenticated && <TestDriveSubmissions />}
      {authenticated && <AdminDiagnostics />}
    </>
  );
}
