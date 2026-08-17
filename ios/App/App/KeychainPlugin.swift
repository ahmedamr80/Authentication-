import Foundation
import Security
import Capacitor

/**
 * Native iOS Swift Keychain Plugin
 * Wraps Apple Security.framework (kSecClassGenericPassword)
 * Enforces hardware-backed encryption via Secure Enclave and kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
 * to ensure sensitive auth tokens are never stored in NSUserDefaults or unencrypted iCloud/iTunes backups.
 */
@objc(KeychainPlugin)
public class KeychainPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "KeychainPlugin"
    public let jsName = "KeychainPlugin"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "set", returnType: CAPPluginMethodReturnPromise),
        CAPPluginMethod(name: "get", returnType: CAPPluginMethodReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginMethodReturnPromise)
    ]

    @objc func set(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), let value = call.getString("value") else {
            call.reject("Key and value are required.")
            return
        }

        guard let valueData = value.data(using: .utf8) else {
            call.reject("Failed to encode token value to UTF-8.")
            return
        }

        // 1. Prepare query to delete any existing item
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecAttrService as String: Bundle.main.bundleIdentifier ?? "com.everywherepadel.app"
        ]

        SecItemDelete(query as CFDictionary)

        // 2. Prepare query to add new secure item to Keychain
        let attributes: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecAttrService as String: Bundle.main.bundleIdentifier ?? "com.everywherepadel.app",
            kSecValueData as String: valueData,
            // CRITICAL: Hardware-backed encryption; excluded from device backups!
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        ]

        let status = SecItemAdd(attributes as CFDictionary, nil)

        if status == errSecSuccess {
            call.resolve(["success": true])
        } else {
            call.reject("Keychain write failed with OSStatus: \(status)")
        }
    }

    @objc func get(_ call: CAPPluginCall) {
        guard let key = call.getString("key") else {
            call.reject("Key is required.")
            return
        }

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecAttrService as String: Bundle.main.bundleIdentifier ?? "com.everywherepadel.app",
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]

        var dataTypeRef: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &dataTypeRef)

        if status == errSecSuccess, let data = dataTypeRef as? Data, let value = String(data: data, encoding: .utf8) {
            call.resolve(["value": value])
        } else if status == errSecItemNotFound {
            call.resolve(["value": NSNull()])
        } else {
            call.reject("Keychain read failed with OSStatus: \(status)")
        }
    }

    @objc func remove(_ call: CAPPluginCall) {
        guard let key = call.getString("key") else {
            call.reject("Key is required.")
            return
        }

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecAttrService as String: Bundle.main.bundleIdentifier ?? "com.everywherepadel.app"
        ]

        let status = SecItemDelete(query as CFDictionary)

        if status == errSecSuccess || status == errSecItemNotFound {
            call.resolve(["success": true])
        } else {
            call.reject("Keychain delete failed with OSStatus: \(status)")
        }
    }
}
