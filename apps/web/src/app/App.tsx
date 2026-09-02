import { RouterProvider } from "react-router";
import { useTranslation } from "react-i18next";
import { RouteErrorBoundary } from "./ErrorBoundary";
import { AppProviders } from "./providers";
import { router } from "./router";

export function App() {
  const { t } = useTranslation();
  return (
    <AppProviders>
      <div className="diagnosis-banner" role="status">
        <span className="diagnosis-banner-dot" aria-hidden="true" />
        {t("voice.notADiagnosis")}
      </div>
      <RouteErrorBoundary>
        <RouterProvider router={router} />
      </RouteErrorBoundary>
    </AppProviders>
  );
}
