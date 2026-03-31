/**
 * AppLogo — 平安扣
 *
 * Design: A classic annular ring formed by two interlocking arcs.
 * Where the arcs cross (top and bottom), four concentric arc-steps
 * in Morandi green (#6E9075) spiral inward toward the central hole,
 * symbolising connection and steps taken together.
 *
 * Geometry (all in a 120×120 viewBox, centre 60,60):
 *   Outer radius  : 50
 *   Inner radius  : 22  (central hole)
 *   Ring thickness: 28
 *
 * Step arcs sit at the 12-o'clock and 6-o'clock crossing points,
 * spanning ±9° from the vertical axis, at radii 44 / 37 / 30 / 24.
 * Each step arc fades slightly so the innermost feels deepest.
 */

interface AppLogoProps {
  size?: number;
  className?: string;
}

export default function AppLogo({ size = 88, className = "" }: AppLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="平安扣"
      className={className}
    >
      <defs>
        {/* Clip everything to the donut region */}
        <clipPath id="pac-ring">
          <path
            fillRule="evenodd"
            d="
              M 60 10
              A 50 50 0 1 1 59.999 10
              Z
              M 60 38
              A 22 22 0 1 0 60.001 38
              Z
            "
          />
        </clipPath>

        {/* Soft drop shadow for the whole logo */}
        <filter id="pac-shadow" x="-10%" y="-10%" width="120%" height="120%">
          <feDropShadow
            dx="0"
            dy="2"
            stdDeviation="3"
            floodColor="#6E9075"
            floodOpacity="0.12"
          />
        </filter>
      </defs>

      {/* ── Ring body ──────────────────────────────────────────── */}

      {/* Ring A — left arc (slightly cooler oatmeal) */}
      <path
        d="M 60 10 A 50 50 0 0 0 60 110"
        stroke="#EAE6DC"
        strokeWidth="28"
        fill="none"
        clipPath="url(#pac-ring)"
      />
      {/* Ring B — right arc (warmer oatmeal, slight depth) */}
      <path
        d="M 60 10 A 50 50 0 0 1 60 110"
        stroke="#F0EDE4"
        strokeWidth="28"
        fill="none"
        clipPath="url(#pac-ring)"
      />

      {/* Outer and inner edge strokes for definition */}
      <circle cx="60" cy="60" r="50" stroke="#D4CEC3" strokeWidth="0.8" />
      <circle cx="60" cy="60" r="22" stroke="#D4CEC3" strokeWidth="0.8" />

      {/* Seam lines at crossing points (very subtle) */}
      <line x1="60" y1="10"  x2="60" y2="38"  stroke="#C8C3B8" strokeWidth="0.6" opacity="0.7" />
      <line x1="60" y1="82"  x2="60" y2="110" stroke="#C8C3B8" strokeWidth="0.6" opacity="0.7" />

      {/* ── TOP staircase (12-o'clock crossing, spiral inward) ───── */}
      {/*
        Arcs span 261° → 279°  (±9° from 270° = top of circle)
        cos(261°)=−0.1564  sin(261°)=−0.9877
        cos(279°)= 0.1564  sin(279°)=−0.9877

        Step  r    startX  startY  endX    endY   sw    opacity
        ──── ───  ──────  ──────  ──────  ──────  ────  ───────
          1   44   53.12   16.54   66.88   16.54   4.0   1.00
          2   37   54.21   23.46   65.79   23.46   3.5   0.82
          3   30   55.31   30.37   64.69   30.37   3.0   0.65
          4   24   56.25   36.30   63.75   36.30   2.5   0.48
      */}
      <path
        d="M 53.12 16.54 A 44 44 0 0 1 66.88 16.54"
        stroke="#6E9075" strokeWidth="4" strokeLinecap="round"
        filter="url(#pac-shadow)"
      />
      <path
        d="M 54.21 23.46 A 37 37 0 0 1 65.79 23.46"
        stroke="#6E9075" strokeWidth="3.5" strokeLinecap="round" opacity="0.82"
      />
      <path
        d="M 55.31 30.37 A 30 30 0 0 1 64.69 30.37"
        stroke="#6E9075" strokeWidth="3" strokeLinecap="round" opacity="0.65"
      />
      <path
        d="M 56.25 36.30 A 24 24 0 0 1 63.75 36.30"
        stroke="#6E9075" strokeWidth="2.5" strokeLinecap="round" opacity="0.48"
      />

      {/* ── BOTTOM staircase (6-o'clock crossing, mirror) ──────── */}
      {/*
        Arcs span 81° → 99°  (±9° from 90° = bottom of circle)
        cos(81°)= 0.1564  sin(81°)= 0.9877
        cos(99°)=−0.1564  sin(99°)= 0.9877

        Step  r    startX  startY  endX    endY
        ──── ───  ──────  ──────  ──────  ──────
          1   44   66.88  103.46   53.12  103.46
          2   37   65.79   96.54   54.21   96.54
          3   30   64.69   89.63   55.31   89.63
          4   24   63.75   83.70   56.25   83.70
      */}
      <path
        d="M 66.88 103.46 A 44 44 0 0 1 53.12 103.46"
        stroke="#6E9075" strokeWidth="4" strokeLinecap="round"
        filter="url(#pac-shadow)"
      />
      <path
        d="M 65.79 96.54 A 37 37 0 0 1 54.21 96.54"
        stroke="#6E9075" strokeWidth="3.5" strokeLinecap="round" opacity="0.82"
      />
      <path
        d="M 64.69 89.63 A 30 30 0 0 1 55.31 89.63"
        stroke="#6E9075" strokeWidth="3" strokeLinecap="round" opacity="0.65"
      />
      <path
        d="M 63.75 83.70 A 24 24 0 0 1 56.25 83.70"
        stroke="#6E9075" strokeWidth="2.5" strokeLinecap="round" opacity="0.48"
      />
    </svg>
  );
}
