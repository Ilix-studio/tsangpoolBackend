const { RecaptchaEnterpriseServiceClient } = require('@google-cloud/recaptcha-enterprise');

async function testRealAssessment() {
  console.log("Testing reCAPTCHA assessment with real credentials...");
  
  try {
    // Create the reCAPTCHA client
    const client = new RecaptchaEnterpriseServiceClient();
    const projectPath = client.projectPath("project-79924107-e626-448e-859");

    // Test with an invalid token (should fail gracefully)
    console.log("\n=== Testing with invalid token ===");
    const request = {
      assessment: {
        event: {
          token: "invalid-test-token",
          siteKey: "6Leoqr0sAAAAAHL1-NEy_Ys7BZ101KlziJ3-4KRX",
        },
      },
      parent: projectPath,
    };

    const [response] = await client.createAssessment(request);
    
    console.log("Response received:", {
      valid: response.tokenProperties?.valid,
      invalidReason: response.tokenProperties?.invalidReason,
      action: response.tokenProperties?.action,
      score: response.riskAnalysis?.score
    });

    if (!response.tokenProperties?.valid) {
      console.log("✅ Correctly identified invalid token:", response.tokenProperties.invalidReason);
    }

    return true;
  } catch (error) {
    console.error("❌ Assessment failed:", error.message);
    return false;
  }
}

testRealAssessment();
