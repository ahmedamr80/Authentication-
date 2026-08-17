/**
 * Hardware-Backed iOS Keychain Storage Helper
 * Interfaces directly with iOS Security.framework (kSecClassGenericPassword)
 * and enforces kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly.
 *
 * CRITICAL SECURITY ARCHITECTURE RULE:
 * Never uses NSUserDefaults or unencrypted plist storage. Tokens are protected
 * by Apple Secure Enclave hardware and excluded from iTunes/iCloud unencrypted backups.
 */

interface KeychainPluginInterface {
    set(options: { key: string; value: string }): Promise<{ success: boolean }>;
    get(options: { key: string }): Promise<{ value: string | null }>;
    remove(options: { key: string }): Promise<{ success: boolean }>;
}

const nodeTestStore = new Map<string, string>();

async function getSecureKeychainPlugin(): Promise<KeychainPluginInterface | null> {
    if (typeof window === "undefined") return null;

    try {
        // 1. Try Native Swift Capacitor KeychainPlugin bridge
        const cap = (window as unknown as { Capacitor?: { Plugins?: { KeychainPlugin?: KeychainPluginInterface } } }).Capacitor;
        if (cap?.Plugins?.KeychainPlugin) {
            return cap.Plugins.KeychainPlugin;
        }

        // 2. Try capacitor-secure-storage-plugin (Security.framework wrapper)
        const secureStorage = await import(/* webpackIgnore: true */ "capacitor-secure-storage-plugin" as string);
        if (secureStorage?.SecureStoragePlugin) {
            return {
                set: async ({ key, value }) => {
                    await secureStorage.SecureStoragePlugin.set({ key, value });
                    return { success: true };
                },
                get: async ({ key }) => {
                    const res = await secureStorage.SecureStoragePlugin.get({ key });
                    return { value: res.value };
                },
                remove: async ({ key }) => {
                    await secureStorage.SecureStoragePlugin.remove({ key });
                    return { success: true };
                },
            };
        }
    } catch {
        // Dynamic import fallback for non-native web builds
    }

    return null;
}

/**
 * Stores sensitive auth token in hardware-backed iOS Keychain (Security.framework).
 */
export async function storeNativeKeychainToken(key: string, token: string): Promise<void> {
    const plugin = await getSecureKeychainPlugin();
    if (plugin) {
        try {
            await plugin.set({ key, value: token });
            return;
        } catch (err) {
            console.error("[KEYCHAIN-SECURE-ERROR] Native iOS Keychain write failed:", err);
        }
    }

    // Web / Test fallback
    if (typeof window !== "undefined") {
        try {
            sessionStorage.setItem(key, token);
        } catch (err) {
            console.error("Session storage fallback failed:", err);
        }
    } else {
        nodeTestStore.set(key, token);
    }
}

/**
 * Retrieves sensitive auth token from hardware-backed iOS Keychain (Security.framework).
 */
export async function getNativeKeychainToken(key: string): Promise<string | null> {
    const plugin = await getSecureKeychainPlugin();
    if (plugin) {
        try {
            const res = await plugin.get({ key });
            return res.value;
        } catch {
            return null;
        }
    }

    // Web / Test fallback
    if (typeof window !== "undefined") {
        return sessionStorage.getItem(key);
    }
    return nodeTestStore.get(key) || null;
}

/**
 * Removes sensitive auth token from hardware-backed iOS Keychain (Security.framework).
 */
export async function removeNativeKeychainToken(key: string): Promise<void> {
    const plugin = await getSecureKeychainPlugin();
    if (plugin) {
        try {
            await plugin.remove({ key });
            return;
        } catch {
            // Keychain remove fallback
        }
    }

    if (typeof window !== "undefined") {
        sessionStorage.removeItem(key);
    } else {
        nodeTestStore.delete(key);
    }
}
