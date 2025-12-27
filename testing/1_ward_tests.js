const { runTest, request } = require("./utils");

async function testWards() {
  console.log("=== WARD & ROOM TESTS ===");

  let wardId;
  let roomId;

  // 1. Create Ward
  await runTest("Create Ward (East Wing)", async () => {
    const data = await request("POST", "/wards", {
      name: "East Wing 1",
      wing: "East",
      subWing: "1"
    });
    wardId = data._id;
    return `Created Ward ID: ${wardId}`;
  });

  // 2. Configure Rooms
  await runTest("Configure Rooms", async () => {
    const data = await request("POST", "/settings/configure-rooms", {
      wardId: wardId,
      roomNumbers: ["101", "102", "103"]
    });
    roomId = data.rooms[0]._id;
    return `Created ${data.created} rooms. Sample Room ID: ${roomId}`;
  });

  // 3. Get Wards
  await runTest("Get All Wards", async () => {
    const data = await request("GET", "/wards");
    if (!Array.isArray(data)) throw new Error("Response is not an array");
    return `Found ${data.length} wards`;
  });

  // 4. Get Ward Control Center
  await runTest("Get Ward Control Center", async () => {
    const data = await request("GET", `/wards/${wardId}/control-center`);
    if (!Array.isArray(data)) throw new Error("Response is not an array");
    return `Control Center data for ${data.length} rooms`;
  });

  // 5. Get Occupancy Stats
  await runTest("Get Occupancy Stats", async () => {
    const data = await request("GET", "/wards/occupancy-stats");
    return JSON.stringify(data);
  });

  // Export IDs for other tests if needed (via file or just logging)
  console.log("\nSave these IDs for other tests:");
  console.log(`WARD_ID=${wardId}`);
  console.log(`ROOM_ID=${roomId}`);
}

testWards();
