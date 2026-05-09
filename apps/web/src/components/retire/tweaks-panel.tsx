"use client";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export type SidebarStyle = "expanded" | "rail" | "minimal";

export function TweaksPanel({
  sidebarStyle,
  onSidebarStyle,
  darkMode,
  onDarkMode,
}: {
  sidebarStyle: SidebarStyle;
  onSidebarStyle: (s: SidebarStyle) => void;
  darkMode: boolean;
  onDarkMode: (v: boolean) => void;
}) {
  return (
    <div className="bg-card border-border fixed right-4 bottom-4 z-50 flex min-w-56 flex-col gap-3 rounded-xl border p-3 shadow-lg">
      <div className="text-muted-foreground text-[10px] font-bold tracking-widest uppercase">
        Tweaks
      </div>

      <div className="flex flex-col gap-2">
        <Label className="text-muted-foreground text-xs">Sidebar</Label>
        <ToggleGroup
          type="single"
          value={sidebarStyle}
          onValueChange={(v) => v && onSidebarStyle(v as SidebarStyle)}
          variant="outline"
          size="sm"
          className="w-full"
        >
          <ToggleGroupItem value="expanded" className="flex-1 capitalize">
            expanded
          </ToggleGroupItem>
          <ToggleGroupItem value="rail" className="flex-1 capitalize">
            rail
          </ToggleGroupItem>
          <ToggleGroupItem value="minimal" className="flex-1 capitalize">
            minimal
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div className="flex items-center justify-between gap-2">
        <Label htmlFor="tweak-dark" className="text-foreground text-sm">
          Dark mode
        </Label>
        <Switch id="tweak-dark" checked={darkMode} onCheckedChange={onDarkMode} />
      </div>
    </div>
  );
}
