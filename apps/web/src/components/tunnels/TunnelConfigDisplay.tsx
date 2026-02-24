import { useState } from "react";
import { Copy, Download, Check, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

interface TunnelConfigDisplayProps {
  config: string;
  qrCodeUrl?: string;
}

export function TunnelConfigDisplay({
  config,
  qrCodeUrl,
}: TunnelConfigDisplayProps) {
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const { toast } = useToast();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(config);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({
        title: "Copied",
        description: "Configuration copied to clipboard.",
        variant: "success",
      });
    } catch {
      toast({
        title: "Copy failed",
        description: "Unable to copy to clipboard. Please copy manually.",
        variant: "destructive",
      });
    }
  };

  const handleDownload = () => {
    const blob = new Blob([config], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "wg-tunnel.conf";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
      <div className="relative">
        <pre className="overflow-auto rounded-md bg-muted p-4 text-xs font-mono max-h-64">
          {config}
        </pre>
        <div className="absolute right-2 top-2 flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleCopy}
            title="Copy to clipboard"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-green-500" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </div>

      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={handleDownload}>
          <Download className="mr-2 h-4 w-4" />
          Download .conf
        </Button>
        {qrCodeUrl && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowQr(!showQr)}
          >
            <QrCode className="mr-2 h-4 w-4" />
            {showQr ? "Hide QR" : "Show QR"}
          </Button>
        )}
      </div>

      {showQr && qrCodeUrl && (
        <div className="flex justify-center rounded-md border bg-white p-4">
          <img
            src={qrCodeUrl}
            alt="WireGuard config QR code"
            className="h-48 w-48"
          />
        </div>
      )}
    </div>
  );
}
