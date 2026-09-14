"use client";

import { useState } from "react";
import AdminInventory from "@/components/admin/AdminInventory";
import AdminDiagnostics from "@/components/admin/AdminDiagnostics";
import TestDriveSubmissions from "@/components/admin/TestDriveSubmissions";

export default function AdminPage() {
  const [authenticated, setAuthenticated] = useState(false);

  return (
    <>
      <AdminInventory onAuthChange={setAuthenticated} />
      {authenticated && <><TestDriveSubmissions /><AdminDiagnostics /></>}
    </>
  );
}
