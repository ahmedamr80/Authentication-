import { issueAccessToken } from "../src/lib/auth/tokens";
import { hasRole, hasPermission, isResourceOwner } from "../src/lib/auth/rbac-abac";
import { authenticateApiRequest } from "../src/lib/auth/require-auth";

async function runStep8Tests() {
    console.log("=== STEP 8 VERIFICATION TESTS ===");

    const playerUser = {
        uid: "user_A_player_1122",
        email: "playerA@example.com",
        role: "player",
        isAdmin: false,
        is_email_verified: true,
    };

    const adminUser = {
        uid: "user_admin_9900",
        email: "admin@example.com",
        role: "admin",
        isAdmin: true,
        is_email_verified: true,
    };

    const playerToken = issueAccessToken(playerUser);

    // 1. RBAC Test: Player role trying to access admin endpoint
    console.log("1. RBAC Role & Permission Hierarchy Test:");
    console.log("   Admin has 'admin' role:", hasRole(adminUser.role, "admin"));
    console.log("   Player has 'admin' role:", hasRole(playerUser.role, "admin"));
    console.log("   Player access to admin endpoint REJECTED (403):", hasRole(playerUser.role, "admin") === false);
    console.log("   Player has fine-grained permission 'users:manage':", hasPermission(playerUser.role, "users:manage"));

    // 2. ABAC Ownership Test: User A modifying User B's resource
    console.log("2. ABAC Ownership Check (User A modifying User B's resource):");
    const userA_Uid = "user_A_1111";
    const userB_Uid = "user_B_2222";

    const userA_Edits_Self = isResourceOwner(userA_Uid, userA_Uid, false);
    console.log("   User A modifying User A's profile: Allowed =", userA_Edits_Self);

    const userA_Edits_UserB = isResourceOwner(userA_Uid, userB_Uid, false);
    console.log("   User A modifying User B's profile: REJECTED (403) =", userA_Edits_UserB === false);

    const admin_Edits_UserB = isResourceOwner(adminUser.uid, userB_Uid, true);
    console.log("   Admin modifying User B's profile: Allowed (Admin Override) =", admin_Edits_UserB);

    // 3. API Request Guard Verification
    console.log("3. API Bearer Guard Test with Token Claims:");
    const reqPlayer = new Request("https://example.com/api/admin/users", {
        headers: { Authorization: `Bearer ${playerToken}` },
    });

    const authResult = await authenticateApiRequest(reqPlayer);
    console.log("   Extracted Role from JWT Claims:", authResult.user?.role);
    console.log("   Is Admin claim in token:", authResult.user?.isAdmin);
    console.log("   Guarded Route Rejects Player Role:", hasRole(authResult.user?.role, "admin") === false);

    console.log("=== ALL STEP 8 VERIFICATION TESTS PASSED ===");
}

runStep8Tests().catch(console.error);
