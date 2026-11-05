import "./brand.css";

export interface BrandLoadingProps {
  label: string;
  variant?: "splash" | "page" | "inline";
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** SaiFlow "F" with three dots (NFR-USAB-004); the label says what is being waited for. */
export function BrandLoading({ label, variant = "page" }: BrandLoadingProps) {
  const animated = !prefersReducedMotion();
  return (
    <div
      role="status"
      aria-live="polite"
      className={`brand-loading brand-loading--${variant}`}
      data-animated={String(animated)}
    >
      <div className="brand-loading__mark" aria-hidden="true">
        <span className="brand-loading__f">F</span>
        <span className="brand-loading__dots">
          <i />
          <i />
          <i />
        </span>
      </div>
      <span className="brand-loading__label">{label}</span>
    </div>
  );
}
