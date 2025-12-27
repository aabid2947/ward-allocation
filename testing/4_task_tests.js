const { runTest, request } = require("./utils");

async function testTasks() {
  console.log("=== TASK TESTS ===");

  // 1. Create Global Task
  await runTest("Create Global Task", async () => {
    const data = await request("POST", "/tasks/global", {
      name: "Morning Tea",
      durationMinutes: 30,
      requiredStaff: 2,
      shift: "AM",
      fixedWindow: { start: "10:00", end: "10:30" }
    });
    return `Created Global Task: ${data.name}`;
  });

  // 2. Get Global Tasks
  await runTest("Get Global Tasks", async () => {
    const data = await request("GET", "/tasks/global");
    return `Found ${data.length} global tasks`;
  });

  // 3. Get Daily Workload
  await runTest("Get Daily Workload", async () => {
    const today = new Date().toISOString().split('T')[0];
    const data = await request("GET", `/tasks/daily-workload?date=${today}&shift=AM`);
    return `Total Minutes: ${data.totalMinutes}, Count: ${data.taskCount}`;
  });
}

testTasks();
