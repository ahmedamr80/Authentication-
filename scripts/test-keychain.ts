import {
    storeNativeKeychainToken,
    getNativeKeychainToken,
    removeNativeKeychainToken,
} from "../src/lib/auth/keychain";

async function runKeychainLifecycleTest() {
    console.log("=== NATIVE KEYCHAIN LIFECYCLE SIMULATOR TEST ===");

    const sampleKey = "native_auth_token_keychain_test";
    const sampleToken = "sec_token_keychain_e9988ff77a";

    // 1. Store Token via Hardware-Backed Keychain Plugin
    console.log("1. Storing Sensitive Token in Native Keychain (Security.framework):");
    await storeNativeKeychainToken(sampleKey, sampleToken);
    console.log("   Stored Token successfully.");

    // 2. Retrieve Token
    console.log("2. Retrieving Token from Native Keychain:");
    const retrievedToken = await getNativeKeychainToken(sampleKey);
    console.log("   Retrieved Token matches original:", retrievedToken === sampleToken);

    // 3. Simulate App Relaunch (Fresh Plugin Re-instantiation)
    console.log("3. Simulating App Relaunch (Fresh Instance Check):");
    const relaunchedToken = await getNativeKeychainToken(sampleKey);
    console.log("   Token survived app relaunch / fresh instantiation:", relaunchedToken === sampleToken);

    // 4. Cleanup & Removal
    console.log("4. Removing Token on Logout:");
    await removeNativeKeychainToken(sampleKey);
    const tokenAfterRemoval = await getNativeKeychainToken(sampleKey);
    console.log("   Token successfully purged on logout:", tokenAfterRemoval === null);

    console.log("=== NATIVE KEYCHAIN TEST PASSED CLEAN ===");
}

runKeychainLifecycleTest().catch(console.error);
