import { useNavigate } from "react-router-dom";
import { Server } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { VpsStatusBadge } from "./VpsStatusBadge";
import { formatRelativeTime } from "@/lib/utils";
import type { VpsInstance } from "@proxy-manager/shared";

interface VpsCardProps {
  vps: VpsInstance;
}

export function VpsCard({ vps }: VpsCardProps) {
  const navigate = useNavigate();

  return (
    <Card
      className="cursor-pointer transition-shadow hover:shadow-md"
      onClick={() => navigate(`/vps/${vps.id}`)}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Server className="h-4 w-4 text-muted-foreground" />
          {vps.name}
        </CardTitle>
        <VpsStatusBadge status={vps.status} />
      </CardHeader>
      <CardContent>
        <div className="space-y-1 text-xs text-muted-foreground">
          <div className="flex justify-between">
            <span>API URL</span>
            <span className="font-mono truncate max-w-[180px]">
              {vps.apiUrl}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Last seen</span>
            <span>{formatRelativeTime(vps.lastSeenAt)}</span>
          </div>
          <div className="flex justify-between">
            <span>Added</span>
            <span>{formatRelativeTime(vps.createdAt)}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
