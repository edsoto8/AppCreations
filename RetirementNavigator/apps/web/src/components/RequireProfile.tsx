import { Link } from 'react-router';
import type { Household } from '@rn/engine';
import { useActiveProfile } from '@/state/profileStore';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/** Renders `children(household)` for the active profile, or a prompt to create one. */
export function RequireProfile({ children }: { children: (household: Household) => React.ReactNode }) {
  const profile = useActiveProfile();
  if (!profile) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No profile yet</CardTitle>
          <CardDescription>Create a profile, or start from a sample, to use this page.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link to="/welcome">Get started</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }
  return <>{children(profile.household)}</>;
}
