import { H2hView } from "@/components/bwf/h2h-view";

export default async function BwfH2hPage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; b?: string }>;
}) {
  const sp = await searchParams;
  return <H2hView initialA={sp.a} initialB={sp.b} />;
}
