import { cn } from "@/lib/cn";
import { Sidebar } from "./Sidebar";

/** Main area + the 340px right sidebar. Used by the map and path screens. */
/** `sidebar={false}`: no due sidebar (a course in cram mode, owner 2026-11-22). */
export function AppShell({ bg = "parchment", sidebar = true, className, children }: { bg?: "parchment" | "ocean"; sidebar?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <div className="flex h-screen-below-bar w-full overflow-hidden">
      <main className={cn("relative min-w-0 flex-1 overflow-hidden", bg === "parchment" ? "bg-parchment" : "bg-ocean", className)}>
        {children}
      </main>
      {sidebar && <Sidebar />}
    </div>
  );
}
