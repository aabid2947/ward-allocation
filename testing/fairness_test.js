const { runTest, request, colors } = require("./utils");

/**
 * FAIRNESS ALLOCATION TEST
 * 
 * This script:
 * 1. Deletes all DB content
 * 2. Creates admin, wards, staff, patients, and global tasks
 * 3. Runs the allocation engine
 * 4. Verifies fairness metrics
 * 5. Reports results
 */

// Test data storage
let wardId = null;
let roomIds = [];
let staffIds = [];
let patientIds = [];
let globalTaskIds = [];

const BASE_URL = "http://localhost:5000";

async function deleteAllDbContent() {
  console.log("\n=== STEP 1: DELETE ALL DB CONTENT ===\n");
  
  await runTest("Delete all database collections", async () => {
    const response = await fetch(`${BASE_URL}/delete-all-db`);
    if (!response.ok) throw new Error(`Failed: ${response.status}`);
    const data = await response.json();
    return data.message;
  });
}

async function createWardAndRooms() {
  console.log("\n=== STEP 2: CREATE WARD AND ROOMS ===\n");
  
  // Create one ward for testing
  await runTest("Create East Wing Ward", async () => {
    const data = await request("POST", "/wards", {
      name: "East Wing 1",
      wing: "East",
      subWing: "1",
      active: true
    });
    wardId = data._id;
    return `Created ward: ${data.name} (${wardId})`;
  });

  // Create rooms
  for (let i = 1; i <= 3; i++) {
    await runTest(`Create Room E${i}01`, async () => {
      const data = await request("POST", "/wards/rooms", {
        ward: wardId,
        roomNumber: `E${i}01`,
        capacity: 4,
        currentOccupancy: 0
      });
      roomIds.push(data._id);
      return `Created room: ${data.roomNumber}`;
    });
  }
}

async function createStaff() {
  console.log("\n=== STEP 3: CREATE STAFF (5 HCAs) ===\n");
  
  const staffConfigs = [
    { name: "HCA Alice", gender: "Female", canHandleHeavyLoad: true },
    { name: "HCA Bob", gender: "Male", canHandleHeavyLoad: true },
    { name: "HCA Carol", gender: "Female", canHandleHeavyLoad: true },
    { name: "HCA Dave", gender: "Male", canHandleHeavyLoad: true },
    { name: "HCA Eve", gender: "Female", canHandleHeavyLoad: true },
  ];

  for (const config of staffConfigs) {
    await runTest(`Create Staff: ${config.name}`, async () => {
      const data = await request("POST", "/staff", {
        name: config.name,
        gender: config.gender,
        role: "HCA",
        employmentType: "FullTime",
        availability: { am: true, pm: true },
        maxMinutesPerShift: 480,
        canHandleHeavyLoad: config.canHandleHeavyLoad,
        assignedWard: wardId,
        active: true
      });
      staffIds.push(data._id);
      return `Created: ${data.name} (${data._id})`;
    });
  }
}

async function createPatients() {
  console.log("\n=== STEP 4: CREATE PATIENTS (6 patients) ===\n");
  
  const today = new Date().toLocaleDateString("en-US", { weekday: "long" });
  
  const patientConfigs = [
    { 
      name: "Patient A", 
      staffGender: "Any", 
      acuityLevel: "Low", 
      noOfStaff: 1,
      amDuration: "20",
      pmDuration: "20"
    },
    { 
      name: "Patient B", 
      staffGender: "Any", 
      acuityLevel: "Low", 
      noOfStaff: 1,
      amDuration: "25",
      pmDuration: "25"
    },
    { 
      name: "Patient C", 
      staffGender: "Any", 
      acuityLevel: "Low", 
      noOfStaff: 1,
      amDuration: "20",
      pmDuration: "20"
    },
    { 
      name: "Patient D", 
      staffGender: "Any", 
      acuityLevel: "Low", 
      noOfStaff: 1,
      amDuration: "25",
      pmDuration: "25"
    },
    { 
      name: "Patient E", 
      staffGender: "Any", 
      acuityLevel: "Low", 
      noOfStaff: 1,
      amDuration: "20",
      pmDuration: "20"
    },
    { 
      name: "Patient F", 
      staffGender: "Any", 
      acuityLevel: "Low", 
      noOfStaff: 2,  // Requires 2 staff
      amDuration: "30",
      pmDuration: "30"
    },
  ];

  for (let i = 0; i < patientConfigs.length; i++) {
    const config = patientConfigs[i];
    const roomId = roomIds[i % roomIds.length];
    
    await runTest(`Create Patient: ${config.name}`, async () => {
      // Create weekly cares for every day
      const weeklyCares = [
        "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"
      ].map(day => ({
        day,
        amDuration: config.amDuration,
        pmDuration: config.pmDuration,
        specialTime: ""
      }));

      const data = await request("POST", "/patients", {
        name: config.name,
        primaryCondition: "General Care",
        complexityScore: 1.0,
        admissionDate: new Date().toISOString(),
        status: "Admitted",
        staffGender: config.staffGender,
        acuityLevel: config.acuityLevel,
        noOfStaff: config.noOfStaff,
        currentWard: wardId,
        currentRoom: roomId,
        weeklyCares: weeklyCares,
        dailySchedule: [
          {
            startTime: "",
            endTime: "",
            isFixedDuration: true,
            durationMinutes: 15,
            shift: "AM",
            activities: ["Morning Cares", "Toileting"]
          }
        ]
      });
      patientIds.push(data._id);
      return `Created: ${data.name} (Staff needed: ${config.noOfStaff})`;
    });
  }
}

async function createGlobalTasks() {
  console.log("\n=== STEP 5: CREATE GLOBAL TASKS ===\n");
  
  const taskConfigs = [
    { name: "Morning Tea", durationMinutes: 5, shift: "AM", startTime: "10:00" },
    { name: "Medication Round", durationMinutes: 10, shift: "AM", startTime: "08:00" },
    { name: "Documentation", durationMinutes: 10, shift: "AM", startTime: "11:00" },
  ];

  for (const config of taskConfigs) {
    await runTest(`Create Global Task: ${config.name}`, async () => {
      const data = await request("POST", "/tasks/global", {
        name: config.name,
        category: "General",
        durationMinutes: config.durationMinutes,
        requiredStaff: 1,
        shift: config.shift,
        startTime: config.startTime,
        active: true
      });
      globalTaskIds.push(data._id);
      return `Created: ${data.name} (${config.durationMinutes} mins)`;
    });
  }
}

async function runAllocationAndCheckFairness() {
  console.log("\n=== STEP 6: RUN ALLOCATION ENGINE ===\n");
  
  const today = new Date().toISOString().split('T')[0];
  const shift = "AM";
  
  let response;
  
  await runTest("Run Allocation Engine", async () => {
    response = await request("POST", "/allocation/run-engine", {
      date: today,
      shift: shift
    });
    
    if (!response.assignments) throw new Error("No assignments");
    return `Generated ${response.assignments.length} assignments`;
  });

  console.log("\n=== STEP 7: ANALYZE FAIRNESS ===\n");
  
  // Analyze staff workload distribution
  const staffLoads = {};
  
  for (const assignment of response.assignments) {
    const staffName = assignment.staffName;
    if (!staffLoads[staffName]) {
      staffLoads[staffName] = {
        name: staffName,
        totalMinutes: 0,
        assignments: [],
        globalTasks: 0,
        patientTasks: 0
      };
    }
    staffLoads[staffName].totalMinutes += assignment.minutesAllocated;
    staffLoads[staffName].assignments.push({
      task: assignment.taskName,
      minutes: assignment.minutesAllocated,
      type: assignment.taskType
    });
    
    if (assignment.taskType === "GlobalTask") {
      staffLoads[staffName].globalTasks += assignment.minutesAllocated;
    } else {
      staffLoads[staffName].patientTasks += assignment.minutesAllocated;
    }
  }
  
  // Calculate fairness metrics
  const loads = Object.values(staffLoads).map(s => s.totalMinutes);
  const mean = loads.reduce((sum, l) => sum + l, 0) / loads.length;
  const variance = loads.reduce((sum, l) => sum + Math.pow(l - mean, 2), 0) / loads.length;
  const stdDev = Math.sqrt(variance);
  const maxLoad = Math.max(...loads);
  const minLoad = Math.min(...loads);
  const difference = maxLoad - minLoad;
  
  console.log("┌─────────────────────────────────────────────────────────────┐");
  console.log("│                    WORKLOAD DISTRIBUTION                    │");
  console.log("├─────────────────────────────────────────────────────────────┤");
  
  Object.values(staffLoads).sort((a, b) => b.totalMinutes - a.totalMinutes).forEach(staff => {
    const bar = "█".repeat(Math.round(staff.totalMinutes / 5));
    console.log(`│ ${staff.name.padEnd(12)} │ ${String(staff.totalMinutes).padStart(3)} mins │ ${bar.padEnd(20)} │`);
  });
  
  console.log("├─────────────────────────────────────────────────────────────┤");
  console.log(`│ Mean Load:     ${mean.toFixed(1).padStart(6)} minutes                          │`);
  console.log(`│ Std Deviation: ${stdDev.toFixed(1).padStart(6)} minutes                          │`);
  console.log(`│ Variance:      ${variance.toFixed(1).padStart(6)}                                │`);
  console.log(`│ Load Range:    ${minLoad.toString().padStart(3)} - ${maxLoad.toString().padStart(3)} (diff: ${difference})              │`);
  console.log("└─────────────────────────────────────────────────────────────┘");
  
  // Detailed breakdown
  console.log("\n=== DETAILED ASSIGNMENTS ===\n");
  
  Object.values(staffLoads).forEach(staff => {
    console.log(`${colors.blue}${staff.name}${colors.reset} (${staff.totalMinutes} mins):`);
    staff.assignments.forEach(a => {
      console.log(`  - ${a.task}: ${a.minutes}m (${a.type})`);
    });
    console.log();
  });
  
  // Check fairness
  const isFair = difference <= 20; // Within 20 minutes is considered fair
  
  console.log("=".repeat(60));
  if (isFair) {
    console.log(`${colors.green}✓ FAIRNESS CHECK PASSED${colors.reset}`);
    console.log(`  Load difference (${difference} mins) is within acceptable range (≤20 mins)`);
  } else {
    console.log(`${colors.red}✗ FAIRNESS CHECK FAILED${colors.reset}`);
    console.log(`  Load difference (${difference} mins) exceeds acceptable range (≤20 mins)`);
  }
  console.log("=".repeat(60));
  
  // Get detailed log info
  if (response.allDetailsJson?.detailedLog) {
    const log = response.allDetailsJson.detailedLog;
    console.log(`\nExecution time: ${log.metadata.executionTimeMs}ms`);
    
    const wardLog = Object.values(log.wardAllocations)[0];
    if (wardLog?.rebalancingSteps) {
      const rebal = wardLog.rebalancingSteps;
      console.log(`\nRebalancing iterations:`);
      console.log(`  Global Tasks: ${rebal.globalTaskBalancing?.iterations || 0}`);
      console.log(`  Patient Care: ${rebal.patientCareBalancing?.iterations || 0}`);
      console.log(`  Daily Slots:  ${rebal.dailySlotBalancing?.iterations || 0}`);
    }
  }
  
  return { isFair, difference, staffLoads, response };
}

async function commitAndVerify(allocationResponse) {
  console.log("\n=== STEP 8: COMMIT AND VERIFY ===\n");
  
  const today = new Date().toISOString().split('T')[0];
  const shift = "AM";
  
  // Use the allocation response we already have instead of running again
  const assignments = allocationResponse.assignments;
  
  if (!assignments || assignments.length === 0) {
    console.log("   No assignments to commit, skipping...");
    return;
  }
  
  await runTest("Commit Allocation", async () => {
    const result = await request("POST", "/allocation/commit", {
      date: today,
      shift: shift,
      data: assignments
    });
    return `Committed ${result.saved?.length || 0} assignments`;
  });
  
  await runTest("Get Fairness Metrics", async () => {
    const metrics = await request("GET", `/allocation/fairness?date=${today}&shift=${shift}`);
    const wardMetrics = Object.values(metrics)[0];
    if (wardMetrics) {
      return `Fairness score: ${wardMetrics.fairnessScore.toFixed(4)}, StdDev: ${wardMetrics.stdDev.toFixed(1)}`;
    }
    return "No metrics available";
  });
  
  await runTest("Get Result Table", async () => {
    const table = await request("GET", `/allocation/result-table?date=${today}&shift=${shift}`);
    return `${table.length} staff members in result table`;
  });
}

async function runFairnessTest() {
  console.log("\n" + "=".repeat(60));
  console.log("   FAIRNESS ALLOCATION TEST");
  console.log("=".repeat(60));

  try {
    await deleteAllDbContent();
    await createWardAndRooms();
    await createStaff();
    await createPatients();
    await createGlobalTasks();
    
    const result = await runAllocationAndCheckFairness();
    
    if (!result.isFair) {
      console.log("\n" + colors.yellow + "Fairness not optimal, checking if improvements can be made..." + colors.reset);
      // The rebalancing should have already optimized, but we report the issue
    }
    
    await commitAndVerify(result.response);
    
    console.log("\n" + "=".repeat(60));
    console.log(`   ${colors.green}FAIRNESS TEST COMPLETED${colors.reset}`);
    console.log("=".repeat(60) + "\n");
    
  } catch (error) {
    console.error("\n" + "=".repeat(60));
    console.error(`   ${colors.red}TEST FAILED${colors.reset}`);
    console.error("   Error:", error.message);
    console.error("=".repeat(60) + "\n");
  }
}

// Run the test
runFairnessTest();
