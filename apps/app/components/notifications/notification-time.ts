import { format, formatDistanceToNow } from "date-fns";

export function getNotificationTimeMeta(createdAt: number): {
  relative: string;
  absolute: string;
} {
  const d = new Date(createdAt);
  return {
    relative: formatDistanceToNow(d, { addSuffix: true }),
    absolute: format(d, "EEEE p"),
  };
}
