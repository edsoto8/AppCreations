import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="text-muted-foreground">
        That page does not exist.{' '}
        <Link to="/" className="font-medium text-primary underline underline-offset-4">
          Go to the dashboard
        </Link>
      </p>
    </div>
  );
}
