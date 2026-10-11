import { CONTRIBUTORS } from "../../config/contributors";
import { BrainLogo } from "../../components/BrainLogo";
import "./welcome.css";

export function WelcomeScreen() {
  return (
    <main className="welcome-screen">
      <div className="welcome-screen__content">
        <div className="welcome-screen__logo">
          <BrainLogo size={300} />
        </div>
        <h1>Neuron</h1>

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
