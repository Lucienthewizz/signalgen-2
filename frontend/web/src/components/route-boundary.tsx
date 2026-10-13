import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export function RouteLoading() {
  return (
    <div className="route-loading" role="status" aria-label="Loading page">
      <p>Loading page…</p>
      <Skeleton />
      <Skeleton />
      <Skeleton />
    </div>
  );
}

export class RouteBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <section className="route-loading" role="alert">
          <h2>This page could not be loaded</h2>
          <p>Your session is retained. Reload to get the latest page files.</p>
          <Button onClick={() => location.reload()}>Reload page</Button>
        </section>
      );
    return this.props.children;
  }
}
