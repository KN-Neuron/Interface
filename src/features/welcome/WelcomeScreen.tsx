import { CONTRIBUTORS } from "../../config/contributors";

import "./welcome.css";

export function WelcomeScreen() {
  return (
    <main className="welcome-screen">
      <div className="welcome-screen__content">
        <h1>KNeuron</h1>

        <div className="welcome-screen__contributors">
          {CONTRIBUTORS.map((contributor) => (
            <span key={contributor.name} className="welcome-screen__contributor">
              {contributor.name}
            </span>
          ))}
        </div>
      </div>
    </main>
  );
}
