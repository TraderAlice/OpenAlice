"use client";

import { useState } from "react";

const methods = [
  { name: "Shell", platform: "macOS / Linux · ARM64 & x64", command: "curl -fsSL https://openalice.ai/install | bash" },
  { name: "PowerShell", platform: "Windows · ARM64 & x64", command: "& ([scriptblock]::Create((Invoke-RestMethod https://openalice.ai/install.ps1)))" },
  { name: "npm", platform: "macOS / Linux / Windows · npm 12 script approval included", command: "npm install -g openalice --allow-scripts=openalice" },
  { name: "Bun", platform: "macOS / Linux / Windows", command: "bun add -g --trust openalice" },
  { name: "Homebrew", platform: "macOS / Linux · ARM64 & x64", command: "brew install traderalice/tap/openalice" },
];

export function InstallOptions() {
  const [selected, setSelected] = useState(0);
  const [message, setMessage] = useState("");
  const method = methods[selected];
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap gap-2" aria-label="Installation method">
        {methods.map((item, index) => (
          <button key={item.name} type="button" aria-pressed={selected === index}
            onClick={() => { setSelected(index); setMessage(""); }}
            className={`rounded-md border px-3 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 ${selected === index ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:text-foreground"}`}>
            {item.name}
          </button>
        ))}
      </div>
      <p className="mt-4 text-xs text-muted-foreground">{method.platform}</p>
      <pre className="mt-3 whitespace-pre-wrap break-all rounded-lg border border-border bg-background/60 p-4 text-sm leading-relaxed"><code>{method.command}</code></pre>
      <div className="mt-3 flex items-center gap-3">
        <button type="button" className="rounded-md border border-border px-3 py-2 text-sm hover:bg-foreground/5" onClick={async () => {
          try { await navigator.clipboard.writeText(method.command); setMessage("Copied"); }
          catch { setMessage("Select and copy the command above."); }
        }}>Copy command</button>
        <span role="status" className="text-xs text-muted-foreground">{message}</span>
      </div>
      <p className="mt-4 text-sm leading-relaxed text-muted-foreground">Installs the stable CLI. Then run <code>openalice</code> to get started. Git and Bash setup may ask for separate approval; choose and install your preferred coding agent.</p>
    </div>
  );
}
