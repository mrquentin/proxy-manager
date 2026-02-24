import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { apiClient } from "../api-client";
import { useToast } from "@/hooks/use-toast";
import type {
  CreateTunnelRequest,
  UpdateRotationPolicyRequest,
} from "@proxy-manager/shared";

export const tunnelKeys = {
  all: ["tunnels"] as const,
  lists: () => [...tunnelKeys.all, "list"] as const,
  list: (vpsId: string) => [...tunnelKeys.lists(), vpsId] as const,
  rotationPolicy: (vpsId: string, tunnelId: string) =>
    [...tunnelKeys.all, "rotation-policy", vpsId, tunnelId] as const,
};

export function useTunnels(vpsId: string) {
  return useQuery({
    queryKey: tunnelKeys.list(vpsId),
    queryFn: () => apiClient.listTunnels(vpsId),
    select: (data) => data.data,
    enabled: !!vpsId,
  });
}

export function useCreateTunnel(vpsId: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: (data: CreateTunnelRequest) =>
      apiClient.createTunnel(vpsId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tunnelKeys.list(vpsId) });
      toast({
        title: "Tunnel created",
        description: "WireGuard tunnel has been created successfully.",
        variant: "success",
      });
    },
    onError: (error) => {
      toast({
        title: "Failed to create tunnel",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useDeleteTunnel(vpsId: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: (tunnelId: string) => apiClient.deleteTunnel(vpsId, tunnelId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tunnelKeys.list(vpsId) });
      toast({
        title: "Tunnel deleted",
        description: "WireGuard tunnel has been removed.",
        variant: "success",
      });
    },
    onError: (error) => {
      toast({
        title: "Failed to delete tunnel",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useRotateTunnel(vpsId: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: (tunnelId: string) => apiClient.rotateTunnel(vpsId, tunnelId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tunnelKeys.list(vpsId) });
      toast({
        title: "Tunnel rotated",
        description:
          "Keys have been rotated. Download the new config before the grace period expires.",
        variant: "success",
      });
    },
    onError: (error) => {
      toast({
        title: "Failed to rotate tunnel",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useRotationPolicy(vpsId: string, tunnelId: string) {
  return useQuery({
    queryKey: tunnelKeys.rotationPolicy(vpsId, tunnelId),
    queryFn: () => apiClient.getRotationPolicy(vpsId, tunnelId),
    enabled: !!vpsId && !!tunnelId,
  });
}

export function useUpdateRotationPolicy(vpsId: string, tunnelId: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: (data: UpdateRotationPolicyRequest) =>
      apiClient.updateRotationPolicy(vpsId, tunnelId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: tunnelKeys.rotationPolicy(vpsId, tunnelId),
      });
      toast({
        title: "Rotation policy updated",
        description: "Tunnel rotation policy has been saved.",
        variant: "success",
      });
    },
    onError: (error) => {
      toast({
        title: "Failed to update rotation policy",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}
