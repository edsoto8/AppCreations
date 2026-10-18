import { Monitor, Moon, Sun } from 'lucide-react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useSettingsStore, type ThemePreference } from '@/state/settingsStore';

export function ThemeToggle() {
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  return (
    <ToggleGroup
      type="single"
      value={theme}
      onValueChange={(value: string) => {
        if (value) setTheme(value as ThemePreference);
      }}
      aria-label="Color theme"
    >
      <ToggleGroupItem value="light" aria-label="Light theme">
        <Sun aria-hidden="true" />
      </ToggleGroupItem>
      <ToggleGroupItem value="dark" aria-label="Dark theme">
        <Moon aria-hidden="true" />
      </ToggleGroupItem>
      <ToggleGroupItem value="system" aria-label="Use system theme">
        <Monitor aria-hidden="true" />
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
