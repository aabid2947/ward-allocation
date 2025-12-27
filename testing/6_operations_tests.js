const { runTest, request } = require("./utils");

async function testOperations() {
  console.log("=== OPERATIONS TESTS ===");

  const today = new Date().toISOString().split('T')[0];
  const shift = "AM";

  // 1. Lock Shift
  await runTest("Lock Shift", async () => {
    const data = await request("POST", "/operations/lock-shift", {
      date: today,
      shift: shift,
      userId: "admin"
    });
    return `Shift locked by ${data.lockedBy}`;
  });

  // 2. Get Lock Status
  await runTest("Get Lock Status", async () => {
    const data = await request("GET", `/operations/lock-status?date=${today}&shift=${shift}`);
    if (!data.locked) throw new Error("Shift should be locked");
    return "Shift is locked";
  });

  // 3. Unlock Shift
  await runTest("Unlock Shift", async () => {
    await request("POST", "/operations/unlock-shift", {
      date: today,
      shift: shift
    });
    return "Shift unlocked";
  });
}

testOperations();
