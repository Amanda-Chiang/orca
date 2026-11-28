import Link from "next/link";
import type { ReactNode } from "react";
import { Screen } from "@/components/layout/Screen";
import { LEGAL_UPDATED } from "@/lib/legal";

/** The frame of /privacy and /terms: public pages, readable signed in or out. */
export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Screen bg="parchment" className="overflow-y-auto">
      <article className="mx-auto flex w-full max-w-[760px] flex-col gap-[20px] px-[24px] py-[48px] text-[16px] leading-[1.6] text-prussian [&_a]:underline [&_h2]:mt-[16px] [&_h2]:text-[22px] [&_h2]:font-semibold [&_li]:ml-[20px] [&_li]:list-disc [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-[6px]">
        <header className="flex flex-col gap-[6px]">
          <h1 className="text-[32px] font-bold leading-[1.15]">{title}</h1>
          <p className="text-[14px]">Last updated {LEGAL_UPDATED}</p>
        </header>
        {children}
        <footer className="mt-[24px] flex gap-[16px] text-[14px]">
          <Link href="/privacy">Privacy Policy</Link>
          <Link href="/terms">Terms of Service</Link>
          <Link href="/">Orca</Link>
        </footer>
      </article>
    </Screen>
  );
}

/** Links to both pages, for the sign-in and sign-up screens (Google wants them on the home page). */
export function LegalLinks() {
  return (
    <p className="flex gap-[16px] text-[14px] text-prussian">
      <Link className="underline" href="/privacy">Privacy Policy</Link>
      <Link className="underline" href="/terms">Terms of Service</Link>
    </p>
  );
}
