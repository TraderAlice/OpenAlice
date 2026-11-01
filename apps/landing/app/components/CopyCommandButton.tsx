"use client";

import { Check, Copy, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";

type CopyState = "idle" | "copied" | "error";

export function CopyCommandButton({
  eventName,
  label,
  primary = false,
  value,
}: {
  eventName: string;
  label: string;
  primary?: boolean;
  value: string;
}) {
  const [state, setState] = useState<CopyState>("idle");

  useEffect(() => {
    if (state === "idle") return;
    const timer = window.setTimeout(() => setState("idle"), 5000);
    return () => window.clearTimeout(timer);
  }, [state]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("error");
    }
  }

  const text = state === "copied" ? "Copied" : state === "error" ? "Copy failed" : label;
  const Icon = state === "copied" ? Check : state === "error" ? TriangleAlert : Copy;

  return (
    <button
      type="button"
      onClick={copy}
      data-evt={eventName}
      data-target="install_command"
      data-location="download"
      className={`oa-copy-command${primary ? " is-primary" : ""}`}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      <span aria-live="polite">{text}</span>
    </button>
  );
}
