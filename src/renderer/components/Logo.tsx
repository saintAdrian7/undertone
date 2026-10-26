/** Our mark: a speech bubble with two quiet dots. Drawn here so no third-party asset is shipped. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 26 26" fill="currentColor" aria-hidden="true">
      <path d="M8 4h9a6 6 0 0 1 6 6v3a6 6 0 0 1-6 6h-2l-4 4v-4H8a6 6 0 0 1-6-6v-3a6 6 0 0 1 6-6z" opacity="0.92" />
      <circle cx="9.5" cy="11.5" r="1.6" fill="#1a1b22" />
      <circle cx="15.5" cy="11.5" r="1.6" fill="#1a1b22" />
    </svg>
  )
}
