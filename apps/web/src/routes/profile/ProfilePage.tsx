import { useTranslation } from "react-i18next";
import { Link } from "react-router";

export function ProfilePage() {
  const { t } = useTranslation();
  return (
    <main>
      <p className="voice-kicker">
        <Link to="/">{t("voice.home")}</Link>
      </p>
      <h1>Profile</h1>
      <p>
        <Link to="/profile/history">{t("history.title")}</Link>
        {" · "}
        <Link to="/settings/privacy">{t("privacy.settings")}</Link>
      </p>
    </main>
  );
}
