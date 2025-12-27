const { runTest, request } = require("./utils");

async function testAllocation() {
  console.log("=== ALLOCATION ENGINE TESTS ===");

  const today = new Date().toISOString().split('T')[0];
  const shift = "AM";

  // 1. Dry Run Allocation
  await runTest("Run Allocation Engine (Dry Run)", async () => {
    const data = await request("POST", "/allocation/run-engine", {
      date: today,
      shift: shift
    });
    if (!Array.isArray(data)) throw new Error("Response is not an array");
    return `Generated ${data.length} assignments`;
  });

  // 2. Commit Allocation
  await runTest("Commit Allocation", async () => {
    // Re-run to get data to commit
    const assignments = await request("POST", "/allocation/run-engine", {
      date: today,
      shift: shift
    });
    
    const data = await request("POST", "/allocation/commit", {
      date: today,
      shift: shift,
      data: assignments
    });
    return `Committed ${data.length} assignments`;
  });

  // 3. Get Result Table
  await runTest("Get Shift Result Table", async () => {
    const data = await request("GET", `/allocation/result-table?date=${today}&shift=${shift}`);
    return `Result table has ${data.length} staff entries`;
  });
}

testAllocation();
