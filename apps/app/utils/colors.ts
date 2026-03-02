/**
 * Default color palette for status indicators and UI elements
 * Based on the color picker palette from the reference image
 */

export const statusColors = {
  // Color palette from the image (approximate RGB values)
  gray: {
    bg: "rgb(200, 200, 200)",
    border: "rgb(150, 150, 150)",
    text: "rgb(80, 80, 80)",
  },
  coral: {
    bg: "rgb(255, 180, 160)",
    border: "rgb(240, 140, 120)",
    text: "rgb(180, 80, 60)",
  },
  orange: {
    bg: "rgb(255, 180, 100)",
    border: "rgb(240, 150, 80)",
    text: "rgb(180, 100, 50)",
  },
  yellow: {
    bg: "rgb(255, 240, 180)",
    border: "rgb(240, 220, 140)",
    text: "rgb(180, 160, 80)",
  },
  green: {
    bg: "rgb(200, 240, 200)",
    border: "rgb(150, 220, 150)",
    text: "rgb(80, 160, 80)",
  },
  blue: {
    bg: "rgb(180, 220, 255)",
    border: "rgb(140, 180, 240)",
    text: "rgb(60, 120, 200)",
  },
  purple: {
    bg: "rgb(220, 180, 255)",
    border: "rgb(200, 140, 240)",
    text: "rgb(140, 80, 200)",
  },
  pink: {
    bg: "rgb(255, 180, 220)",
    border: "rgb(240, 140, 200)",
    text: "rgb(200, 80, 160)",
  },
} as const;

/**
 * Status color mappings
 * Maps common statuses to palette colors
 */
export const statusColorMap: Record<string, keyof typeof statusColors> = {
  // Success/Positive statuses - Green
  approved: "green",
  verified: "green",
  submitted: "green",
  active: "green",
  paid: "green",
  completed: "green",
  present: "green",
  success: "green",

  // Warning/Pending statuses - Yellow/Orange
  pending: "yellow",
  draft: "yellow",
  processing: "orange",
  in_progress: "orange",
  review: "orange",

  // Error/Negative statuses - Coral/Red
  rejected: "coral",
  failed: "coral",
  absent: "coral",
  error: "coral",
  cancelled: "coral",
  not_submitted: "coral",
  "not submitted": "coral",

  // Info/Neutral statuses - Blue
  finalized: "blue",
  leave: "blue",
  info: "blue",
  new: "blue",

  // Neutral/Inactive - Gray
  archived: "gray",
  inactive: "gray",
  closed: "gray",

  // Special statuses
  half_day: "purple",
  custom: "purple",
  other: "pink",
} as const;

/**
 * Get status color styles for a given status
 */
export function getStatusColor(status: string): {
  bg: string;
  border: string;
  text: string;
} {
  const normalizedStatus = status.toLowerCase().replace(/[_\s]/g, "_");
  const colorKey = statusColorMap[normalizedStatus] || "gray";
  return statusColors[colorKey];
}

/**
 * Get status badge style object for inline styles
 */
export function getStatusBadgeStyle(status: string): React.CSSProperties {
  const colors = getStatusColor(status);
  return {
    backgroundColor: colors.bg,
    borderColor: colors.border,
    color: colors.text,
  } as React.CSSProperties;
}

/**
 * Get status badge className for Tailwind (with inline style fallback)
 */
export function getStatusBadgeClass(status: string): string {
  return "font-normal rounded-md hover:opacity-90 focus:ring-0 focus:ring-offset-0 transition-none border";
}
