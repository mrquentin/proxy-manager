import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { apiClient } from "../api-client";
import { useToast } from "@/hooks/use-toast";
import type { CreateVpsRequest } from "@proxy-manager/shared";

export const vpsKeys = {
  all: ["vps"] as const,
  lists: () => [...vpsKeys.all, "list"] as const,
  list: () => [...vpsKeys.lists()] as const,
  details: () => [...vpsKeys.all, "detail"] as const,
  detail: (id: string) => [...vpsKeys.details(), id] as const,
  status: (id: string) => [...vpsKeys.all, "status", id] as const,
};

export function useVpsList() {
  return useQuery({
    queryKey: vpsKeys.list(),
    queryFn: () => apiClient.listVps(),
    select: (data) => data.data,
  });
}

export function useVpsDetail(id: string) {
  return useQuery({
    queryKey: vpsKeys.detail(id),
    queryFn: () => apiClient.getVps(id),
    select: (data) => data.data,
    enabled: !!id,
  });
}

export function useVpsStatus(id: string) {
  return useQuery({
    queryKey: vpsKeys.status(id),
    queryFn: () => apiClient.getVpsStatus(id),
    select: (data) => data.data,
    enabled: !!id,
    refetchInterval: 30_000,
  });
}

export function useCreateVps() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: (data: CreateVpsRequest) => apiClient.createVps(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: vpsKeys.lists() });
      toast({ title: "VPS added", description: "VPS instance registered successfully.", variant: "success" });
    },
    onError: (error) => {
      toast({ title: "Failed to add VPS", description: error.message, variant: "destructive" });
    },
  });
}

export function useDeleteVps() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: (id: string) => apiClient.deleteVps(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: vpsKeys.lists() });
      toast({ title: "VPS removed", description: "VPS instance has been removed.", variant: "success" });
    },
    onError: (error) => {
      toast({ title: "Failed to remove VPS", description: error.message, variant: "destructive" });
    },
  });
}

export function useReconcileVps() {
  const { toast } = useToast();

  return useMutation({
    mutationFn: (id: string) => apiClient.reconcileVps(id),
    onSuccess: () => {
      toast({ title: "Reconciliation triggered", description: "Manual reconciliation has been started.", variant: "success" });
    },
    onError: (error) => {
      toast({ title: "Reconciliation failed", description: error.message, variant: "destructive" });
    },
  });
}
