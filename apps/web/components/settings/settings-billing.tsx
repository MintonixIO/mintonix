import { CreditCard, Download, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";

const INVOICES = [
  { date: "1 Jun 2026", amount: "$29.00" },
  { date: "1 May 2026", amount: "$29.00" },
  { date: "1 Apr 2026", amount: "$29.00" },
];

export function SettingsBilling() {
  return (
    <div className="flex flex-col gap-[18px]">
      <div>
        <div className="font-display text-[17px] font-semibold text-[var(--text-strong)]">
          Billing & plan
        </div>
        <div className="mt-0.5 text-[13px] text-[var(--text-secondary)]">
          Manage your subscription, usage and invoices.
        </div>
      </div>

      <div className="relative overflow-hidden rounded-[13px] border border-[var(--border)] bg-[var(--surface-1)] p-5">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(70% 130% at 100% 0%, rgba(54,147,255,0.10), transparent 60%)",
          }}
        />
        <div className="relative flex flex-wrap items-start gap-4">
          <div className="min-w-[200px] flex-1">
            <div className="inline-flex items-center gap-2">
              <span className="font-display text-lg font-semibold text-[var(--text-strong)]">
                Pro
              </span>
              <span className="rounded border border-[var(--border)] px-1.5 py-0.5 font-mono text-[9.5px] tracking-[0.1em] text-[var(--accent)] uppercase">
                Current
              </span>
            </div>
            <div className="mt-1.5 text-[13px] text-[var(--text-secondary)]">
              600 analysis minutes & 100 GB storage / month. Renews 1 Jul 2026.
            </div>
          </div>
          <div className="text-right">
            <div className="font-display text-[26px] font-semibold text-[var(--text-strong)]">
              $29
              <span className="font-mono text-[13px] font-normal text-[var(--text-muted)]">
                {" "}
                / mo
              </span>
            </div>
          </div>
        </div>
        <div className="relative mt-[18px] grid gap-[18px] sm:grid-cols-2">
          <div>
            <div className="mb-1.5 flex justify-between text-[12.5px] text-[var(--text-secondary)]">
              <span>Analysis minutes</span>
              <span className="font-mono text-[var(--text-strong)]">
                428 / 600
              </span>
            </div>
            <div className="h-[7px] overflow-hidden rounded-full bg-[var(--surface-3)]">
              <div className="h-full w-[71%] rounded-full bg-[var(--accent)]" />
            </div>
          </div>
          <div>
            <div className="mb-1.5 flex justify-between text-[12.5px] text-[var(--text-secondary)]">
              <span>Storage</span>
              <span className="font-mono text-[var(--text-strong)]">
                18.4 / 100 GB
              </span>
            </div>
            <div className="h-[7px] overflow-hidden rounded-full bg-[var(--surface-3)]">
              <div className="h-full w-[18%] rounded-full bg-[var(--accent)]" />
            </div>
          </div>
        </div>
        <div className="relative mt-[18px] flex gap-2.5">
          <Button>Upgrade plan</Button>
          <Button variant="ghost">Cancel plan</Button>
        </div>
      </div>

      <div className="flex items-center gap-3.5 rounded-[13px] border border-[var(--border)] bg-[var(--surface-1)] p-[15px]">
        <span className="inline-flex h-[30px] w-[42px] shrink-0 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface-3)] text-[var(--text-secondary)]">
          <CreditCard className="h-[18px] w-[18px]" />
        </span>
        <div className="flex-1">
          <div className="text-[13.5px] text-[var(--text-strong)]">
            Visa ending 4242
          </div>
          <div className="mt-px font-mono text-[11.5px] text-[var(--text-muted)]">
            Expires 09 / 28
          </div>
        </div>
        <Button variant="outline" size="sm">
          Update
        </Button>
      </div>

      <div className="overflow-hidden rounded-[13px] border border-[var(--border)] bg-[var(--surface-1)]">
        <div className="px-[15px] pt-[13px] pb-2 font-mono text-[10px] tracking-[0.1em] text-[var(--text-faint)] uppercase">
          Recent invoices
        </div>
        {INVOICES.map((iv) => (
          <div
            key={iv.date}
            className="flex items-center gap-3 border-t border-[var(--border-subtle)] px-[15px] py-3"
          >
            <FileText className="h-[15px] w-[15px] shrink-0 text-[var(--text-muted)]" />
            <span className="flex-1 text-[13px] text-[var(--text-strong)]">
              {iv.date}
            </span>
            <span className="font-mono text-[12.5px] tabular-nums text-[var(--text-secondary)]">
              {iv.amount}
            </span>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-[12.5px] text-[var(--text-link)]"
            >
              <Download className="h-3.5 w-3.5" />
              PDF
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
