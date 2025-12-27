const { runTest, request } = require("./utils");

async function testStaff() {
  console.log("=== STAFF TESTS ===");

  let staffId;

  // 1. Create Staff
  await runTest("Create Staff", async () => {
    const data = await request("POST", "/staff", {
      name: "Nurse Alice",
      role: "RN",
      employmentType: "FullTime",
      maxMinutesPerShift: 480,
      availability: { am: true, pm: true }
    });
    staffId = data._id;
    return `Created Staff ID: ${staffId}`;
  });

  // 2. Get All Staff
  await runTest("Get All Staff", async () => {
    const data = await request("GET", "/staff");
    return `Found ${data.length} staff members`;
  });

  // 3. Update Availability
  await runTest("Update Availability", async () => {
    const data = await request("PUT", `/staff/${staffId}/availability`, {
      am: true,
      pm: false
    });
    if (data.availability.pm !== false) throw new Error("Update failed");
    return "Updated availability";
  });

  // 4. Get Available Staff (AM)
  await runTest("Get Available Staff (AM)", async () => {
    const data = await request("GET", "/staff/available?shift=AM");
    const found = data.find(s => s._id === staffId);
    if (!found) throw new Error("Staff not found in AM list");
    return "Staff found in AM list";
  });

  // 5. Set Override
  await runTest("Set Availability Override", async () => {
    const data = await request("POST", `/staff/${staffId}/override`, {
      date: new Date(),
      shift: "AM",
      status: "Unavailable",
      reason: "Sick"
    });
    return "Override set: Unavailable";
  });
}

testStaff();
