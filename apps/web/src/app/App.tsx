import { RouterProvider } from "react-router";
import { RouteErrorBoundary } from "./ErrorBoundary";
import { AppProviders } from "./providers";
import { router } from "./router";

export function App() {
  return (
    <AppProviders>
      <RouteErrorBoundary>
        <RouterProvider router={router} />
      </RouteErrorBoundary>
    </AppProviders>
  );
}
