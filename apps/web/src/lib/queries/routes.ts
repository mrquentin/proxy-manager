import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { apiClient } from "../api-client";
import { useToast } from "@/hooks/use-toast";
import type { CreateRouteRequest } from "@proxy-manager/shared";

export const routeKeys = {
  all: ["routes"] as const,
  lists: () => [...routeKeys.all, "list"] as const,
  list: (vpsId: string) => [...routeKeys.lists(), vpsId] as const,
};

export function useRoutes(vpsId: string) {
  return useQuery({
    queryKey: routeKeys.list(vpsId),
    queryFn: () => apiClient.listRoutes(vpsId),
    select: (data) => data.data,
    enabled: !!vpsId,
  });
}

export function useCreateRoute(vpsId: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: (data: CreateRouteRequest) =>
      apiClient.createRoute(vpsId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: routeKeys.list(vpsId) });
      toast({
        title: "Route created",
        description: "L4 forwarding route has been added.",
        variant: "success",
      });
    },
    onError: (error) => {
      toast({
        title: "Failed to create route",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useDeleteRoute(vpsId: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: (routeId: string) => apiClient.deleteRoute(vpsId, routeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: routeKeys.list(vpsId) });
      toast({
        title: "Route deleted",
        description: "L4 forwarding route has been removed.",
        variant: "success",
      });
    },
    onError: (error) => {
      toast({
        title: "Failed to delete route",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}
