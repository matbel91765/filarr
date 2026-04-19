/**
 * FilarrLogo — Inline SVG logo that adapts to theme via currentColor / CSS variable
 */
import React from 'react';

interface FilarrLogoProps {
  size?: number | string;
  className?: string;
  color?: string;
}

export const FilarrLogo: React.FC<FilarrLogoProps> = ({
  size = 36,
  className = '',
  color = 'var(--color-primary-500, #52A1ED)',
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 512 512"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
  >
    <circle cx="315" cy="245" r="44" fill={color} />
    <circle cx="125" cy="245" r="44" fill={color} />
    <ellipse cx="387.5" cy="95" rx="43.5" ry="44" fill={color} />
    <circle cx="125" cy="95" r="44" fill={color} />
    <circle cx="125" cy="417" r="44" fill={color} />
    <path
      d="M125 96V417"
      stroke={color}
      strokeWidth="24"
      strokeMiterlimit="5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M125 96H392"
      stroke={color}
      strokeWidth="24"
      strokeMiterlimit="5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M125 245H314"
      stroke={color}
      strokeWidth="24"
      strokeMiterlimit="5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M212 174H399"
      stroke={color}
      strokeWidth="24"
      strokeMiterlimit="5"
      strokeLinejoin="round"
    />
    <path
      d="M209 163V213"
      stroke={color}
      strokeWidth="24"
      strokeMiterlimit="5"
      strokeLinejoin="round"
    />
    <path
      d="M207 171L124.75 94.75"
      stroke={color}
      strokeWidth="24"
      strokeMiterlimit="5"
      strokeLinejoin="round"
    />
    <path
      d="M209 275L209 365"
      stroke={color}
      strokeWidth="24"
      strokeMiterlimit="5"
      strokeLinejoin="round"
    />
    <path
      d="M388 95L388 175"
      stroke={color}
      strokeWidth="24"
      strokeMiterlimit="5"
      strokeLinejoin="round"
    />
    <path
      d="M221 363.556V365.448L132.3 427.644L118.521 407.993L208.11 345.175L221 363.556Z"
      fill={color}
    />
    <rect x="399" y="175" width="1" height="11" fill={color} />
  </svg>
);

export default FilarrLogo;
