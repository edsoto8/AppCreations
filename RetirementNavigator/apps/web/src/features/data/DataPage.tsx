import { HardDrive, ShieldCheck, WifiOff } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export function DataPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Data &amp; Privacy</h1>
        <p className="max-w-2xl text-muted-foreground">How Retirement Navigator handles your information.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <HardDrive aria-hidden="true" className="size-4" /> Stored on this device, unencrypted
            </CardTitle>
            <CardDescription>
              Profiles, scenarios and settings are saved in your browser’s IndexedDB storage on this device. They are
              not encrypted. Anyone with access to this browser profile can read them.
            </CardDescription>
          </CardHeader>
          <CardContent />
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <WifiOff aria-hidden="true" className="size-4" /> Nothing leaves your device
            </CardTitle>
            <CardDescription>
              The app makes no network requests with your data. There is no account, no analytics, no telemetry and no
              remote fonts. A content security policy blocks outbound connections.
            </CardDescription>
          </CardHeader>
          <CardContent />
        </Card>
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              <ShieldCheck aria-hidden="true" className="size-4" /> Export, import and delete
              <Badge variant="outline">Planned for M7b</Badge>
            </CardTitle>
            <CardDescription>
              JSON export and import, CSV export of forecasts and a “delete all my data” control arrive in a later
              milestone.
            </CardDescription>
          </CardHeader>
          <CardContent />
        </Card>
      </div>
    </div>
  );
}
