import { useTranslation } from "react-i18next";
import { Link } from "react-router";

export function HomePage() {
  const { t } = useTranslation();
  return (
    <main>
      <h1>Kazi, Kabla ya Daktari</h1>
      <p>Web shell is scaffolded. Conversation UI is not implemented.</p>
      <p>
        <Link to="/session/new">Start session route</Link>
        {" · "}
        <Link to="/voice">{t("voice.title")}</Link>
        {" · "}
        <Link to="/profile/history">{t("history.title")}</Link>
        {" · "}
        <Link to="/settings/privacy">{t("privacy.settings")}</Link>
      </p>
    </main>
  );
}
