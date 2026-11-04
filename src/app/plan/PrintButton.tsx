"use client";
import { Button, Icon } from "@/components/ui";

export function PrintButton({ label }: { label: string }) {
  return (
    <Button onClick={() => window.print()}>
      <Icon.print className="h-5 w-5" />
      {label}
    </Button>
  );
}
