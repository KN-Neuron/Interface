import { CONTRIBUTORS } from "../../config/contributors";

import "./welcome.css";

/**
 * EEG-like trace drawn once under the title while the app starts.
 */
const TRACE_PATH =
  "M0 30 L40 30 L52 28 L60 33 L72 22 L80 36 L92 30 L120 30 L128 18 L134 44 L140 8 L148 50 L156 26 L164 32 L200 30 L214 27 L222 34 L236 24 L246 31 L280 30";

export function WelcomeScreen() {
  return (
    <main className="welcome-screen">
      <div className="welcome-screen__content">
        <h1>KNeuron</h1>

        <svg
          className="welcome-screen__trace"
          viewBox="0 0 280 60"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path d={TRACE_PATH} pathLength={1} />
        </svg>

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
