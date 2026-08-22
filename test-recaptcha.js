const {
  RecaptchaEnterpriseServiceClient,
} = require("@google-cloud/recaptcha-enterprise");

/**
 * Create an assessment to analyze the risk of a UI action.
 *
 * projectID: Your Google Cloud Project ID.
 * recaptchaSiteKey: The reCAPTCHA key associated with the site/app
 * token: The generated token obtained from the client.
 * recaptchaAction: Action name corresponding to the token.
 */
async function createAssessment({
  // TODO: Replace the token and reCAPTCHA action variables before running the sample.
  projectID = "project-79924107-e626-448e-859",
  recaptchaKey = "6Leoqr0sAAAAAHL1-NEy_Ys7BZ101KlziJ3-4KRX",
  token = "action-token",
  recaptchaAction = "submit", // Changed to match your backend expectation
}) {
  try {
    // Create the reCAPTCHA client.
    // TODO: Cache the client generation code (recommended) or call client.close() before exiting the method.
    const client = new RecaptchaEnterpriseServiceClient();
    const projectPath = client.projectPath(projectID);

    // Build the assessment request.
    const request = {
      assessment: {
        event: {
          token: token,
          siteKey: recaptchaKey,
        },
      },
      parent: projectPath,
    };

    console.log(
      "Creating assessment with request:",
      JSON.stringify(request, null, 2),
    );

    const [response] = await client.createAssessment(request);

    // Check if the token is valid.
    if (!response.tokenProperties.valid) {
      console.log(
        `The CreateAssessment call failed because the token was: ${response.tokenProperties.invalidReason}`,
      );
      return null;
    }

    // Check if the expected action was executed.
    // The `action` property is set by user client in the grecaptcha.enterprise.execute() method.
    if (response.tokenProperties.action === recaptchaAction) {
      // Get the risk score and the reason(s).
      // For more information on interpreting the assessment, see:
      // https://cloud.google.com/recaptcha/docs/interpret-assessment
      console.log(`The reCAPTCHA score is: ${response.riskAnalysis.score}`);
      response.riskAnalysis.reasons.forEach((reason) => {
        console.log(reason);
      });

      return response.riskAnalysis.score;
    } else {
      console.log(
        "The action attribute in your reCAPTCHA tag does not match the action you are expecting to score",
      );
      console.log(
        `Expected: ${recaptchaAction}, Got: ${response.tokenProperties.action}`,
      );
      return null;
    }
  } catch (error) {
    console.error("Assessment creation failed:", error.message);
    console.error("Full error:", error);
    return null;
  }
}

// Test authentication only
async function testAuthentication() {
  console.log("Testing Google Cloud authentication...");
  try {
    const client = new RecaptchaEnterpriseServiceClient();
    const projectPath = client.projectPath("project-79924107-e626-448e-859");
    console.log("✅ Authentication successful!");
    console.log("Project path:", projectPath);
    return true;
  } catch (error) {
    console.log("❌ Authentication failed:", error.message);
    return false;
  }
}

testAuthentication();

// Test with different scenarios
async function runTests() {
  console.log("=== Testing reCAPTCHA with invalid token ===");
  await createAssessment({
    token: "invalid-token-123",
    recaptchaAction: "submit",
  });

  console.log("\n=== Testing reCAPTCHA with dev-bypass token ===");
  await createAssessment({
    token: "dev-bypass",
    recaptchaAction: "submit",
  });

  console.log("\n=== Testing reCAPTCHA with action-name token ===");
  await createAssessment({
    token: "action-token",
    recaptchaAction: "action-name",
  });
}

runTests();
