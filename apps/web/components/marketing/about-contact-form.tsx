"use client";

import { useState } from "react";
import { Clock, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

const CONTACT_EMAIL = "hello@mintonix.io";

export function AboutContactForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [topic, setTopic] = useState("General");
  const [club, setClub] = useState("");
  const [message, setMessage] = useState("");

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const subject = encodeURIComponent(`[Mintonix] ${topic} — ${name || "Contact"}`);
    const body = encodeURIComponent(
      [
        `Name: ${name || "(not provided)"}`,
        `Email: ${email || "(not provided)"}`,
        `Topic: ${topic}`,
        club ? `Club/team: ${club}` : null,
        "",
        message || "(no message)",
      ]
        .filter((line) => line != null)
        .join("\n"),
    );
    window.location.href = `mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`;
  };

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)] p-6 shadow-[var(--shadow-md),var(--shadow-edge)] md:p-8"
    >
      <div className="flex flex-col gap-[18px]">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Name"
            placeholder="Lin Dan"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            label="Email"
            type="email"
            placeholder="you@club.com"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Topic"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            options={[
              { value: "General", label: "General enquiry" },
              { value: "Support", label: "Product support" },
              { value: "Sales", label: "Sales & teams" },
              { value: "Data", label: "Data & BWF library" },
              { value: "Press", label: "Press & media" },
            ]}
          />
          <Input
            label="Club or team"
            placeholder="Optional"
            value={club}
            onChange={(e) => setClub(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2.5 rounded-[9px] border border-[var(--border-subtle)] bg-[var(--ink-850)] px-3 py-2.5">
          <Mail className="h-[15px] w-[15px] shrink-0 text-[var(--accent)]" />
          <span className="font-mono text-xs leading-[1.5] text-[var(--text-secondary)]">
            Opens your email app to {CONTACT_EMAIL} (no server-side form backend yet)
          </span>
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between">
            <label
              htmlFor="mx-message"
              className="text-xs font-medium tracking-wide text-[var(--text-secondary)]"
            >
              Message
            </label>
            <span className="font-mono text-[11px] tabular-nums text-[var(--text-faint)]">
              {message.length} / 2000
            </span>
          </div>
          <textarea
            id="mx-message"
            value={message}
            onChange={(e) => setMessage(e.target.value.slice(0, 2000))}
            required
            placeholder="Tell us what you're working on and what you'd like from Mintonix."
            className="min-h-[120px] w-full resize-y rounded-[9px] border border-[var(--border)] bg-[var(--ink-850)] px-3 py-2.5 text-sm leading-[1.55] text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-faint)] hover:border-[var(--border-strong)] focus:border-[var(--brand)] focus:bg-[var(--ink-800)] focus:shadow-[var(--ring)]"
          />
        </div>
      </div>
      <div className="mt-[22px] flex flex-wrap items-center gap-4">
        <Button type="submit" size="lg">
          Open email draft
        </Button>
        <span className="inline-flex items-center gap-1.5 text-[13px] text-[var(--text-muted)]">
          <Clock className="h-[15px] w-[15px] text-[var(--accent)]" />
          Typical reply within one business day
        </span>
      </div>
    </form>
  );
}
