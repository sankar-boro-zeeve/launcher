
import { provider as nativeProvider } from "./native";

export const Providers = new Map();
Providers.set("native", nativeProvider);

export function getProvider(provider: string) {
  if (!Providers.has(provider)) {
    throw new Error(
      "Invalid provider config. You must one of: " +
        Array.from(Providers.keys()).join(", "),
    );
  }

  return Providers.get(provider);
}
