import { Link } from "react-router";

export function HomePage() {
  return (
    <main>
      <h1>Kazi, Kabla ya Daktari</h1>
      <p>Web shell is scaffolded. Conversation UI is not implemented.</p>
      <p>
        <Link to="/session/new">Start session route</Link>
      </p>
    </main>
  );
}
