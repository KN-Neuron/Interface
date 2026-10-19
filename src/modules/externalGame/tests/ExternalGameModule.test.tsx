import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GameInstallProgress, InstalledGame } from "../../../core/games/gameProcess";
import { validateModuleManifest } from "../../../lib/moduleValidation";
import { neurorunManifest } from "../../neurorun/neurorunModuleDefinition";
import { neurosniperManifest } from "../../neurosniper/neurosniperModuleDefinition";
import { ExternalGameModule } from "../ExternalGameModule";
import type { ExternalGame } from "../externalGame";

const gameProcess = vi.hoisted(() => ({
  launchGame: vi.fn(),
  stopGame: vi.fn(),
  isGameRunning: vi.fn(),
  onGameExited: vi.fn(),
  chooseGameExecutable: vi.fn(),
  getInstalledGame: vi.fn(),
  getLatestGameRelease: vi.fn(),
  installLatestGame: vi.fn(),
  onGameInstallProgress: vi.fn(),
}));

vi.mock("../../../core/games/gameProcess", () => ({
  ...gameProcess,
  GAME_EXECUTABLE_EXTENSION: "x86_64",
}));

const GAME: ExternalGame = {
  id: "neurosniper",
  name: "Neurosniper",
  repository: "KN-Neuron/Neurosniper",
  controls: [{ metric: "attention", effect: "Steadier aim." }],
};

const RELEASE_1_1 = {
  version: "v1.1.0",
  assetName: "Neurosniper-linux-x86_64-v1.1.0.tar.gz",
  size: 73_700_000,
  pageUrl: "https://github.com/KN-Neuron/Neurosniper/releases/tag/v1.1.0",
};

const INSTALLED_1_0: InstalledGame = {
  version: "v1.0.0",
  executable: "/data/games/neurosniper/v1.0.0/Neurosniper/Neurosniper.x86_64",
};

const INSTALLED_1_1: InstalledGame = {
  version: "v1.1.0",
  executable: "/data/games/neurosniper/v1.1.0/Neurosniper/Neurosniper.x86_64",
};

const LOCAL_BUILD = "/builds/Neurosniper/Neurosniper.x86_64";

function renderModule() {
  return render(<ExternalGameModule game={GAME} onRequestClose={vi.fn()} />);
}

async function playButton(): Promise<HTMLElement> {
  const play = await screen.findByRole("button", { name: /PLAY/u });
  await waitFor(() => expect(play).toBeEnabled());
  return play;
}

describe("ExternalGameModule", () => {
  beforeEach(() => {
    window.localStorage.clear();
    gameProcess.isGameRunning.mockResolvedValue(false);
    gameProcess.onGameExited.mockResolvedValue(() => undefined);
    gameProcess.onGameInstallProgress.mockResolvedValue(() => undefined);
    gameProcess.launchGame.mockResolvedValue(4242);
    gameProcess.stopGame.mockResolvedValue(undefined);
    gameProcess.getInstalledGame.mockResolvedValue(null);
    gameProcess.getLatestGameRelease.mockResolvedValue(RELEASE_1_1);
    gameProcess.installLatestGame.mockResolvedValue(INSTALLED_1_1);
  });

  it("offers to download the latest release when none is installed", async () => {
    renderModule();

    expect(
      await screen.findByText("PLAY downloads v1.1.0 (74 MB) from KN-Neuron/Neurosniper."),
    ).toBeInTheDocument();
    expect(await playButton()).toBeEnabled();
  });

  it("installs the latest release, then plays it", async () => {
    renderModule();

    fireEvent.click(await playButton());

    await waitFor(() =>
      expect(gameProcess.launchGame).toHaveBeenCalledWith("neurosniper", INSTALLED_1_1.executable),
    );
    expect(gameProcess.installLatestGame).toHaveBeenCalledWith("neurosniper");
    expect(await screen.findByRole("button", { name: /QUIT GAME/u })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: /QUIT GAME/u }));
    expect(gameProcess.stopGame).toHaveBeenCalledWith("neurosniper");
  });

  it("says when PLAY will update the installed release", async () => {
    gameProcess.getInstalledGame.mockResolvedValue(INSTALLED_1_0);
    renderModule();

    expect(
      await screen.findByText("v1.0.0 installed. PLAY first downloads v1.1.0 (74 MB)."),
    ).toBeInTheDocument();
  });

  it("shows the download's progress", async () => {
    let report: ((progress: GameInstallProgress) => void) | null = null;
    gameProcess.onGameInstallProgress.mockImplementation(async (listener) => {
      report = listener;
      return () => undefined;
    });
    gameProcess.installLatestGame.mockReturnValue(new Promise(() => undefined));
    renderModule();

    fireEvent.click(await playButton());
    expect(await screen.findByRole("button", { name: /CHECKING FOR UPDATES/u })).toBeDisabled();

    act(() => {
      report?.({ gameId: "neurosniper", phase: "downloading", downloaded: 50, total: 100 });
    });
    expect(screen.getByRole("button", { name: /DOWNLOADING 50%/u })).toBeDisabled();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");

    act(() => {
      report?.({ gameId: "neurosniper", phase: "unpacking", downloaded: 100, total: 100 });
    });
    expect(screen.getByRole("button", { name: /UNPACKING/u })).toBeDisabled();
  });

  it("plays the installed release when GitHub can't be reached", async () => {
    gameProcess.getInstalledGame.mockResolvedValue(INSTALLED_1_0);
    gameProcess.getLatestGameRelease.mockRejectedValue(new Error("Could not reach GitHub"));
    gameProcess.installLatestGame.mockRejectedValue(new Error("Could not reach GitHub"));
    renderModule();

    expect(
      await screen.findByText(
        "Couldn't check for a newer release (Could not reach GitHub). PLAY starts the installed v1.0.0.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(await playButton());

    await waitFor(() =>
      expect(gameProcess.launchGame).toHaveBeenCalledWith("neurosniper", INSTALLED_1_0.executable),
    );
  });

  it("explains a failed install when nothing is installed", async () => {
    gameProcess.installLatestGame.mockRejectedValue(
      new Error("Neurosniper-linux-x86_64-v1.1.0.tar.gz is corrupted."),
    );
    renderModule();

    fireEvent.click(await playButton());

    expect(
      await screen.findAllByText("Neurosniper-linux-x86_64-v1.1.0.tar.gz is corrupted."),
    ).not.toHaveLength(0);
    expect(gameProcess.launchGame).not.toHaveBeenCalled();
  });

  it("plays a chosen local build instead of releases", async () => {
    gameProcess.chooseGameExecutable.mockResolvedValue(LOCAL_BUILD);
    renderModule();

    const choose = await screen.findByRole("button", { name: /LOCAL BUILD/u });
    await waitFor(() => expect(choose).toBeEnabled());
    fireEvent.click(choose);

    expect(await screen.findByText("/builds/Neurosniper/")).toBeInTheDocument();
    expect(window.localStorage.getItem("kneuron.games.neurosniper.localBuild")).toBe(LOCAL_BUILD);

    fireEvent.click(await playButton());
    expect(gameProcess.launchGame).toHaveBeenCalledWith("neurosniper", LOCAL_BUILD);
    expect(gameProcess.installLatestGame).not.toHaveBeenCalled();
  });

  it("goes back to releases", async () => {
    window.localStorage.setItem("kneuron.games.neurosniper.localBuild", LOCAL_BUILD);
    renderModule();

    const useReleases = await screen.findByRole("button", { name: /USE RELEASES/u });
    await waitFor(() => expect(useReleases).toBeEnabled());
    fireEvent.click(useReleases);

    expect(await screen.findByText(/PLAY downloads v1.1.0/u)).toBeInTheDocument();
    expect(window.localStorage.getItem("kneuron.games.neurosniper.localBuild")).toBeNull();
  });

  it("forgets the executable remembered before releases were installed", async () => {
    window.localStorage.setItem("kneuron.games.neurosniper.executable", LOCAL_BUILD);
    renderModule();

    expect(await screen.findByText(/PLAY downloads v1.1.0/u)).toBeInTheDocument();
    expect(window.localStorage.getItem("kneuron.games.neurosniper.executable")).toBeNull();
  });

  it("shows why the game could not start", async () => {
    gameProcess.launchGame.mockRejectedValue(new Error("Neurosniper.x86_64 is not executable."));
    renderModule();

    fireEvent.click(await playButton());

    expect(await screen.findByText("Neurosniper.x86_64 is not executable.")).toBeInTheDocument();
  });

  it("picks up a game that is still running from before", async () => {
    gameProcess.isGameRunning.mockResolvedValue(true);
    renderModule();

    expect(await screen.findByRole("button", { name: /QUIT GAME/u })).toBeEnabled();
  });

  it("explains that a cap is needed for brain control", async () => {
    renderModule();

    expect(await screen.findByText(/Connect an EEG cap on the Device page/u)).toBeInTheDocument();
    expect(screen.getByText("None connected")).toBeInTheDocument();
  });
});

describe("native game manifests", () => {
  it.each([neurosniperManifest, neurorunManifest])("$id is valid", (manifest) => {
    expect(validateModuleManifest(manifest)).toEqual({ valid: true, errors: [] });
  });
});
