const BASE_URL = "http://localhost:5000/api";

const colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
};

async function runTest(name, fn) {
  process.stdout.write(`Testing ${name}... `);
  try {
    const result = await fn();
    console.log(`${colors.green}PASS${colors.reset}`);
    if (result) console.log("   ->", result);
    return true;
  } catch (error) {
    console.log(`${colors.red}FAIL${colors.reset}`);
    console.error("   ->", error.message);
    if (error.response) {
        console.error("   -> Status:", error.response.status);
        console.error("   -> Data:", await error.response.json());
    }
    return false;
  }
}

async function request(method, endpoint, data = null) {
  const options = {
    method,
    headers: {
      "Content-Type": "application/json",
    },
  };

  if (data) {
    options.body = JSON.stringify(data);
  }

  const response = await fetch(`${BASE_URL}${endpoint}`, options);
  
  if (!response.ok) {
    const err = new Error(`Request failed: ${response.status} ${response.statusText}`);
    err.response = response;
    throw err;
  }

  // Handle 204 No Content or empty responses
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

module.exports = { runTest, request, colors };
