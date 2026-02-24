import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { apiClient } from "../api-client";
import { useToast } from "@/hooks/use-toast";
import type { CreateFirewallRuleRequest } from "@proxy-manager/shared";

export const firewallKeys = {
  all: ["firewall"] as const,
  lists: () => [...firewallKeys.all, "list"] as const,
  list: (vpsId: string) => [...firewallKeys.lists(), vpsId] as const,
};

export function useFirewallRules(vpsId: string) {
  return useQuery({
    queryKey: firewallKeys.list(vpsId),
    queryFn: () => apiClient.listFirewallRules(vpsId),
    select: (data) => data.data,
    enabled: !!vpsId,
  });
}

export function useCreateFirewallRule(vpsId: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: (data: CreateFirewallRuleRequest) =>
      apiClient.createFirewallRule(vpsId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: firewallKeys.list(vpsId) });
      toast({
        title: "Firewall rule created",
        description: "Dynamic firewall rule has been added.",
        variant: "success",
      });
    },
    onError: (error) => {
      toast({
        title: "Failed to create firewall rule",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useDeleteFirewallRule(vpsId: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: (ruleId: string) =>
      apiClient.deleteFirewallRule(vpsId, ruleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: firewallKeys.list(vpsId) });
      toast({
        title: "Firewall rule deleted",
        description: "Dynamic firewall rule has been removed.",
        variant: "success",
      });
    },
    onError: (error) => {
      toast({
        title: "Failed to delete firewall rule",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}
