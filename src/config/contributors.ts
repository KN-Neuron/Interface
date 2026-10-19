export interface Contributor {
  name: string;
  role?: string;
}

export const CONTRIBUTORS: readonly Contributor[] = [
  {
    name: "Kacper Szmigielski",
    role: "Creative Director / Software Engineer",
  },
  {
    name: "Michał Szandarowski",
    role: "Software Engineer / Neurostate integration",
  },
];
