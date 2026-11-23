import { cn } from "@/lib/cn";
import { CramCurtain } from "@/components/course/CramCurtain";
import { NavBar } from "./NavBar";
import { Sidebar } from "./Sidebar";

/**
 * Main area + the 340px right sidebar. Used by the map and path screens. `cram` (a course in cram mode,
 * owner 2026-11-22): the page in cram mode's dark tokens (globals.css, [data-cram]), no due sidebar, and
 * its nav (calendar, add material, settings) floating at the bottom right instead.
 */
export function AppShell({ bg = "parchment", cram = false, className, children }: { bg?: "parchment" | "ocean"; cram?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <>
    <div className="relative flex h-screen-below-bar w-full overflow-hidden" data-cram={cram ? "1" : undefined}>
      <main className={cn("relative min-w-0 flex-1 overflow-hidden", bg === "parchment" ? "bg-parchment" : "bg-ocean", className)}>
        {children}
      </main>
      {cram ? <NavBar className="absolute bottom-[24px] right-[24px] z-20" /> : <Sidebar />}
    </div>
    {/* Outside the page's data-cram, so the curtain's own look is the old one (it's fixed, so where it sits doesn't matter). */}
    <CramCurtain cram={cram} />
    </>
  );
}
