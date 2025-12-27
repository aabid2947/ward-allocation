const { execSync } = require("child_process");

const scripts = [
  "1_ward_tests.js",
  "2_patient_tests.js",
  "3_staff_tests.js",
  "4_task_tests.js",
  "5_allocation_tests.js",
  "6_operations_tests.js",
  "7_settings_tests.js"
];

console.log("Running all tests sequentially...\n");

for (const script of scripts) {
  try {
    // Note: This runs them as separate processes, so variables aren't shared.
    // However, since they persist data to the DB, the sequence works.
    // BUT: 2_patient_tests.js needs IDs from 1_ward_tests.js.
    // I updated 2_patient_tests.js to fetch existing wards if IDs are missing.
    execSync(`node backend/testing/${script}`, { stdio: "inherit" });
    console.log("\n-----------------------------------\n");
  } catch (error) {
    console.error(`Failed to run ${script}`);
    process.exit(1);
  }
}

console.log("All tests completed.");
