import { useEffect, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "./use-toast";
import { vpsKeys } from "@/lib/queries/vps";
import { tunnelKeys } from "@/lib/queries/tunnels";
import { routeKeys } from "@/lib/queries/routes";
import { firewallKeys } from "@/lib/queries/firewall";
import type { SseEvent } from "@proxy-manager/shared";

const BASE_URL = import.meta.env.VITE_API_URL ?? "";
const RECONNECT_DELAY = 3000;
const MAX_RECONNECT_DELAY = 30000;

export function parseSseEvent(eventType: string, data: string): SseEvent | null {
  if (eventType === "ping") return null;
  try {
    const parsed = JSON.parse(data) as SseEvent;
    return parsed;
  } catch {
    return null;
  }
}

export function useVpsEvents() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectDelayRef = useRef(RECONNECT_DELAY);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleEvent = useCallback(
    (event: SseEvent) => {
      switch (event.type) {
        case "vps:status":
          queryClient.invalidateQueries({ queryKey: vpsKeys.lists() });
          queryClient.invalidateQueries({
            queryKey: vpsKeys.detail(event.vpsId),
          });
          queryClient.invalidateQueries({
            queryKey: vpsKeys.status(event.vpsId),
          });
          break;

        case "tunnel:connected":
        case "tunnel:disconnected":
          queryClient.invalidateQueries({
            queryKey: tunnelKeys.list(event.vpsId),
          });
          queryClient.invalidateQueries({
            queryKey: vpsKeys.status(event.vpsId),
          });
          break;

        case "tunnel:rotation_pending":
          queryClient.invalidateQueries({
            queryKey: tunnelKeys.list(event.vpsId),
          });
          toast({
            title: "Tunnel rotation pending",
            description: `Tunnel ${event.tunnelId} has a pending key rotation. Download the new config.`,
            variant: "warning",
          });
          break;

        case "tunnel:revoked_inactive":
          queryClient.invalidateQueries({
            queryKey: tunnelKeys.list(event.vpsId),
          });
          toast({
            title: "Tunnel revoked",
            description: `Tunnel ${event.tunnelId} was revoked due to inactivity.`,
            variant: "destructive",
          });
          break;

        case "reconciliation:drift":
          queryClient.invalidateQueries({
            queryKey: vpsKeys.status(event.vpsId),
          });
          if (event.caddyOps + event.wgOps + event.fwOps > 0) {
            toast({
              title: "Drift corrected",
              description: `Reconciliation corrected drift on VPS: ${event.caddyOps} Caddy, ${event.wgOps} WG, ${event.fwOps} FW ops.`,
            });
          }
          break;

        case "route:added":
        case "route:removed":
          queryClient.invalidateQueries({
            queryKey: routeKeys.list(event.vpsId),
          });
          queryClient.invalidateQueries({
            queryKey: vpsKeys.status(event.vpsId),
          });
          break;
      }
    },
    [queryClient, toast]
  );

  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const es = new EventSource(`${BASE_URL}/api/events`, {
      withCredentials: true,
    });

    es.onopen = () => {
      reconnectDelayRef.current = RECONNECT_DELAY;
    };

    es.onmessage = (e) => {
      const parsed = parseSseEvent("message", e.data);
      if (parsed) handleEvent(parsed);
    };

    const eventTypes = [
      "vps:status",
      "tunnel:connected",
      "tunnel:disconnected",
      "tunnel:rotation_pending",
      "tunnel:revoked_inactive",
      "reconciliation:drift",
      "route:added",
      "route:removed",
    ];

    for (const type of eventTypes) {
      es.addEventListener(type, (e) => {
        const parsed = parseSseEvent(type, (e as MessageEvent).data);
        if (parsed) handleEvent(parsed);
      });
    }

    es.onerror = () => {
      es.close();
      eventSourceRef.current = null;

      reconnectTimerRef.current = setTimeout(() => {
        connect();
      }, reconnectDelayRef.current);

      reconnectDelayRef.current = Math.min(
        reconnectDelayRef.current * 2,
        MAX_RECONNECT_DELAY
      );
    };

    eventSourceRef.current = es;
  }, [handleEvent]);

  useEffect(() => {
    connect();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [connect]);
}
