const { runTest, request } = require("./utils");

// REPLACE THESE WITH IDS FROM PREVIOUS TEST
const WARD_ID = "694b56436187c41bc0242c49"; 
const ROOM_ID = "694b56436187c41bc0242c4d";

async function testPatients() {
  console.log("=== PATIENT TESTS ===");

  // If IDs are not set, try to fetch them
  let wardId = WARD_ID;
  let roomId = ROOM_ID;

  if (wardId === "REPLACE_WITH_WARD_ID") {
      console.log("Fetching existing ward/room...");
      const wards = await request("GET", "/wards");
      if (wards.length > 0) {
          wardId = wards[0]._id;
          const control = await request("GET", `/wards/${wardId}/control-center`);
          if (control.length > 0) {
              roomId = control[0].room._id;
          }
      }
  }

  if (!wardId || !roomId) {
      console.error("Please run 1_ward_tests.js first to create wards and rooms.");
      return;
  }

  let patientId;

  // 1. Admit Patient
  await runTest("Admit Patient", async () => {
    const data = await request("POST", "/patients/admit", {
      name: "John Doe",
      primaryCondition: "Flu",
      careLevel: "Medium",
      mobilityLevel: "Assisted",
      complexityScore: 1.5,
      admissionDate: new Date(),
      currentWard: wardId,
      currentRoom: roomId,
      schedules: [
          { dayOfWeek: "Monday", shift: "AM", taskType: "Shower", durationMinutes: 20 },
          { dayOfWeek: "Monday", shift: "AM", taskType: "MorningCare", durationMinutes: 15 }
      ]
    });
    patientId = data._id;
    return `Admitted Patient ID: ${patientId}`;
  });

  // 2. Get Patient Profile
  await runTest("Get Patient Profile", async () => {
    const data = await request("GET", `/patients/${patientId}`);
    if (data.name !== "John Doe") throw new Error("Name mismatch");
    return `Fetched profile for ${data.name}`;
  });

  // 3. Update Clinical Status
  await runTest("Update Clinical Status", async () => {
    const data = await request("PUT", `/patients/${patientId}/clinical`, {
      mobilityLevel: "Independent",
      complexityScore: 1.2
    });
    if (data.mobilityLevel !== "Independent") throw new Error("Update failed");
    return "Updated mobility to Independent";
  });

  // 4. Set On Leave
  await runTest("Set On Leave", async () => {
    const data = await request("PUT", `/patients/${patientId}/leave`, {
      startDate: new Date(),
      expectedReturn: new Date()
    });
    if (data.status !== "OnLeave") throw new Error("Status update failed");
    return "Patient is now OnLeave";
  });

  // 5. Return From Leave
  await runTest("Return From Leave", async () => {
    const data = await request("PUT", `/patients/${patientId}/return`);
    if (data.status !== "Admitted") throw new Error("Status update failed");
    return "Patient returned to Admitted";
  });

  // 6. Validate Placement
  await runTest("Validate Placement", async () => {
    const data = await request("POST", "/patients/validate-placement", {
      wardId: wardId,
      roomId: roomId
    });
    return `Available: ${data.available}`;
  });
}

testPatients();
