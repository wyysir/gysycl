// Production components; the browser verifier intercepts every API with synthetic fixtures.
import { createRoot } from "react-dom/client";
import { SuppliersClient } from "../../src/app/(workspace)/suppliers/SuppliersClient";
import { AuthorizationsClient } from "../../src/app/(workspace)/permissions/AuthorizationsClient";
import { AppShell } from "../../src/components/AppShell";
import { ToastProvider } from "../../src/components/ToastProvider";
import { BrandProvider } from "../../src/components/BrandProvider";
import { LeaveProtectionProvider } from "../../src/components/LeaveProtection";
import { emptyBrand } from "../../src/lib/client/brand";
import type { User } from "../../src/lib/client/types";
import "../../src/app/globals.css";
import "../../src/app/extra.css";
import "../../src/app/design.css";
import "../../src/app/ledger.css";
import "../../src/app/supplier-business.css";
const user=(window as unknown as {fixtureUser:User}).fixtureUser;
createRoot(document.getElementById("root")!).render(<BrandProvider initialBrand={emptyBrand}><ToastProvider><LeaveProtectionProvider owner={user.id}><AppShell user={user}>{location.pathname==="/permissions"?<AuthorizationsClient/>:<SuppliersClient/>}</AppShell></LeaveProtectionProvider></ToastProvider></BrandProvider>);
