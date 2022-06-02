const AWS = require("aws-sdk");
const express = require("express");
const serverless = require("serverless-http");
const jwt_decode = require("jwt-decode");

const app = express();

const STUDENTS_TABLE = process.env.STUDENTS_TABLE;
const USERPOOL_ID = process.env.USERPOOL_ID
const dynamoDbClient = new AWS.DynamoDB.DocumentClient();
const cognitoidentityserviceprovider = new AWS.CognitoIdentityServiceProvider();

app.use(express.json());

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Credentials', true)
  res.header("Access-Control-Allow-Origin", "http://localhost:3000"); // restrict it to the required domain
  res.header("Access-Control-Allow-Methods", "GET,POST");
  // Set custom headers for CORS
  res.header("Access-Control-Allow-Headers", "Content-type,Accept,X-Custom-Header");

  try {
    const jwtpayload = jwt_decode(req.headers.authorization);
    const group = jwtpayload["cognito:groups"][0];
    switch (req.path) {
      case "/users":
      case "/createuser":
      case "/updatestudent":
      case "/adddetail":
        if (["faculty", "superadmin"].includes(group))
          next();
        else
          res.status(401).json({ message: "Unauthorized" });
        break;
      default:
        if (req.path.startsWith("/students/"))
          if (jwtpayload["username"] == req.params.studentID || ["faculty", "superadmin"].includes(group))
            next();
          else
            res.status(401).json({ message: "Unauthorized" });
        else
          next();
        break;
    }
  } catch (_) {
    next()
  }

})

app.get("/", async function (req, res) {
  const { departmentNo, classNo, username } = { departmentNo: "5", classNo: "4", username: "huz" }
  if (departmentNo && classNo) {
    cognitoidentityserviceprovider.adminUpdateUserAttributes(
      {
        UserAttributes: [
          {
            Name: 'custom:departmentNo',
            Value: departmentNo
          },
          {
            Name: 'custom:classNo',
            Value: classNo
          }
        ],
        UserPoolId: USERPOOL_ID,
        Username: username
      }
    ).promise().then(data => res.json(data));
  }
})

app.get("/students/:studentID", async function (req, res) {
  try {
    var params = {
      UserPoolId: USERPOOL_ID, /* required */
      Username: req.params.studentID /* required */
    };
    const User = await cognitoidentityserviceprovider.adminGetUser(params).promise()
    var params = {
      TableName: STUDENTS_TABLE,
      Key: {
        studentID: req.params.studentID,
      },
    };
    const { Item } = await dynamoDbClient.get(params).promise();
    if (Item) {
      User.Item = Item
    }
    res.status(200).json({ User });
  } catch (error) {
    console.log(error);
    res.status(404).json({ error: "Could not find student" });
  }
});

app.get("/users", async function (req, res) {

  const users = []

  var params = {
    UserPoolId: USERPOOL_ID, /* required */
  };

  cognitoidentityserviceprovider.listGroups(params).promise().then(
    async data => {
      await Promise.all(data.Groups.map(async (groupEntity) => {
        var params = {
          GroupName: groupEntity.GroupName,
          UserPoolId: USERPOOL_ID, /* required */
        };
        await cognitoidentityserviceprovider.listUsersInGroup(params).promise().then((data1) => {
          data1.Users.map(userEntity => {
            userEntity["group"] = groupEntity.GroupName;
            users.push(userEntity);
          });
        }).catch(err1 => console.log(err1, err1.stack));
      }))
      res.status(200).json({ users });
    }).catch(err => { console.log(err, err.stack) });
});

app.post("/createuser", async function (req, res) {
  const { email, password, type, username } = req.body

  var params = {
    UserPoolId: USERPOOL_ID,
    Username: username,
    TemporaryPassword: password,
    UserAttributes: [
      {
        Name: 'email',
        Value: email
      }
    ]
  }
  if (type == "student") {
    params["UserAttributes"].push({
      Name: 'custom:departmentNo',
      Value: (req.body)["departmentNo"]
    })
    params["UserAttributes"].push({
      Name: 'custom:classNo',
      Value: (req.body)["classNo"]
    })
  }
  cognitoidentityserviceprovider.adminCreateUser(params, function (err, data) {
    if (err) {
      res.status(200).json({ message: err });
    }
    else {
      var params = {
        GroupName: type, /* required */
        UserPoolId: USERPOOL_ID, /* required */
        Username: username /* required */
      };
      cognitoidentityserviceprovider.adminAddUserToGroup(params, function (err, data) {
        if (err) console.log(err, err.stack); // an error occurred
        else {
          res.status(200).json({ message: data });
        };           // successful response
      });
    }
  })
});

app.post("/updatestudent", async function (req, res) {
  const { username, detail, departmentNo, classNo } = req.body;

  try {

    if (departmentNo && classNo) {
      var params = {
        UserAttributes: [
          {
            Name: 'custom:departmentNo',
            Value: departmentNo
          },
          {
            Name: 'custom:classNo',
            Value: classNo
          }
        ],
        UserPoolId: USERPOOL_ID,
        Username: username
      }
      await cognitoidentityserviceprovider.adminUpdateUserAttributes(params).promise();
    }

    if (detail) {
      for (var key in detail) {
        var params = {
          TableName: STUDENTS_TABLE,
          Key: {
            studentID: username,
            name: key.toLowerCase()
          },
          ExpressionAttributeNames: {
            "#d": "detail"
          },
          ExpressionAttributeValues: {
            ":d": detail[key]
          },
          UpdateExpression: "set #d = :d"
        };
        await dynamoDbClient.update(params).promise();
      }
    }

    res.status(200).json({ message: "success" });

  } catch (error) {
    res.status(500).json({ error });
  }

});

app.post("/adddetail", async function (req, res) {
  const { studentID, detail } = req.body;

  for (var key in detail) {
    const params = {
      TableName: STUDENTS_TABLE,
      Item: {
        studentID,
        name: key.toLowerCase(),
        detail: detail[key]
      }
    }
    await dynamoDbClient.put(params).promise();
  }

  res.status(200).json({ message: "success" })
})

app.use((req, res, next) => {
  return res.status(404).json({
    error: "Not Found",
  });
});


module.exports.handler = serverless(app);
