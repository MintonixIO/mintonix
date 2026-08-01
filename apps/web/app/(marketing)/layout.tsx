import { SiteNav } from "@/components/ui/site-nav";
import { Footer } from "@/components/ui/footer";
import {
  footerColumns,
  footerLegal,
  footerSocial,
  marketingFeatured,
  marketingNavItems,
} from "@/lib/nav";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-[var(--bg-base)]">
      <SiteNav
        items={[...marketingNavItems]}
        featured={marketingFeatured}
        mode="marketing"
        indicator="spotlight"
        signInLabel={null}
        ctaLabel="Open BWF"
        ctaHref="/bwf"
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
