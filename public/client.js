let currentRequestId = null;
let currentPhoneNumber = null;

function showStep(stepId) {
  document
    .querySelectorAll(".step")
    .forEach((step) => step.classList.remove("active"));
  document.getElementById(stepId).classList.add("active");
}

async function checkPhoneNumber() {
  currentPhoneNumber = document.getElementById("phoneNumber").value;
  if (!currentPhoneNumber) {
    alert("Please enter a phone number");
    return;
  }

  try {
    const response = await fetch("/check-or-register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phoneNumber: currentPhoneNumber }),
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    console.log("Server response:", data);

    if (data.status === "new") {
      showNewRequestForm(currentPhoneNumber);
    } else {
      displayExistingRequest(data);
    }
  } catch (error) {
    console.error("Error:", error);
    alert("An error occurred. Please try again.");
  }
}

function showNewRequestForm(phoneNumber) {
  document.getElementById("formPhoneNumber").value = phoneNumber;
  showStep("newRequest");
}

function displayExistingRequest(data) {
  const details = document.getElementById("requestDetails");
  if (!data || !data.request) {
    details.innerHTML = "<p>Error: Invalid response from server</p>";
    console.error("Invalid server response:", data);
    return;
  }

  details.innerHTML = `
    <p>Status: ${data.status || "N/A"}</p>
    <p>Current parking space block: ${data.request.currentBlock || "N/A"}</p>
    <p>Current spaces: ${data.request.currentSpace1 || "N/A"}, ${
    data.request.currentSpace2 || "N/A"
  }</p>
    <p>Desired parking space block: ${data.request.desiredBlock || "N/A"}</p>
  `;

  if (data.status === "matched") {
    details.innerHTML += `
      <p>Matching Users Phone Number: ${data.request.matchingPhone || "N/A"}</p>
      <p>Matching Spaces: ${data.request.matchingSpace1 || "N/A"}, ${
      data.request.matchingSpace2 || "N/A"
    }</p>
    `;
    document.getElementById("confirmSwapBtn").style.display = "block";
    document.getElementById("deleteRequestBtn").style.display = "none";
  } else {
    document.getElementById("confirmSwapBtn").style.display = "none";
    document.getElementById("deleteRequestBtn").style.display = "block";
  }

  currentRequestId = data.request.id;
  showStep("existingRequest");
}

document
  .getElementById("swapRequestForm")
  .addEventListener("submit", async (e) => {
    e.preventDefault();
    const formData = {
      phoneNumber: document.getElementById("formPhoneNumber").value,
      currentBlock: document.getElementById("currentBlock").value,
      spaceNumber1: document.getElementById("spaceNumber1").value,
      spaceNumber2: document.getElementById("spaceNumber2").value,
      desiredBlock: document.getElementById("desiredBlock").value,
    };

    try {
      const response = await fetch(
        "https://" + window.location.host + "/register-swap",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(formData),
        }
      );
      const data = await response.json();
      displayMatchResult(data);
    } catch (error) {
      console.error("Error:", error);
      alert("An error occurred. Please try again.");
    }
  });

function displayMatchResult(data) {
  const details = document.getElementById("matchDetails");
  details.innerHTML = `<p>${data.message}</p>`;

  if (data.status === "matched") {
    details.innerHTML += `
      <p>Matching Users Phone Number: ${data.matchDetails.matchingPhone}</p>
      <p>Matching Block: ${data.matchDetails.matchingBlock}</p>
      <p>Matching Spaces: ${data.matchDetails.matchingSpace1}, ${data.matchDetails.matchingSpace2}</p>
    `;
    document.getElementById("confirmSwapBtn").style.display = "block";
  } else {
    document.getElementById("confirmSwapBtn").style.display = "none";
  }

  showStep("matchResult");
}

async function deleteRequest() {
  if (!currentPhoneNumber || !currentRequestId) {
    alert("Error: Missing phone number or request ID");
    return;
  }

  try {
    const response = await fetch(
      "https://" + window.location.host + "/delete-request",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phoneNumber: currentPhoneNumber,
          requestId: currentRequestId,
        }),
      }
    );
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();

    if (result.status === "success") {
      alert("Request deleted successfully");
      currentRequestId = null;
      showNewRequestForm(currentPhoneNumber);
    } else {
      alert(`Failed to delete request: ${result.message}`);
    }
  } catch (error) {
    console.error("Error:", error);
    alert("An error occurred while deleting the request. Please try again.");
  }
}

async function confirmSwap() {
  if (!currentPhoneNumber || !currentRequestId) {
    alert("Error: Missing phone number or request ID");
    return;
  }

  try {
    const response = await fetch(
      "https://" + window.location.host + "/confirm-swap",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phoneNumber: currentPhoneNumber,
          requestId: currentRequestId,
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    alert(data.message);
    if (data.status === "completed") {
      // Update UI to show completed swap details
      showStep("matchResult");
      displayCompletedSwap(data);
    } else if (data.status === "waiting") {
      displayWaitingConfirmation(data);
    }
  } catch (error) {
    console.error("Error:", error);
    alert("An error occurred while confirming the swap. Please try again.");
  }
}

function displayCompletedSwap(data) {
  const details = document.getElementById("matchDetails");
  details.innerHTML = `
      <h3>Swap Completed Successfully!</h3>
      <p>Your new parking spaces:</p>
      <p>Block: ${data.newSpaces.block}</p>
      <p>Space 1: ${data.newSpaces.space1}</p>
      <p>Space 2: ${data.newSpaces.space2}</p>
    `;
  document.getElementById("confirmSwapBtn").style.display = "none";
}

function displayWaitingConfirmation(data) {
  const details = document.getElementById("matchDetails");
  details.innerHTML = `
      <h3>Waiting for Confirmation</h3>
      <p>${data.message}</p>
      <p>Once the other party confirms, you'll be able to see the new parking space details.</p>
    `;
  document.getElementById("confirmSwapBtn").style.display = "none";
}
