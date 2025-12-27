const { runTest, request } = require("./utils");

async function testSettings() {
  console.log("=== SETTINGS TESTS ===");

  // 1. Get Facility Overview
  await runTest("Get Facility Overview", async () => {
    const data = await request("GET", "/settings/overview");
    if (!Array.isArray(data)) throw new Error("Response is not an array");
    return `Overview for ${data.length} wards`;
  });
}

testSettings();
