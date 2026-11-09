// Browser-only fixture: actual production components, synthetic data, no server.
import { createRoot } from 'react-dom/client';
import DocumentPage from '../../src/app/(workspace)/documents/[id]/page';
import { AppShell } from '../../src/components/AppShell';
import { ToastProvider } from '../../src/components/ToastProvider';
import { BrandProvider } from '../../src/components/BrandProvider';
import { LeaveProtectionProvider } from '../../src/components/LeaveProtection';
import { emptyBrand } from '../../src/lib/client/brand';
import type { User } from '../../src/lib/client/types';
import '../../src/app/globals.css';
import '../../src/app/extra.css';
import '../../src/app/design.css';
import '../../src/app/ledger.css';
import '../../src/app/compact-review.css';
const user = (window as unknown as { fixtureUser: User }).fixtureUser;
createRoot(document.getElementById('root')!).render(<BrandProvider initialBrand={emptyBrand}><ToastProvider><LeaveProtectionProvider owner={user.id}><AppShell user={user}><DocumentPage /></AppShell></LeaveProtectionProvider></ToastProvider></BrandProvider>);
