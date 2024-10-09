const express = require("express");
const bodyParser = require("body-parser");
const AWS = require("aws-sdk");
const { v4: uuidv4 } = require("uuid");

const app = express();
// Set the port to 8081 to match Nginx configuration
const port = process.env.PORT || 8081;

app.use(bodyParser.json());
app.use(express.static("public"));

// Enable 'trust proxy' to properly handle requests behind Nginx
app.set("trust proxy", true);

// Configure AWS SDK
AWS.config.update({ region: "eu-west-2" });
const dynamodb = new AWS.DynamoDB.DocumentClient();

// Health check endpoint for Elastic Beanstalk
app.get("/health", (req, res) => {
  res.status(200).json({ status: "OK" });
});

// New endpoint to check existing requests or register
app.post("/check-or-register", async (req, res) => {
  const { phoneNumber } = req.body;

  try {
    // Check for existing requests
    const existingRequestParams = {
      TableName: "SwapRequests",
      IndexName: "RequesterPhoneIndex",
      KeyConditionExpression: "requesterPhone = :phone",
      ExpressionAttributeValues: {
        ":phone": phoneNumber,
      },
    };

    const existingRequest = await dynamodb
      .query(existingRequestParams)
      .promise();

    if (existingRequest.Items.length > 0) {
      const request = existingRequest.Items[0];
      return res.json({
        status: request.status,
        request: {
          id: request.id,
          currentBlock: request.requesterBlock,
          currentSpace1: request.requesterSpace1,
          currentSpace2: request.requesterSpace2,
          desiredBlock: request.ownerBlock,
          matchingPhone: request.ownerPhone,
          matchingSpace1: request.ownerSpace1,
          matchingSpace2: request.ownerSpace2,
          requesterConfirmed: request.requesterConfirmed,
          ownerConfirmed: request.ownerConfirmed,
        },
        message:
          request.status === "pending"
            ? "Your swap request is still pending. No match found yet."
            : "Match found",
      });
    } else {
      return res.json({ status: "new" });
    }
  } catch (error) {
    console.error("Error checking requests:", error.message, error.stack);
    res
      .status(500)
      .json({ status: "error", message: "Error checking requests" });
  }
});

// Modified endpoint to register a new swap request
app.post("/register-swap", async (req, res) => {
  const {
    phoneNumber,
    currentBlock,
    spaceNumber1,
    spaceNumber2,
    desiredBlock,
  } = req.body;

  const swapRequestParams = {
    TableName: "SwapRequests",
    Item: {
      id: uuidv4(),
      requesterPhone: phoneNumber,
      ownerPhone: null,
      requesterBlock: currentBlock,
      requesterSpace1: spaceNumber1,
      requesterSpace2: spaceNumber2,
      ownerBlock: desiredBlock,
      ownerSpace1: null,
      ownerSpace2: null,
      requesterConfirmed: false,
      ownerConfirmed: false,
      status: "pending",
      createdAt: new Date().toISOString(),
    },
  };

  try {
    await dynamodb.put(swapRequestParams).promise();

    // Check for an immediate match
    const matchResult = await findMatch(phoneNumber, desiredBlock);

    if (matchResult) {
      // Update both swap requests atomically
      const transactParams = {
        TransactItems: [
          {
            Update: {
              TableName: "SwapRequests",
              Key: { id: swapRequestParams.Item.id },
              UpdateExpression:
                "set ownerPhone = :op, ownerSpace1 = :os1, ownerSpace2 = :os2, #s = :status",
              ExpressionAttributeNames: { "#s": "status" },
              ExpressionAttributeValues: {
                ":op": matchResult.requesterPhone,
                ":os1": matchResult.requesterSpace1,
                ":os2": matchResult.requesterSpace2,
                ":status": "matched",
              },
            },
          },
          {
            Update: {
              TableName: "SwapRequests",
              Key: { id: matchResult.id },
              UpdateExpression:
                "set ownerPhone = :op, ownerBlock = :ob, ownerSpace1 = :os1, ownerSpace2 = :os2, #s = :status",
              ExpressionAttributeNames: { "#s": "status" },
              ExpressionAttributeValues: {
                ":op": phoneNumber,
                ":ob": currentBlock,
                ":os1": spaceNumber1,
                ":os2": spaceNumber2,
                ":status": "matched",
              },
            },
          },
        ],
      };

      await dynamodb.transactWrite(transactParams).promise();

      res.json({
        status: "matched",
        message: "Match found",
        matchDetails: {
          matchingPhone: matchResult.requesterPhone,
          matchingBlock: matchResult.requesterBlock,
          matchingSpace1: matchResult.requesterSpace1,
          matchingSpace2: matchResult.requesterSpace2,
        },
      });
    } else {
      res.json({
        status: "pending",
        message:
          "Swap request registered. No immediate match found. Please check back later.",
      });
    }
  } catch (error) {
    console.error("Error registering swap request:", error);
    res
      .status(500)
      .json({ status: "error", message: "Error registering swap request" });
  }
});

// Helper function to find a match
async function findMatch(phoneNumber, desiredBlock) {
  const queryParams = {
    TableName: "SwapRequests",
    IndexName: "StatusBlockIndex",
    KeyConditionExpression: "#status = :pending AND requesterBlock = :block",
    FilterExpression: "requesterPhone <> :phone",
    ExpressionAttributeNames: {
      "#status": "status",
    },
    ExpressionAttributeValues: {
      ":pending": "pending",
      ":block": desiredBlock,
      ":phone": phoneNumber,
    },
  };

  const result = await dynamodb.query(queryParams).promise();
  return result.Items.length > 0 ? result.Items[0] : null;
}

app.post("/confirm-swap", async (req, res) => {
  const { phoneNumber, requestId } = req.body;

  try {
    const { Item } = await dynamodb
      .get({ TableName: "SwapRequests", Key: { id: requestId } })
      .promise();

    if (!Item) {
      return res
        .status(404)
        .json({ status: "error", message: "Swap request not found" });
    }

    const isRequester = phoneNumber === Item.requesterPhone;
    const updateField = isRequester ? "requesterConfirmed" : "ownerConfirmed";

    const updateParams = {
      TableName: "SwapRequests",
      Key: { id: requestId },
      UpdateExpression: `set ${updateField} = :value`,
      ExpressionAttributeValues: {
        ":value": true,
      },
      ReturnValues: "ALL_NEW",
    };

    const { Attributes } = await dynamodb.update(updateParams).promise();

    if (Attributes.requesterConfirmed && Attributes.ownerConfirmed) {
      await swapParkingSpaces(Attributes);
      res.json({
        status: "completed",
        message: "Swap completed successfully",
        oldSpaces: isRequester
          ? {
              block: Attributes.requesterBlock,
              space1: Attributes.requesterSpace1,
              space2: Attributes.requesterSpace2,
            }
          : {
              block: Attributes.ownerBlock,
              space1: Attributes.ownerSpace1,
              space2: Attributes.ownerSpace2,
            },
        newSpaces: isRequester
          ? {
              block: Attributes.ownerBlock,
              space1: Attributes.ownerSpace1,
              space2: Attributes.ownerSpace2,
            }
          : {
              block: Attributes.requesterBlock,
              space1: Attributes.requesterSpace1,
              space2: Attributes.requesterSpace2,
            },
      });
    } else {
      res.json({
        status: "waiting",
        message: "Confirmation recorded. Waiting for other party to confirm.",
        otherPartyPhone: isRequester
          ? Attributes.ownerPhone
          : Attributes.requesterPhone,
      });
    }
  } catch (error) {
    console.error("Error confirming swap:", error);
    res.status(500).json({ status: "error", message: "Error confirming swap" });
  }
});

// New endpoint to delete a swap request
app.post("/delete-request", async (req, res) => {
  const { phoneNumber, requestId } = req.body;

  try {
    // First, verify that the request belongs to the user
    const getParams = {
      TableName: "SwapRequests",
      Key: { id: requestId },
    };

    const { Item } = await dynamodb.get(getParams).promise();

    if (!Item || Item.requesterPhone !== phoneNumber) {
      return res.status(403).json({
        status: "error",
        message:
          "Unauthorized: Request not found or does not belong to this user",
      });
    }

    // If verified, delete the request
    const deleteParams = {
      TableName: "SwapRequests",
      Key: { id: requestId },
      ConditionExpression: "requesterPhone = :phone",
      ExpressionAttributeValues: {
        ":phone": phoneNumber,
      },
    };

    await dynamodb.delete(deleteParams).promise();

    res.json({ status: "success", message: "Request deleted successfully" });
  } catch (error) {
    console.error("Error deleting swap request:", error);
    res
      .status(500)
      .json({ status: "error", message: "Error deleting swap request" });
  }
});

async function swapParkingSpaces(swapRequest) {
  const transactParams = {
    TransactItems: [
      {
        Update: {
          TableName: "ParkingSpaces",
          Key: { phoneNumber: swapRequest.requesterPhone },
          UpdateExpression:
            "set blockLetter = :block, spaceNumber1 = :space1, spaceNumber2 = :space2",
          ExpressionAttributeValues: {
            ":block": swapRequest.ownerBlock,
            ":space1": swapRequest.ownerSpace1,
            ":space2": swapRequest.ownerSpace2,
          },
        },
      },
      {
        Update: {
          TableName: "ParkingSpaces",
          Key: { phoneNumber: swapRequest.ownerPhone },
          UpdateExpression:
            "set blockLetter = :block, spaceNumber1 = :space1, spaceNumber2 = :space2",
          ExpressionAttributeValues: {
            ":block": swapRequest.requesterBlock,
            ":space1": swapRequest.requesterSpace1,
            ":space2": swapRequest.requesterSpace2,
          },
        },
      },
    ],
  };

  try {
    await dynamodb.transactWrite(transactParams).promise();
  } catch (error) {
    console.error("Error swapping parking spaces:", error);
    throw error;
  }
}

// New endpoint to register initial parking spaces
app.post("/register-parking", async (req, res) => {
  const { phoneNumber, blockLetter, spaceNumber1, spaceNumber2 } = req.body;

  const parkingSpaceParams = {
    TableName: "ParkingSpaces",
    Item: {
      phoneNumber,
      blockLetter,
      spaceNumber1,
      spaceNumber2,
    },
  };

  try {
    await dynamodb.put(parkingSpaceParams).promise();
    res.json({
      status: "success",
      message: "Parking space registered successfully",
    });
  } catch (error) {
    console.error("Error registering parking space:", error);
    res
      .status(500)
      .json({ status: "error", message: "Error registering parking space" });
  }
});

app.listen(port, () => {
  console.log(`Car park swap app listening at http://localhost:${port}`);
});
