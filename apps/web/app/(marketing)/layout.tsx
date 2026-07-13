"use client";

import { usePathname } from "next/navigation";
import { SiteNav } from "@/components/ui/site-nav";
import { Footer } from "@/components/ui/footer";
import {
  footerColumns,
  footerLegal,
  footerSocial,
  marketingFeatured,
  marketingNavItems,
} from "@/lib/nav";

function activeFromPath(pathname: string) {
  if (pathname.startsWith("/pricing")) return "Pricing";
  if (pathname.startsWith("/blog")) return "Blog";
  if (pathname.startsWith("/about")) return "About";
  if (pathname.startsWith("/bwf") || pathname.startsWith("/features/bwf"))
    return "BWF";
  return undefined;
}

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  return (
    <div className="flex min-h-full flex-1 flex-col bg-[var(--bg-base)]">
      <SiteNav
        items={[...marketingNavItems]}
        featured={marketingFeatured}
        mode="marketing"
        indicator="spotlight"
        active={activeFromPath(pathname)}
      />
      <main className="flex-1">{children}</main>
      <Footer
        columns={footerColumns}
        social={footerSocial}
        legalLinks={footerLegal}
        copyright="© 2026 Mintonix. All rights reserved."
      />
    </div>
  );
}
