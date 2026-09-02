import { createBrowserRouter } from "react-router";
import { CareNearMePage } from "../routes/CareNearMePage";
import { CheckInsPage } from "../routes/profile/CheckInsPage";
import { HistoryPage } from "../routes/profile/HistoryPage";
import { ProfilePage } from "../routes/profile/ProfilePage";
import { PrivacyPage } from "../routes/settings/PrivacyPage";
import { HomePage } from "../routes/HomePage";
import { NewSessionPage } from "../routes/session/NewSessionPage";
import { SessionPage } from "../routes/session/SessionPage";
import { SummaryPage } from "../routes/session/SummaryPage";

export const router = createBrowserRouter([
  { path: "/", element: <HomePage /> },
  { path: "/session/new", element: <NewSessionPage /> },
  { path: "/session/:sessionId", element: <SessionPage /> },
  { path: "/session/:sessionId/summary", element: <SummaryPage /> },
  { path: "/profile", element: <ProfilePage /> },
  { path: "/profile/history", element: <HistoryPage /> },
  { path: "/profile/check-ins", element: <CheckInsPage /> },
  { path: "/care-near-me", element: <CareNearMePage /> },
  { path: "/settings/privacy", element: <PrivacyPage /> },
]);
