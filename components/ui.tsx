import type { PropsWithChildren } from "react";

export function Card({ children, className = "" }: PropsWithChildren<{ className?: string }>) {
  return (
    <div className={`rounded-xl border border-white/10 bg-zinc-950/60 p-4 shadow-sm ${className}`}>
      {children}
    </div>
  );
}

export function Button({
  children,
  className = "",
  variant = "primary",
  ...props
}: PropsWithChildren<
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }
>) {
  const base =
    "inline-flex items-center justify-center rounded-lg px-3 py-2 text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed";
  const styles =
    variant === "primary"
      ? "bg-white text-zinc-950 hover:bg-zinc-200"
      : variant === "danger"
        ? "bg-red-600 text-white hover:bg-red-500"
        : "bg-zinc-900 text-white hover:bg-zinc-800 border border-white/10";
  return (
    <button className={`${base} ${styles} ${className}`} {...props}>
      {children}
    </button>
  );
}

export function Badge({ children, className = "" }: PropsWithChildren<{ className?: string }>) {
  return (
    <span className={`inline-flex items-center rounded-md bg-white/10 px-2 py-0.5 text-xs text-white/90 ${className}`}>
      {children}
    </span>
  );
}

