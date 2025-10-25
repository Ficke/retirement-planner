import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Get the most recent business day (skips weekends)
 * Markets are closed on Saturday and Sunday
 */
export function getMostRecentBusinessDay(fromDate: Date = new Date()): Date {
  const date = new Date(fromDate);
  const day = date.getDay();

  // If Saturday (6), go back to Friday
  if (day === 6) {
    date.setDate(date.getDate() - 1);
  }
  // If Sunday (0), go back to Friday
  else if (day === 0) {
    date.setDate(date.getDate() - 2);
  }

  return date;
}
