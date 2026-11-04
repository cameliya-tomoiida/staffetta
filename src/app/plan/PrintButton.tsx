"use client";
import { Button, Icon } from "@/components/ui";

export function PrintButton({ label, primary }: { label: string; primary?: boolean }) {
  return (
    <Button variant={primary ? "primary" : "ghost"} onClick={() => window.print()}>
      <Icon.print className="h-5 w-5" />
      {label}
    </Button>
  );
}
