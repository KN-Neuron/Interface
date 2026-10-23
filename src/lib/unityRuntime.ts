export interface UnityInstance {
  SendMessage(objectName: string, methodName: string, value?: string | number): void;
  Quit(): Promise<void>;
}

type UnityFactory = (
  canvas: HTMLCanvasElement,
  config: Record<string, unknown>,
  onProgress?: (progress: number) => void,
) => Promise<UnityInstance>;

declare global {
  interface Window {
    createUnityInstance?: UnityFactory;
  }
}

interface UnityManifest {
  ready: boolean;
  loader?: string;
  data?: string;
  framework?: string;
  code?: string;
  symbols?: string | null;
  streamingAssets?: string | null;
  companyName?: string;
  productName?: string;
  productVersion?: string;
}

export class UnityBuildMissingError extends Error {}

// Unity's generated loaders share a global factory. Serialize startup/teardown
// and load the selected game's factory afresh rather than reusing another game.
let previousRuntime = Promise.resolve();

export async function loadUnityRuntime(
  canvas: HTMLCanvasElement,
  baseUrl: string,
  signal: AbortSignal,
  onProgress: (progress: number) => void,
  configuration: Record<string, unknown> = {},
): Promise<UnityInstance> {
  const previous = previousRuntime;
  let release!: () => void;
  previousRuntime = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  const script = document.createElement("script");
  try {
    signal.throwIfAborted();
    if (!canvas.id) canvas.id = `kneuron-unity-${crypto.randomUUID()}`;
    const response = await fetch(`${baseUrl}/manifest.json`, { cache: "no-store", signal });
    if (!response.ok) throw new Error(`Unity manifest could not be loaded (${response.status}).`);
    const manifest = (await response.json()) as UnityManifest;
    if (!manifest.ready) throw new UnityBuildMissingError("Unity assets have not been installed.");
    const asset = (path: string | null | undefined): string => {
      if (
        !path ||
        path.startsWith("/") ||
        path.includes("..") ||
        !/^[a-zA-Z0-9_./-]+$/.test(path)
      ) {
        throw new Error("Unity manifest contains an invalid asset path.");
      }
      return `${baseUrl}/${path}`;
    };
    // Validate the entire manifest before running its loader.
    const config: Record<string, unknown> = {
      ...configuration,
      dataUrl: asset(manifest.data),
      frameworkUrl: asset(manifest.framework),
      codeUrl: asset(manifest.code),
      streamingAssetsUrl: asset(manifest.streamingAssets ?? "StreamingAssets"),
      companyName: manifest.companyName ?? "KNeuron",
      productName: manifest.productName ?? "Unity module",
      productVersion: manifest.productVersion ?? "1.0",
      matchWebGLToCanvasSize: true,
      devicePixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    };
    if (manifest.symbols) config.symbolsUrl = asset(manifest.symbols);
    const loaderUrl = asset(manifest.loader);
    const factory = await new Promise<UnityFactory>((resolve, reject) => {
      const loader = script;
      const abort = () => {
        loader.remove();
        reject(signal.reason);
      };
      const finish = () => signal.removeEventListener("abort", abort);
      loader.src = loaderUrl;
      loader.async = true;
      loader.dataset.kneuronUnityLoader = baseUrl;
      loader.onload = () => {
        finish();
        if (!window.createUnityInstance) reject(new Error("Unity loader API is unavailable."));
        else resolve(window.createUnityInstance);
      };
      loader.onerror = () => {
        finish();
        reject(new Error("Unity loader failed to load."));
      };
      signal.addEventListener("abort", abort, { once: true });
      signal.throwIfAborted();
      window.createUnityInstance = undefined;
      document.body.appendChild(loader);
    });
    signal.throwIfAborted();
    const instance = await factory(canvas, config, (progress) => {
      if (!signal.aborted) onProgress(progress);
    });
    if (signal.aborted) {
      await instance.Quit();
      signal.throwIfAborted();
    }
    let quitting: Promise<void> | null = null;
    return {
      SendMessage: (...args) => instance.SendMessage(...args),
      Quit: () => {
        quitting ??= Promise.resolve()
          .then(() => instance.Quit())
          .finally(() => {
            script?.remove();
            release();
          });
        return quitting;
      },
    };
  } catch (error) {
    script?.remove();
    release();
    throw error;
  }
}
