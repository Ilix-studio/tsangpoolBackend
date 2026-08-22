const { RecaptchaEnterpriseServiceClient } = require('@google-cloud/recaptcha-enterprise');

async function testAuthOnly() {
  console.log("Testing Google Cloud authentication...");
  try {
    const client = new RecaptchaEnterpriseServiceClient();
    const projectPath = client.projectPath("project-79924107-e626-448e-859");
    console.log("✅ Authentication successful!");
    console.log("Project path:", projectPath);
    return true;
  } catch (error) {
    console.log("❌ Authentication failed:", error.message);
    if (error.message.includes("DECODER routines")) {
      console.log("💡 Fix: Replace google-cloud-auth.json with your actual service account key from Google Cloud Console");
    }
    return false;
  }
}

testAuthOnly();
