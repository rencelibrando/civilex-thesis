import * as React from "react";

export interface LegalIconProps extends React.SVGProps<SVGSVGElement> {
  size?: number | string;
  strokeWidth?: number | string;
}

/**
 * CIVIL-LEX Official Brand Insignia
 * Combines the bilateral scales of justice with subtle neural AI node geometry
 */
export function CivilexLogo({
  size = 24,
  strokeWidth = 1.75,
  className,
  ...props
}: LegalIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      {...props}
    >
      {/* Central Authority Pillar */}
      <line x1="12" y1="3" x2="12" y2="19" />
      {/* Apex Diamond Finial */}
      <polygon points="12,1.75 14.25,4 12,6.25 9.75,4" fill="currentColor" stroke="none" />
      {/* Balanced Crossbeam */}
      <path d="M4 7.5h16" />
      {/* Left Scale Pan Suspension and Bowl */}
      <path d="M4 7.5L1.75 13.5h4.5L4 7.5z" />
      <path d="M1.75 13.5c0 1.8 1 2.8 2.25 2.8s2.25-1 2.25-2.8" />
      {/* Right Scale Pan Suspension and Bowl */}
      <path d="M20 7.5l-2.25 6h4.5L20 7.5z" />
      <path d="M17.75 13.5c0 1.8 1 2.8 2.25 2.8s2.25-1 2.25-2.8" />
      {/* Central Fulcrum Hub */}
      <circle cx="12" cy="7.5" r="1.5" fill="currentColor" stroke="none" />
      {/* Double Foundation Pediment */}
      <line x1="9" y1="17.5" x2="15" y2="17.5" />
      <line x1="6.5" y1="20.5" x2="17.5" y2="20.5" />
    </svg>
  );
}

/**
 * Philippine Scales of Justice
 * Calibrated bilateral balance on an authoritative institutional pillar
 */
export function ScalesOfJustice({
  size = 24,
  strokeWidth = 1.75,
  className,
  ...props
}: LegalIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      {...props}
    >
      <path d="M12 2.5v16.5" />
      <path d="M8 21h8" />
      <path d="M10 19h4" />
      <path d="M4.5 7h15" />
      <path d="M4.5 7l-2.5 6a3.5 3.5 0 0 0 7 0L6.5 7" />
      <path d="M17.5 7l-2.5 6a3.5 3.5 0 0 0 7 0L19.5 7" />
      <circle cx="12" cy="2.5" r="1.25" fill="currentColor" />
      <path d="M2 13h7" />
      <path d="M15 13h7" />
    </svg>
  );
}

/**
 * Supreme Court Jurisprudence Gavel
 * Judicial precision gavel resting upon an acoustic resonance block
 */
export function JurisprudenceGavel({
  size = 24,
  strokeWidth = 1.75,
  className,
  ...props
}: LegalIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      {...props}
    >
      <path d="m14.5 4.5 5 5" />
      <path d="m13 6 4 4" />
      <path d="m12.5 3.5 4 4-2.5 2.5-4-4L12.5 3.5z" />
      <path d="m10 6-6.5 6.5a1.5 1.5 0 0 0 2.12 2.12L12 8.12" />
      <path d="M3 20.5h18" />
      <path d="M6 18h12" />
      <path d="M8 15.5h8" />
    </svg>
  );
}

/**
 * Civil Code Codex
 * Classical leather-bound statutory codex with official ribbon marker (R.A. 386)
 */
export function CivilCodeCodex({
  size = 24,
  strokeWidth = 1.75,
  className,
  ...props
}: LegalIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      {...props}
    >
      <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a2.5 2.5 0 0 1-2.5-2.5z" />
      <path d="M6 2v17.5c0 .83.67 1.5 1.5 1.5H19" />
      <path d="M12 2v7l2.5-1.5L17 9V2" />
      <path d="M9 13h7" />
      <path d="M9 16h5" />
    </svg>
  );
}

/**
 * Family Code Protection Badge
 * Dual filial shelter and matrimonial bond emblem (Executive Order No. 209)
 */
export function FamilyCodeBadge({
  size = 24,
  strokeWidth = 1.75,
  className,
  ...props
}: LegalIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      {...props}
    >
      <circle cx="9" cy="7" r="3" />
      <circle cx="15.5" cy="8.5" r="2.5" />
      <path d="M3.5 19c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <path d="M15.5 13.5c2.5 0 4.5 2 4.5 5.5" />
      <path d="M12 21.5l1.5-1.5c1-1 2.5-1 3.5 0" />
    </svg>
  );
}

/**
 * Legal Compliance & Verification Shield
 * Dual-layered statutory shield with embedded audit checkmark
 */
export function LegalShieldCheck({
  size = 24,
  strokeWidth = 1.75,
  className,
  ...props
}: LegalIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      {...props}
    >
      <path d="M12 2.5 19.5 5v6.5c0 5-3.5 9.5-7.5 10.5C8 21 4.5 16.5 4.5 11.5V5L12 2.5z" />
      <path d="m9 11.5 2.25 2.25L15.5 9" />
    </svg>
  );
}

/**
 * Legal AI Intelligence Sparkle
 * Fine-line 4-point star with neural core, symbolizing deep legal retrieval
 */
export function LegalAiSparkle({
  size = 24,
  strokeWidth = 1.75,
  className,
  ...props
}: LegalIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      {...props}
    >
      <path d="m12 2 2.5 6.5L21 11l-6.5 2.5L12 20l-2.5-6.5L3 11l6.5-2.5L12 2z" />
      <circle cx="12" cy="11" r="1.5" fill="currentColor" />
      <path d="m19 18 1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2z" />
    </svg>
  );
}

/**
 * Citation & Statutory Pleading Document
 * Legal parchment with codal section indicator (§)
 */
export function CitationDocument({
  size = 24,
  strokeWidth = 1.75,
  className,
  ...props
}: LegalIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      {...props}
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <path d="M12 12a1.5 1.5 0 0 0-1.5 1.5c0 1 1.5 1.2 1.5 2a1.5 1.5 0 0 1-3 0" />
      <path d="M12 14.5a1.5 1.5 0 0 1 1.5 1.5c0 1-1.5 1.2-1.5 2a1.5 1.5 0 0 0 3 0" />
    </svg>
  );
}

/**
 * Classical Justice Column / Pillar
 * Institutional foundation emblem
 */
export function JusticePillar({
  size = 24,
  strokeWidth = 1.75,
  className,
  ...props
}: LegalIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      {...props}
    >
      <path d="M4 4h16" />
      <path d="M6 4v14" />
      <path d="M10 4v14" />
      <path d="M14 4v14" />
      <path d="M18 4v14" />
      <path d="M4 18h16" />
      <path d="M3 21h18" />
    </svg>
  );
}

