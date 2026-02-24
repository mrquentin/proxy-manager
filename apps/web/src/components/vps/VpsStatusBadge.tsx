import { Badge } from "@/components/ui/badge";
import type { VpsStatus } from "@proxy-manager/shared";
import { cn } from "@/lib/utils";

interface VpsStatusBadgeProps {
  status: VpsStatus;
  compact?: boolean;
}

export function VpsStatusBadge({ status, compact = false }: VpsStatusBadgeProps) {
  if (compact) {
    return (
      <span
        className={cn(
          "inline-block h-2 w-2 rounded-full",
          status === "online" && "bg-green-500",
          status === "offline" && "bg-red-500",
          status === "unknown" && "bg-gray-400"
        )}
        title={status}
      />
    );
  }

  const variant =
    status === "online"
      ? "success"
      : status === "offline"
        ? "destructive"
        : "secondary";

  return (
    <Badge variant={variant}>
      <span
        className={cn(
          "mr-1.5 inline-block h-1.5 w-1.5 rounded-full",
          status === "online" && "bg-green-500",
          status === "offline" && "bg-red-500",
          status === "unknown" && "bg-gray-400"
        )}
      />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </Badge>
  );
}
