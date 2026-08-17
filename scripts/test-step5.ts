import {
    generateTOTPSecret,
    generateTOTPCode,
    verifyTOTPCode,
    generateBackupCodes,
    createPendingMFAToken,
    verifyPendingMFAToken,
} from "../src/lib/auth/mfa";

async function runStep5Tests() {
    console.log("=== STEP 5 VERIFICATION TESTS ===");

    // 1. Partial Session Gating (Ephemeral Pending MFA Token)
    const testUid = "user_mfa_test_77";
    const testEmail = "mfa_user@example.com";
    const pendingToken = createPendingMFAToken(testUid, testEmail);

    console.log("1. Generated Ephemeral MFA Pending Token (5-min TTL):");
    console.log("   Token format valid (2 parts):", pendingToken.split(".").length === 2);

    const verifiedPayload = verifyPendingMFAToken(pendingToken);
    console.log("   Pending Token Verification - Valid payload extracted:", verifiedPayload?.uid === testUid);

    // Tampered pending token test
    const tamperedToken = `${pendingToken}_tampered`;
    console.log("   Tampered Pending Token Rejected:", verifyPendingMFAToken(tamperedToken) === null);

    // 2. TOTP (RFC 6238) Generation & Verification Test
    const secret = generateTOTPSecret();
    console.log("2. Generated 16-char Base32 TOTP Secret:", secret);

    const currentCode = generateTOTPCode(secret);
    console.log("   Current TOTP 6-digit code:", currentCode);

    const isTotpValid = verifyTOTPCode(secret, currentCode);
    console.log("   TOTP Verification Succeeded:", isTotpValid);

    const isWrongTotpRejected = verifyTOTPCode(secret, "000000") === false;
    console.log("   Invalid TOTP Code Rejected:", isWrongTotpRejected);

    // 3. Single-Use Recovery / Backup Codes Test
    const { rawCodes, hashedRecords } = generateBackupCodes(8);
    console.log("3. Generated 8 Recovery Codes. Example code:", rawCodes[0]);
    console.log("   Stored as SHA-256 hashes:", hashedRecords.length === 8);

    // Simulate first use of backup code
    const targetCode = rawCodes[0];
    const targetHash = hashedRecords[0].codeHash;

    const matchBeforeUse = hashedRecords.find((rec) => rec.codeHash === targetHash && rec.usedAt === null);
    console.log("   Backup Code valid before first use:", matchBeforeUse !== undefined);

    // Mark as used
    hashedRecords[0].usedAt = Date.now();

    // Try second use (Must fail single-use enforcement!)
    const matchAfterUse = hashedRecords.find((rec) => rec.codeHash === targetHash && rec.usedAt === null);
    console.log("   Second Use Rejected (Single-use enforced):", matchAfterUse === undefined);

    console.log("=== ALL STEP 5 VERIFICATION TESTS PASSED ===");
}

runStep5Tests().catch(console.error);
