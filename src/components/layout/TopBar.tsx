"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "@/app/auth/actions";
import { Avatar } from "@/components/brand/Avatar";
import { useAvatarPreview } from "@/components/brand/avatar-preview";
import { OrcaLogo } from "@/components/brand/OrcaLogo";
import { IconLogOut } from "@/components/icons";
import { isPublicPath } from "@/lib/auth/paths";
import { useCramming, useOrca } from "@/lib/store";
import { useCramResults } from "@/lib/cram-exit";

/**
 * Figma: Header/Top Bar (117:193) on every screen, Header/Top Bar Compact (117:194) under 640 px.
 * The lockup on the left (Logo/Orca Waves + "Orca"), Log out and the student's avatar on the right;
 * the avatar opens account Settings (owner, 2026-11-08). Account screens show only the avatar
 * (13 · Sign up: the one being picked), not a link. Height
 * is `--topbar-h` (globals.css), which every full-height screen subtracts.
 */
/** A course's pages, every one of which goes dark in cram mode (owner, 2026-11-22). */
const CRAM_PAGES = /^\/course\/([^/?#]+)(?:\/|$)/;

const ICON_BUTTON = "pressable inline-flex h-[48px] w-[48px] items-center justify-center rounded-[16px] border-2 border-line bg-card text-ink lip-2 lip-alice";

export function TopBar() {
  const pathname = usePathname();
  const { status, avatar, courses } = useOrca();
  // Over a course in cram mode: the blue of cram mode's path rims (alice-deep under its tokens), with cram mode's tokens for what's on it (owner, 2026-11-22).
  const slug = CRAM_PAGES.exec(pathname)?.[1];
  // The cram's results keep cram mode's look though the cram has ended (src/lib/cram-exit.ts).
  const results = useCramResults();
  const cram = Boolean(useCramming(slug ? courses.find((c) => c.slug === slug)?.id : undefined)) || (slug !== undefined && results === slug);
  const { preview } = useAvatarPreview();
  const guest = isPublicPath(pathname) || status === "signed-out";
  const creature = guest ? preview : avatar;

  return (
    <header
      data-part="top-bar"
      data-cram={cram ? "1" : undefined}
      // Above cram mode's dive (CramCurtain), which covers the whole window when the bar has scrolled away.
      className={`relative z-50 flex h-[var(--topbar-h)] shrink-0 items-center justify-between border-b-2 border-line px-[20px] sm:px-[28px] ${cram ? "bg-alice-deep" : "bg-page"}`}
    >
      <Link href="/" aria-label="Orca home" className="flex items-center gap-[12px]">
        <OrcaLogo waves shadow={false} width={60} />
        <span className="hidden text-[34px] font-bold leading-none text-ink sm:inline">Orca</span>
      </Link>
      <div className="flex items-center gap-[8px] sm:gap-[12px]" data-part="top-bar-actions">
        {!guest && (
          <form action={signOut}>
            <button type="submit" aria-label="Log out" title="Log out" className={ICON_BUTTON}>
              <IconLogOut size={24} />
            </button>
          </form>
        )}
        {guest ? (
          <Avatar creature={creature} size={44} className="sm:h-[48px] sm:w-[48px]" />
        ) : (
          <Link href="/settings" aria-label="Settings" title="Settings" data-part="avatar-settings" className="pressable rounded-pill lip-2 lip-alice">
            <Avatar creature={creature} size={44} className="sm:h-[48px] sm:w-[48px]" />
          </Link>
        )}
      </div>
    </header>
  );
}
