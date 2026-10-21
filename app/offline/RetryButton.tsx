"use client";

export function RetryButton() {
  return (
    <button
      onClick={() => window.location.reload()}
      className="mt-8 rounded-full px-7 py-3 text-sm font-medium text-slate-900"
      style={{ background: "linear-gradient(90deg,#7df0d0,#a99bff,#ffd98a)" }}
    >
      Try again
    </button>
  );
}
